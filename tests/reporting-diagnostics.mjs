/** Body-free diagnostics for synthetic reporting fixtures. Never retain cookies, headers or filter IDs. */
export function createReportDiagnostics(now = () => Date.now()) {
 const started = now(), requests = [], marks = [], observed = new WeakMap();
 const elapsed = () => now() - started;
 function request(req) {
  const url = new URL(req.url());
  if (!["/api/reports", "/api/reports/accounts", "/api/reports/terms"].includes(url.pathname)) return;
  const query = Object.fromEntries(["report", "from", "to", "page", "format", "options"].filter(key => url.searchParams.has(key)).map(key => [key, url.searchParams.get(key)]));
  const row = { id: requests.length + 1, method: req.method(), path: url.pathname, query, filters: ["customerId", "supplierId", "ownerId", "status"].filter(key => url.searchParams.has(key)), startedMs: elapsed(), state: "pending" };
  requests.push(row); observed.set(req, row);
 }
 function response(res) { const row = observed.get(res.request()); if (row) Object.assign(row, { status: res.status(), responseMs: elapsed(), state: "response" }); }
 function finished(req) { const row = observed.get(req); if (row) Object.assign(row, { finishedMs: elapsed(), state: "finished" }); }
 function failed(req) { const row = observed.get(req); if (row) Object.assign(row, { finishedMs: elapsed(), state: "failed", failure: String(req.failure()?.errorText || "Request failed").replace(/https?:\/\/\S+/g, "[url]") }); }
 return { request, response, finished, failed, mark: (phase, detail = {}) => marks.push({ phase, atMs: elapsed(), ...detail }), snapshot: () => ({ elapsedMs: elapsed(), requests: requests.map(row => ({ ...row })), marks: marks.map(row => ({ ...row })) }) };
}

export function reportClientState() {
 const generate = [...document.querySelectorAll("button")].find(button => ["Generate report", "Generating…"].includes(button.textContent));
 const chooser = [...document.querySelectorAll("select")].find(select => select.closest("label")?.textContent.includes("Choose a report"));
 return { viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY }, visibility: document.visibilityState, selectedReport: chooser?.value || null, generate: generate ? { label: generate.textContent, disabled: generate.disabled } : null, loading: [...document.querySelectorAll('[role="status"]')].some(el => /Loading report/.test(el.textContent)), alerts: document.querySelectorAll('[role="alert"]').length, openDialogs: document.querySelectorAll("dialog[open]").length, tables: [...document.querySelectorAll("table")].map(table => ({ label: table.getAttribute("aria-label"), visible: table.getBoundingClientRect().width > 0, rows: table.tBodies[0]?.rows.length || 0 })), reportLinks: [...document.querySelectorAll('a[href^="/api/reports"]')].length };
}
