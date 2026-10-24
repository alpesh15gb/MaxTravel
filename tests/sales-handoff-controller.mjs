/** Actual Sales controller extraction; pure stubs only, no browser, server or database. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/app/(app)/sales/SalesClient.tsx", import.meta.url), "utf8");
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from, "Actual Sales controller must remain under regression coverage");
  return source.slice(from, to);
}
const compiled = ts.transpileModule([
  section("  const load = useCallback(", "  const checkRecovery = useCallback("),
  section("  useLayoutEffect(() => {", "  useEffect(() => {\n    if (!recovery)"),
  section("  async function reload()", "  async function searchEnquiries("),
].join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) });
const page = () => ({ leads: [{ id: "page-one" }], customers: [], recoveryContext: "fixture", nextCursor: "more", canEdit: true, canCreate: true, canQuote: true, canConvert: true });
const detail = id => response({ lead: { id }, recoveryContext: "fixture" });
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function harness() {
  const state = { data: null, view: "list", selectedId: null, loading: false, error: "", notice: "", focus: 0 };
  const calls = [], reviewed = [];
  let activate, pendingReview = null;
  let fetcher = async url => url.includes("leadId=") ? detail(new URL(url, "http://fixture.invalid").searchParams.get("leadId")) : response(page());
  const env = {
    useCallback: fn => fn, useLayoutEffect(fn) { activate = fn; },
    readGeneration: { current: 0 }, activationGeneration: { current: 0 }, recoveryCheck: { current: 0 },
    pendingHandoffId: { current: null }, listCriteria: { current: { q: "", stage: "ALL" } },
    selectedIdRef: { current: null }, dataRef: { current: null }, activeQuote: { current: null }, mutationLock: { current: false },
    draftMemory: { context: "fixture", getSnapshot: () => null, clear() {}, expire() {} },
    actionMemory: { getSnapshot: () => pendingReview, getReviewEpoch: () => 1, clearAfterReview(nonce) { reviewed.push(nonce); pendingReview = null; return true; } },
    customerMemory: { getSnapshot: () => null }, dirty: false,
    async fetch(url) { calls.push(url); return fetcher(url); },
    setData(value) { state.data = value; env.dataRef.current = value; },
    setSelectedId(value) { state.selectedId = value; env.selectedIdRef.current = value; },
    setView(value) { state.view = value; }, setLoading(value) { state.loading = value; },
    setError(value) { state.error = value; }, setNotice(value) { state.notice = value; },
    setFocusRequest(value) { state.focus = value(state.focus); },
    setContextChanged() {}, setDirty() {}, setItems() {}, newItem: () => ({}), setTerms() {}, setExpiry() {},
    setShare() {}, setShareContext() {}, setShareQuoteId() {}, setAppendedFocusId() {}, setListIds() {},
    setRecovery() {}, reconcileShare() {}, checkRecovery: async () => null, setQuery() {}, setFilter() {}, setUncertain() {},
  };
  return {
    state, env, calls, reviewed,
    fetchWith(fn) { fetcher = fn; }, review(value) { pendingReview = value; },
    route(initialLeadId) {
      const inputs = { ...env, initialLeadId };
      const controller = new Function(...Object.keys(inputs), compiled + "; return { load, reload }; ")(...Object.values(inputs));
      return { ...controller, activate: () => activate() };
    },
  };
}

// The original defect: a failed off-page exact read made Retry silently abandon the URL target.
{
  const h = harness(); let fail = true;
  h.fetchWith(async url => {
    if (!url.includes("leadId=")) return response(page());
    if (fail) { fail = false; throw new Error("Synthetic exact-read interruption"); }
    return detail(new URL(url, "http://fixture.invalid").searchParams.get("leadId"));
  });
  const route = h.route("off-page-target"); route.activate(); await flush();
  assert.equal(h.state.data, null); assert.match(h.state.error, /could not be loaded/);
  assert.equal(h.env.pendingHandoffId.current, "off-page-target");
  await route.reload();
  assert.deepEqual(h.calls, ["/api/sales", "/api/sales?leadId=off-page-target", "/api/sales", "/api/sales?leadId=off-page-target"]);
  assert.equal(h.state.selectedId, "off-page-target"); assert.equal(h.state.view, "lead");
  assert.equal(h.env.pendingHandoffId.current, null); assert.equal(h.state.error, "");
  // Once resolved, the original URL must not replace a later deliberate selection.
  h.env.setSelectedId("another-selection"); await route.reload();
  assert.equal(h.calls.at(-1), "/api/sales?leadId=another-selection"); assert.equal(h.state.selectedId, "another-selection");
}

// Failed page-one reads also retain the target, and repeated reloads cannot fan out requests.
{
  const h = harness(); h.fetchWith(async () => { throw new Error("Synthetic page failure"); });
  const route = h.route("retry-target"); route.activate(); await flush();
  const held = deferred(); h.fetchWith(async url => url.includes("leadId=") ? detail("retry-target") : held.promise);
  const first = route.reload(), second = route.reload(); held.resolve(response(page()));
  await Promise.all([first, second]);
  assert.equal(h.calls.filter(url => url === "/api/sales").length, 2, "Initial failed load plus one retry only");
  assert.equal(h.state.selectedId, "retry-target");
}

// Pending outcome review owns its exact record rather than the unrelated incoming link.
{
  const h = harness(), route = h.route("url-target");
  h.env.pendingHandoffId.current = "url-target"; h.env.setSelectedId("old-selection");
  h.review({ nonce: "outcome-one", kind: "stage", phase: "uncertain", leadId: "pending-review-target" });
  await route.reload();
  assert.equal(h.calls.at(-1), "/api/sales?leadId=pending-review-target");
  assert.equal(h.state.selectedId, "pending-review-target"); assert.deepEqual(h.reviewed, ["outcome-one"]);
  assert.equal(h.env.pendingHandoffId.current, null, "The resolved outcome review must not leave a latent URL redirect");
}

// Unknown creation has no safe exact identity: retain its unfiltered review, not a URL guess.
{
  const h = harness(), route = h.route("unrelated-url");
  h.env.pendingHandoffId.current = "unrelated-url";
  h.review({ nonce: "unknown-create", kind: "create", phase: "uncertain" });
  await route.reload();
  assert.deepEqual(h.calls, ["/api/sales"]); assert.equal(h.state.selectedId, null); assert.equal(h.state.view, "list");
  assert.deepEqual(h.reviewed, ["unknown-create"]); assert.equal(h.env.pendingHandoffId.current, null);
}

// A retry may establish that the exact record disappeared; it must never choose another lead.
{
  const h = harness(); let fail = true;
  h.fetchWith(async url => {
    if (!url.includes("leadId=")) return response(page());
    if (fail) { fail = false; throw new Error("Synthetic interrupted read"); }
    return response({ error: "Not found" }, 404);
  });
  const route = h.route("no-longer-visible"); route.activate(); await flush(); await route.reload();
  assert.equal(h.state.selectedId, null); assert.equal(h.state.view, "list");
  assert.match(h.state.notice, /no longer available/); assert.equal(h.env.pendingHandoffId.current, null);
}

// Missing/revoked targets never select a guessed first-page record; a new route clears old notices.
{
  const h = harness(); h.fetchWith(async url => url.includes("leadId=") ? response({ error: "Not found" }, 404) : response(page()));
  const missing = h.route("unavailable"); const close = missing.activate(); await flush();
  assert.equal(h.state.selectedId, null); assert.equal(h.state.view, "list"); assert.match(h.state.notice, /no longer available/);
  close(); h.state.error = "Obsolete load error";
  h.fetchWith(async url => url.includes("leadId=") ? detail("available") : response(page()));
  h.route("available").activate();
  assert.equal(h.state.notice, ""); assert.equal(h.state.error, "");
  await flush(); assert.equal(h.state.selectedId, "available"); assert.equal(h.state.view, "lead");
}

// A slow retry from an old route cannot change the new route, its selection or its notice.
{
  const h = harness(), held = deferred(); let fail = true;
  h.fetchWith(async url => {
    if (!url.includes("leadId=")) return response(page());
    if (url.endsWith("old-target")) { if (fail) { fail = false; throw new Error("Synthetic interruption"); } return held.promise; }
    return detail("new-target");
  });
  const old = h.route("old-target"), close = old.activate(); await flush();
  const retry = old.reload(); await flush(); close();
  h.route("new-target").activate(); await flush();
  held.resolve(detail("old-target")); await retry;
  assert.equal(h.state.selectedId, "new-target"); assert.equal(h.state.view, "lead");
  assert.equal(h.state.error, ""); assert.equal(h.state.notice, ""); assert.equal(h.env.pendingHandoffId.current, null);
  assert(!h.state.data.leads.some(lead => lead.id === "old-target"));
}

// Returning to unqualified /sales cancels an unresolved URL handoff from the previous route.
{
  const h = harness(); h.fetchWith(async () => { throw new Error("Synthetic old-route failure"); });
  const old = h.route("abandoned-target"), close = old.activate(); await flush();
  assert.equal(h.env.pendingHandoffId.current, "abandoned-target"); close();
  h.fetchWith(async () => response(page())); h.route(undefined).activate(); await flush();
  assert.equal(h.env.pendingHandoffId.current, null); assert.equal(h.state.selectedId, null); assert.equal(h.state.view, "list");
  assert.equal(h.calls.at(-1), "/api/sales"); assert.equal(h.state.error, ""); assert.equal(h.state.notice, "");
}

console.log("PASS Sales exact handoff controller: interrupted list/detail retries, repeated reload lock, pending-review precedence, later user selection, unavailable→valid navigation, and stale-route completion isolation.");
