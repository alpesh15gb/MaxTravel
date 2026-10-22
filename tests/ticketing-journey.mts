import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID, randomInt, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";

if (process.env.DATABASE_URL !== "file:./ticketing-journey-verification.db") throw Error("Use only isolated ticketing-journey-verification.db.");
const port = randomInt(20000, 60000);
const origin = `http://127.0.0.1:${port}`, suffix = randomUUID(), password = randomBytes(30).toString("hex");
const ticketPrefix = `123${randomInt(100000000, 1000000000)}`; // Unique per isolated run; repeated runs retain prior fixture tickets.
const role = await prisma.role.upsert({ where: { key: "OWNER" }, create: { key: "OWNER", name: "Fixture owner", desc: "Isolated ticketing verification" }, update: {} });
const branch = await prisma.branch.create({ data: { code: suffix, name: "Synthetic ticketing branch", city: "Test" } });
const user = await prisma.user.create({ data: { employeeCode: suffix, email: `${suffix}@example.test`, name: "Synthetic operator", phone: "", passwordHash: await bcrypt.hash(password, 12), roleId: role.id, branchId: branch.id } });
const customer = await prisma.customer.create({ data: { code: suffix, name: "Synthetic ticket customer", phone: "", city: "Test", branchId: branch.id, assignedToId: user.id, travellers: { create: [{ fullName: "Same Name" }, { fullName: "Same Name" }] } }, include: { travellers: true } });
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"], { env: { ...process.env, APP_ORIGIN: origin, JWT_SECRET: randomBytes(48).toString("hex"), WA_PROVIDER: "manual" }, stdio: ["ignore", "pipe", "pipe"] });
let logs = "", cookie = "";
const startedAt = Date.now();
let childExit: { code: number | null; signal: string | null; elapsedMs: number } | null = null;
let childError = "";
server.on("error", error => { childError = String(error); });
server.on("exit", (code, signal) => { childExit = { code, signal, elapsedMs: Date.now() - startedAt }; });
async function stopServer() {
  if (server.exitCode !== null || server.signalCode !== null || !server.pid) return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
    server.once("exit", () => { clearTimeout(timer); resolve(); });
    server.kill("SIGTERM");
  });
}
server.stdout.on("data", v => logs += v); server.stderr.on("data", v => logs += v);
async function post(path: string, body: unknown, expected = 200) {
  const r = await fetch(origin + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie }, body: JSON.stringify(body) });
  const data = await r.json(); assert.equal(r.status, expected, `${path}: ${JSON.stringify(data)}`);
  if (path === "/api/auth/login") cookie = r.headers.get("set-cookie")!.split(";")[0];
  return data;
}
try {
  let ready = false;
  for (let n = 0; n < 80; n++) {
    assert(!childError && !childExit, `Fixture child exited before readiness: ${JSON.stringify(childExit)} ${childError}\n${logs}`);
    // A health response from some other process must never satisfy fixture readiness.
    // Next's Ready marker occurs only after this fresh child has bound its random port.
    if (/Ready in/.test(logs) && server.pid && server.exitCode === null && server.signalCode === null) {
      try { if ((await fetch(origin + "/api/health")).ok) { ready = true; break; } } catch {}
    }
    await new Promise(r => setTimeout(r, 500));
  }
  assert(ready, logs);
  await post("/api/auth/login", { email: user.email, password });
  const managerRole = await prisma.role.upsert({ where: { key: "BRANCH_MANAGER" }, create: { key: "BRANCH_MANAGER", name: "Fixture branch manager", desc: "Isolated access test" }, update: {} });
  const manager = await prisma.user.create({ data: { employeeCode: `M-${suffix}`, email: `manager-${suffix}@example.test`, name: "Synthetic manager", phone: "", passwordHash: await bcrypt.hash(password, 12), roleId: managerRole.id, branchId: branch.id } });
  const foreignBranch = await prisma.branch.create({ data: { code: `F-${suffix}`, name: "Other synthetic branch", city: "Test" } });
  const foreignBooking = await prisma.booking.create({ data: { bookingNo: `FOREIGN-${suffix}`, customerId: customer.id, ownerId: user.id, branchId: foreignBranch.id, sellingPrice: 100 } });
  const foreignRefund = await prisma.refund.create({ data: { refundNo: `FOREIGN-${suffix}`, customerId: customer.id, bookingId: foreignBooking.id, amount: 50, reason: "Synthetic cross-branch access test" } });
  await post("/api/auth/login", { email: manager.email, password });
  await post("/api/refunds/update", { refundId: foreignRefund.id, status: "SUPPLIER_PENDING" }, 403);
  assert.equal((await prisma.refund.findUniqueOrThrow({ where: { id: foreignRefund.id } })).status, "REQUESTED", "Customer access must not grant foreign booking access");
  await post("/api/auth/login", { email: user.email, password });
  const created = await post("/api/bookings", { customerId: customer.id, travellerIds: customer.travellers.map(t => t.id), fare: 1000, pnr: "TEST12", sector: "DEL-BOM" });
  const bookingId = created.bookingId;
  await post("/api/invoices", { customerId: customer.id, bookingId, amount: 600 });
  await post("/api/invoices", { customerId: customer.id, bookingId, amount: 400 });
  await post("/api/invoices", { customerId: customer.id, bookingId, amount: 1 }, 409);
  assert.equal(await prisma.invoice.count({ where: { bookingId } }), 2, "Invoice ceiling rejects excess while permitting instalments");
  // Quote conversions may arrive without passenger links; the pre-ticket edit closes that handoff.
  await prisma.bookingTraveller.deleteMany({ where: { bookingId } });
  await post(`/api/bookings/${bookingId}`, { travellerIds: ["not-this-customers-traveller"] }, 400);
  await post(`/api/bookings/${bookingId}`, { travellerIds: customer.travellers.map(t => t.id) });
  assert.equal(await prisma.bookingTraveller.count({ where: { bookingId } }), 2);
  for (const status of ["REISSUED", "REISSUE_REQUESTED"]) await post("/api/bookings/status", { bookingId, status }, 400);
  // One actual airline document cannot be assigned to two same-name passengers.
  await post("/api/bookings/status", { bookingId, status: "TICKETED", tickets: customer.travellers.map(t => ({ travellerId: t.id, ticketNo: `${ticketPrefix}0` })) }, 400);
  assert.equal(await prisma.ticket.count({ where: { bookingId } }), 0, "Failed issuance rolls back all tickets");
  await post("/api/bookings/status", { bookingId, status: "TICKETED", tickets: customer.travellers.map((t, i) => ({ travellerId: t.id, ticketNo: `${ticketPrefix}${i}` })) });
  await post("/api/bookings/status", { bookingId, status: "TICKETED" });
  assert.equal(await prisma.ticket.count({ where: { bookingId } }), 2);
  assert.equal(await prisma.auditLog.count({ where: { entity: "Booking", entityId: bookingId, action: "STATUS" } }), 1, "Ticketing replay is a no-op");
  await post(`/api/bookings/${bookingId}`, { travellerIds: [customer.travellers[0].id] }, 400);
  await post("/api/bookings/status", { bookingId, status: "ENQUIRY" }, 400);
  await post("/api/bookings/extend-deadline", { bookingId, hours: 24 }, 400);
  const ticket = await prisma.ticket.findFirstOrThrow({ where: { bookingId } });
  const reissue = await post("/api/reissues", { originalTicketId: ticket.id, reason: "Synthetic date change", fareDifference: 100 });
  const replacementId = reissue.reissueBookingId;
  const request = await prisma.reissue.findFirstOrThrow({ where: { reissuedBookingId: replacementId } });
  await post("/api/reissues/status", { reissueId: request.id, status: "DONE" }, 400);
  await post("/api/payments", { customerId: customer.id, bookingId: replacementId, amount: 50, mode: "CASH" });
  await post("/api/reissues/status", { reissueId: request.id, status: "REJECTED" }, 409);
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: replacementId } })).status, "REISSUE_REQUESTED");
  if (process.env.TICKETING_BROWSER === "true") {
    const { chromium } = await import("./browser.mjs");
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const separator = cookie.indexOf("=");
      await context.addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: origin }]);
      const page = await context.newPage();
      const clientErrors:string[]=[]; const networkErrors:unknown[]=[];
      const events: unknown[] = [];
      let refreshRequest: { url: string; headers: Record<string, string> } | null = null;
      const at = () => Date.now() - startedAt;
      await page.addInitScript({ content: `(() => {
        const target = window;
        target.__journeyLifecycle = [{ event: "init", at: Date.now() }];
        const report = (detail) => console.debug("JOURNEY_TRANSPORT", JSON.stringify({ at: Date.now(), ...detail }));
        const abort = AbortController.prototype.abort;
        AbortController.prototype.abort = function(reason) { report({ event: "abort-controller", stack: new Error().stack?.slice(0, 1600) }); return abort.call(this, reason); };
        const cancel = ReadableStreamDefaultReader.prototype.cancel;
        ReadableStreamDefaultReader.prototype.cancel = function(reason) { report({ event: "reader-cancel", stack: new Error().stack?.slice(0, 1600) }); return cancel.call(this, reason); };
        const originalFetch = window.fetch.bind(window);
        window.fetch = function(input, init) {
          const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          if (headers.get("rsc") !== "1") return originalFetch(input, init);
          const url = input instanceof Request ? input.url : String(input);
          const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
          signal?.addEventListener("abort", () => report({ event: "fetch-signal-abort", url }), { once: true });
          report({ event: "fetch-start", url, signalAborted: signal?.aborted });
          const pending = originalFetch(input, init);
          void pending.then(response => {
            report({ event: "fetch-headers", url, status: response.status, headers: Object.fromEntries(["content-type", "content-length", "content-encoding", "transfer-encoding", "vary", "x-nextjs-postponed", "x-nextjs-cache"].map(name => [name, response.headers.get(name)])) });
          }, error => { report({ event: "fetch-rejection", url, error: String(error), signalAborted: signal?.aborted }); });
          return pending; // Preserve the original fetch promise and response stream without teeing.
        };

        for (const event of ["pagehide", "pageshow", "beforeunload", "visibilitychange"]) window.addEventListener(event, e => { const detail = { event, at: Date.now(), persisted: "persisted" in e ? e.persisted : undefined, visibility: document.visibilityState }; target.__journeyLifecycle?.push(detail); console.debug("JOURNEY_LIFECYCLE", JSON.stringify(detail)); });
        window.__journeyProbeReady = true;
      })();` });
      page.on("console", message => events.push({ elapsedMs: at(), event: "console", type: message.type(), text: message.text().slice(0, 2000) }));
      page.on("framenavigated", frame => { if (frame === page.mainFrame()) events.push({ elapsedMs: at(), event: "navigation", url: frame.url() }); });
      page.on("request", request => {
        const headers = request.headers();
        if (headers.rsc !== "1") return;
        const allowed = Object.fromEntries(["rsc", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch", "next-url", "accept"].filter(name => headers[name] !== undefined).map(name => [name, headers[name]]));
        events.push({ elapsedMs: at(), event: "rsc-request", url: request.url(), headers: allowed });
        if (!headers["next-router-prefetch"] && new URL(request.url()).pathname === `/ticketing/${replacementId}`) refreshRequest = { url: request.url(), headers: allowed };
      });
      page.on("response", async response => {
        if (response.request().headers().rsc !== "1") return;
        const event: Record<string, unknown> = { elapsedMs: at(), event: "rsc-response", url: response.url(), status: response.status(), type: response.headers()["content-type"] };
        events.push(event);
        try {
          const body = await response.text();
          event.bytes = body.length; event.hasCancellationSettlement = body.includes("Cancellation settlement");
          event.hasCancelled = body.includes('"status":"CANCELLED"'); event.hasReissueRequested = body.includes('"status":"REISSUE_REQUESTED"');
        } catch(error) { event.bodyError = String(error); }
      });
      page.on("pageerror",error=>clientErrors.push(error.message));
      page.on("requestfailed",request=>networkErrors.push({elapsedMs:at(),method:request.method(),url:request.url(),rsc:request.headers().rsc,prefetch:request.headers()["next-router-prefetch"],error:request.failure()?.errorText}));
      page.on("response",response=>{if(response.status()>=400)networkErrors.push({status:response.status(),path:new URL(response.url()).pathname});});
      await page.goto(`${origin}/ticketing/${replacementId}`);
      assert.equal(await page.evaluate("window.__journeyProbeReady === true"), true, `Diagnostic init must execute before the journey: ${clientErrors.join("; ")}`);
      await page.getByLabel("Booking status", { exact: true }).selectOption("CANCELLED");
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Supplier cancellation charge (INR) *", { exact: true }).fill("25");
      await dialog.getByLabel("Agency cancellation fee (INR) *", { exact: true }).fill("25");
      await dialog.getByLabel("Cancellation reason / agreed terms *", { exact: true }).fill("Synthetic agreed nonrefundable terms");
      assert.match(await dialog.innerText(), /New refund to request/);
      await dialog.getByRole("button", { name: "Back", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: replacementId } })).status, "REISSUE_REQUESTED", "Dismissal cannot mutate a booking");
      await page.getByLabel("Booking status", { exact: true }).selectOption("CANCELLED");
      await dialog.getByLabel("Supplier cancellation charge (INR) *", { exact: true }).fill("0");
      await dialog.getByLabel("Agency cancellation fee (INR) *", { exact: true }).fill("0");
      await dialog.getByLabel("Cancellation reason / agreed terms *", { exact: true }).fill("Full waiver agreed; synthetic browser test only");
      const cancellationResponse=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/bookings/status"&&response.request().method()==="POST");
      await dialog.getByRole("button", { name: "Save cancellation terms", exact: true }).click();
      const response=await cancellationResponse; events.push({ elapsedMs: at(), event: "cancellation-response", status: response.status() }); assert.equal(response.status(),200,"Cancellation save must explicitly succeed");
      try {
        await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
        await page.getByRole("heading", { name: "Cancellation settlement", exact: true }).waitFor();
        assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: replacementId } })).status, "CANCELLED");
      } catch(error) {
        mkdirSync("test-artifacts/journeys",{recursive:true});
        await page.screenshot({path:"test-artifacts/journeys/ticketing-cancellation-failure.png",fullPage:true});
        const stored=await prisma.booking.findUniqueOrThrow({where:{id:replacementId},select:{status:true,cancellationSupplierCharge:true,cancellationAgencyFee:true}});
        const serverView = await fetch(`${origin}/ticketing/${replacementId}`, { headers:{Cookie:cookie}, signal:AbortSignal.timeout(5000) }).then(async fresh => { const html=await fresh.text(); return {status:fresh.status,hasSettlement:html.includes("Cancellation settlement"),hasCancelled:html.includes('"status":"CANCELLED"'),hasReissueRequested:html.includes('"status":"REISSUE_REQUESTED"')}; }).catch(error=>({error:String(error)}));
        // Failure-only independent read; never reloads the browser or changes an assertion.
        // Only allowlisted RSC headers are copied, and the fixture cookie is never recorded.
        const replay = refreshRequest as { url: string; headers: Record<string, string> } | null;
        const serverRsc = replay ? await fetch(replay.url, { headers: { ...replay.headers, Cookie: cookie }, signal: AbortSignal.timeout(5000) }).then(async fresh => {
          const body = await fresh.text();
          return { status: fresh.status, bytes: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex"), hasSettlement: body.includes("Cancellation settlement"), hasCancelled: body.includes('"status":"CANCELLED"'), hasReissueRequested: body.includes('"status":"REISSUE_REQUESTED"'), hasRedirect: body.includes("NEXT_REDIRECT"), hasNotFound: body.includes("NEXT_HTTP_ERROR_FALLBACK"), headers: Object.fromEntries(["content-type", "content-length", "content-encoding", "transfer-encoding", "vary", "x-nextjs-postponed", "x-nextjs-cache"].map(name => [name, fresh.headers.get(name)])) };
        }).catch(error => ({ error: String(error) })) : { error: "No current-route refresh request observed" };
        const resourceTiming = await page.evaluate(() => performance.getEntriesByType("resource").filter(entry => entry.name.includes("_rsc=")).map(entry => { const r = entry as PerformanceResourceTiming; return { url: r.name, startTime: r.startTime, duration: r.duration, transferSize: r.transferSize, encodedBodySize: r.encodedBodySize, decodedBodySize: r.decodedBodySize }; }));
        const reactStateProbe = `(() => {
          const bookingId = ${JSON.stringify(replacementId)};
          function data(object, key) { return object && typeof object === "object" ? Object.getOwnPropertyDescriptor(object, key)?.value : undefined; }
          function modelStatuses(value) {
            const seen = new Set(), found = new Set(), pending = [[value, 0]];
            while (pending.length && seen.size < 10000) {
              const [item, depth] = pending.pop();
              if (!item || typeof item !== "object" || seen.has(item) || depth > 35) continue;
              seen.add(item);
              const descriptors = Object.getOwnPropertyDescriptors(item);
              if (descriptors.id?.value === bookingId && typeof descriptors.status?.value === "string") found.add(descriptors.status.value);
              if (item instanceof Map) for (const child of Map.prototype.values.call(item)) pending.push([child, depth + 1]);
              for (const descriptor of Object.values(descriptors)) if ("value" in descriptor && descriptor.value && typeof descriptor.value === "object") pending.push([descriptor.value, depth + 1]);
            }
            return { statuses: [...found], visited: seen.size, truncated: pending.length > 0 };
          }
          const containers = [document, document.documentElement, document.body];
          const roots = [];
          for (const container of containers) {
            const key = Object.getOwnPropertyNames(container).find(name => name.startsWith("__reactContainer$"));
            const root = key && data(data(container, key), "stateNode");
            if (data(root, "current") && !roots.includes(root)) roots.push(root);
          }
          return roots.map(root => {
            const queues = [], records = [], routerHooks = [], seen = new Set(), pending = [data(root, "current")], queueSeen = new Set();
            while (pending.length && seen.size < 10000) {
              const fiber = pending.pop(); if (!fiber || seen.has(fiber)) continue; seen.add(fiber);
              if (data(fiber, "child")) pending.push(data(fiber, "child")); if (data(fiber, "sibling")) pending.push(data(fiber, "sibling"));
              const props = data(fiber, "memoizedProps");
              if (data(data(props, "b"), "id") === bookingId) records.push({ current: data(data(props, "b"), "status"), pending: data(data(data(fiber, "pendingProps"), "b"), "status"), alternate: data(data(data(data(fiber, "alternate"), "memoizedProps"), "b"), "status"), lanes: data(fiber, "lanes"), childLanes: data(fiber, "childLanes") });
              const queue = data(props, "actionQueue");
              if (queue) {
                const hooks = []; let hook = data(fiber, "memoizedState");
                for (let i = 0; hook && i < 12; i++, hook = data(hook, "next")) {
                  const state = data(hook, "memoizedState"), status = data(state, "status");
                  if (["pending", "fulfilled", "rejected"].includes(status)) hooks.push({ index: i, status, models: modelStatuses(data(data(state, "value"), "cache")) });
                }
                if (hooks.length) routerHooks.push(hooks);
              }
              if (queue && !queueSeen.has(queue)) {
                queueSeen.add(queue);
                queues.push({ pending: data(data(data(queue, "pending"), "payload"), "type") ?? null, cacheModels: modelStatuses(data(data(queue, "state"), "cache")) });
              }
            }
            return { pendingLanes: data(root, "pendingLanes"), suspendedLanes: data(root, "suspendedLanes"), pingedLanes: data(root, "pingedLanes"), warmLanes: data(root, "warmLanes"), finishedLanes: data(root, "finishedLanes"), queues, routerHooks, records, fibersVisited: seen.size };
          });
        })()`;
        const reactState = await page.evaluate(reactStateProbe).catch(error => ({ error: String(error) }));
        writeFileSync("test-artifacts/journeys/ticketing-cancellation-failure.json",JSON.stringify({postStatus:response.status(),stored,serverView,serverRsc,resourceTiming,reactState,renderedStatus:await page.getByLabel("Booking status",{exact:true}).inputValue().catch(()=>"unavailable"),headingCount:await page.getByRole("heading",{name:"Cancellation settlement",exact:true}).count(),clientErrors,networkErrors,events,lifecycle:await page.evaluate(() => (window as typeof window & { __journeyLifecycle?: unknown[] }).__journeyLifecycle),server:{port,pid:server.pid,childExit,childError,logs}},null,2));
        // Failure-only controlled observation: a normal non-mutating menu toggle must never turn this failed assertion green.
        const urgentObservation = await (async () => {
          await page.getByRole("button", { name: "Account menu", exact: true }).click({ timeout: 1000 });
          const settlementVisible = await page.getByRole("heading", { name: "Cancellation settlement", exact: true }).waitFor({ state: "visible", timeout: 1000 }).then(() => true).catch(() => false);
          return { settlementVisible, renderedStatus: await page.getByLabel("Booking status", { exact: true }).inputValue().catch(() => "unavailable"), reactState: await page.evaluate(reactStateProbe).catch(error => ({ error: String(error) })) };
        })().catch(error => ({ error: String(error) }));
        writeFileSync("test-artifacts/journeys/ticketing-post-failure-menu-observation.json", JSON.stringify(urgentObservation, null, 2));
        throw error;
      }
      console.log("Ticketing browser: cancellation preview, dismiss/no mutation, reopen and explicit zero-charge save passed.");
    } finally { await browser.close(); }
  }
  await post("/api/bookings/status", { bookingId: replacementId, status: "CANCELLED", cancellationSupplierCharge: 0, cancellationAgencyFee: 0, cancellationReason: "Full waiver agreed; synthetic test only", refundAmount: 50 });
  const refund = await prisma.refund.findFirstOrThrow({ where: { bookingId: replacementId } });
  await post("/api/refunds/update", { refundId: refund.id, status: "SUPPLIER_PENDING" });
  const pendingRefund = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
  await post("/api/refunds/update", { refundId: refund.id, status: "SUPPLIER_PENDING" });
  assert.equal((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).supplierSentOn?.toISOString(), pendingRefund.supplierSentOn?.toISOString());
  assert.equal(await prisma.auditLog.count({ where: { entity: "Refund", entityId: refund.id, action: "STATUS" } }), 1, "Refund stage retry preserves timestamp and audit history");
  await post("/api/reissues/status", { reissueId: request.id, status: "DONE" }, 409);
  await post("/api/reissues/status", { reissueId: request.id, status: "REJECTED" });
  await post("/api/reissues/status", { reissueId: request.id, status: "REJECTED" });
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: replacementId } })).status, "CANCELLED");
  assert.equal(await prisma.refund.count({ where: { bookingId: replacementId, amount: 50 } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { entity: "Reissue", entityId: request.id, action: "STATUS" } }), 1);
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status, "TICKETED");
  const successful = await post("/api/reissues", { originalTicketId: ticket.id, reason: "Synthetic replacement", fareDifference: 100 });
  const successRequest = await prisma.reissue.findFirstOrThrow({ where: { reissuedBookingId: successful.reissueBookingId } });
  await post("/api/bookings/status", { bookingId: successful.reissueBookingId, status: "TICKETED", tickets: [{ travellerId: ticket.travellerId, ticketNo: `${ticketPrefix}9` }] });
  await post("/api/reissues/status", { reissueId: successRequest.id, status: "IN_PROGRESS" });
  await post("/api/reissues/status", { reissueId: successRequest.id, status: "DONE" });
  await post("/api/reissues/status", { reissueId: successRequest.id, status: "DONE" });
  assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status, "REISSUED");
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: successful.reissueBookingId } })).status, "REISSUED");
  console.log("Ticketing journey regressions passed: same-name passengers, duplicate tickets, status truth, retry safety, deadline closure, paid reissue rejection and cancellation/refund preservation.");
} finally {
  await stopServer();
  mkdirSync("test-artifacts/journeys", { recursive: true });
  writeFileSync("test-artifacts/journeys/ticketing-server.log", logs);
  writeFileSync("test-artifacts/journeys/ticketing-server.json", JSON.stringify({ port, pid: server.pid, childExit, childError, elapsedMs: Date.now() - startedAt }, null, 2));
  await prisma.$disconnect();
}
