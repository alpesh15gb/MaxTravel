/**
 * Staff response-loss regression. Every user, session and write lives in a disposable SQLite
 * database served on loopback. A dropped acknowledgement follows an actual committed route.fetch,
 * never a mocked success. Run only where browser execution is authorized (CI installs Chromium).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { chromium } from "./browser.mjs";
import { within, withFixtureCleanup, stopFixtureChild } from "./fixture-lifecycle.mjs";

const port = 3381, base = `http://127.0.0.1:${port}`;
const out = resolve("test-artifacts/employee-recovery");
const dir = await mkdtemp(join(tmpdir(), "employee-recovery-fixture-"));
const database = `file:${join(dir, "fixture.db")}`;
const secret = randomBytes(48).toString("hex"), hash = "synthetic-not-a-real-password-hash";
const report = { scope: "Synthetic staff fixtures only; lost-response and duplicate-submit browser regression", checks: [], errors: [], blocked: [], passed: false, failure: "" };
let db, server, browser, page, logs = "", spawnError = "";
const persist = () => {
  fs.writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(join(out, "server.log"), logs);
};
async function session(id) {
  const sessionId = randomBytes(16).toString("hex");
  await db.staffSession.create({ data: { id: sessionId, userId: id, expiresAt: new Date(Date.now() + 3600000), agent: "Employee recovery synthetic fixture" } });
  return new SignJWT({ id, sessionId, authVersion: createHash("sha256").update(hash).digest("hex") })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret));
}
async function setCookie(context, token) { await context.addCookies([{ name: "tos_session", value: token, url: base, httpOnly: true, sameSite: "Lax" }]); }
async function target(id) {
  return db.user.create({ data: { id, employeeCode: `TEST-${id}`, name: `Synthetic ${id}`, email: `${id}@example.test`, phone: "9000000001", passwordHash: hash, roleId: "role-reader", branchId: "branch-fixture" } });
}
async function start(name, width = 1440, actorId = "owner-a") {
  const context = await browser.newContext({ viewport: { width, height: width <= 320 ? 640 : width < 768 ? 844 : 1000 }, serviceWorkers: "block" });
  context.setDefaultTimeout(15000); context.setDefaultNavigationTimeout(30000);
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === base) return route.continue();
    report.blocked.push({ scenario: name, origin: new URL(route.request().url()).origin });
    return route.abort("blockedbyclient");
  });
  await context.routeWebSocket("**/*", socket => socket.close({ code: 1008, reason: "Loopback-only synthetic fixture" }));
  await setCookie(context, await session(actorId));
  page = await context.newPage();
  page.on("pageerror", error => report.errors.push({ scenario: name, message: error.message }));
  const writes = [], reads = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname !== "/api/employees") return;
    if (request.method() === "POST") writes.push(request.postDataJSON());
    if (request.method() === "GET") reads.push(request.url());
  });
  await page.goto(base + "/employees");
  await page.getByRole("heading", { name: "Your team", exact: true }).waitFor();
  return { context, writes, reads };
}
const button = (name, root = page) => root.getByRole("button", { name, exact: true });
const rowFor = employee => page.getByRole("row").filter({ hasText: employee.email });
const dialog = () => page.getByRole("dialog");
async function edit(employee) { await button("Edit", rowFor(employee)).click(); await dialog().waitFor(); return dialog(); }
const field = (name, root = dialog()) => root.locator("label.field").filter({ has: page.locator(".field-label").filter({ hasText: new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }) }).locator("input,select,textarea");
async function repeatSubmit(form) {
  await form.evaluate(node => {
    node.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    node.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
async function repeatClick(locator) { await locator.evaluate(node => { node.click(); node.click(); }); }
async function unknown(root = page) { await root.getByText(/outcome unknown/i).first().waitFor(); }
async function matches(root = page) { await root.getByText(/Current record matches/i).first().waitFor(); }
async function shot(name) { await page.screenshot({ path: join(out, `${name}.png`), fullPage: false, animations: "disabled" }); }
async function focusedFeedbackGeometry(locator, label) {
  const handle = await locator.elementHandle(); assert(handle);
  try { await page.waitForFunction(node => document.activeElement === node, handle); } finally { await handle.dispose(); }
  const geometry = await locator.evaluate(node => {
    const dialog = node.closest("dialog"), r = node.getBoundingClientRect(), d = dialog.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { viewport: { width: innerWidth, height: innerHeight }, dialog: { top: d.top, bottom: d.bottom, left: d.left, right: d.right, scrollTop: dialog.scrollTop, scrollHeight: dialog.scrollHeight, clientHeight: dialog.clientHeight, modal: dialog.matches(":modal") },
      target: { top: r.top, bottom: r.bottom, left: r.left, right: r.right }, focused: document.activeElement === node, focusInside: dialog.contains(document.activeElement), hit: hit === node || node.contains(hit),
      skipLinkFocused: document.activeElement?.matches(".skip-link"), pageScroll: { x: scrollX, y: scrollY }, documentWidth: document.documentElement.scrollWidth };
  });
  assert(geometry.dialog.modal && geometry.focused && geometry.focusInside && !geometry.skipLinkFocused, `${label}: focus belongs to the real modal, never the skip link/background`);
  assert(geometry.dialog.top >= -1 && geometry.dialog.bottom <= geometry.viewport.height + 1, `${label}: modal itself fits the viewport`);
  assert(geometry.target.top >= Math.max(0, geometry.dialog.top) - 1 && geometry.target.bottom <= Math.min(geometry.viewport.height, geometry.dialog.bottom) + 1 && geometry.target.left >= 0 && geometry.target.right <= geometry.viewport.width + 1 && geometry.hit, `${label}: focused feedback/control is visible and unobscured`);
  assert(geometry.documentWidth <= geometry.viewport.width + 1, `${label}: no page-level horizontal overflow`);
  (report.geometry ??= []).push({ label, ...geometry }); return geometry;
}

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function loseAcknowledgement() {
  const committed = deferred();
  const handler = async route => {
    if (route.request().method() !== "POST") return route.fallback();
    try {
      const response = await route.fetch();
      assert.equal(response.status(), 200, `Lost acknowledgement must follow a real commit: ${await response.text()}`);
      committed.resolve(await response.json());
      await route.abort("failed");
    } catch (error) { committed.reject(error); await route.abort("failed").catch(() => {}); }
  };
  await page.route("**/api/employees*", handler);
  return { committed: committed.promise, remove: () => page.unroute("**/api/employees*", handler) };
}
async function checkRecord(root = page) { await button("Check current record", root).click(); }

await mkdir(out, { recursive: true });
await withFixtureCleanup(async () => {
  try {
    await writeFile(join(dir, "schema.prisma"), await readFile(new URL("../prisma/schema.prisma", import.meta.url)));
    await cp(new URL("../prisma/migrations", import.meta.url), join(dir, "migrations"), { recursive: true });
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", join(dir, "schema.prisma")], { env: { ...process.env, DATABASE_URL: database }, stdio: "pipe" });
    db = new PrismaClient({ datasources: { db: { url: database } } });
    await db.role.createMany({ data: [{ id: "role-owner", key: "OWNER", name: "Owner", desc: "Synthetic" }, { id: "role-reader", key: "READ_ONLY", name: "Read-only Viewer", desc: "Synthetic" }, { id: "role-hr", key: "HR", name: "HR", desc: "Synthetic" }] });
    await db.branch.create({ data: { id: "branch-fixture", code: "FIX", name: "Synthetic branch", city: "Fixture" } });
    for (const id of ["owner-a", "owner-b"]) await db.user.create({ data: { id, employeeCode: id, name: `Synthetic ${id}`, email: `${id}@example.test`, phone: "", passwordHash: hash, roleId: "role-owner", branchId: "branch-fixture" } });
    await db.user.create({ data: { id: "staff-hr", employeeCode: "TEST-HR", name: "Synthetic HR", email: "staff-hr@example.test", phone: "", passwordHash: hash, roleId: "role-hr", branchId: "branch-fixture" } });
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(port), "--hostname", "127.0.0.1"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, DATABASE_URL: database, APP_ORIGIN: base, JWT_SECRET: secret, UPLOAD_ROOT: join(dir, "uploads"), WA_PROVIDER: "manual", NEXT_TELEMETRY_DISABLED: "1" },
    });
    server.stdout.on("data", value => logs += value); server.stderr.on("data", value => logs += value); server.on("error", error => spawnError = String(error));
    await within((async () => {
      while (true) {
        assert(!spawnError && server.exitCode === null && server.signalCode === null, `Owned fixture server stopped: ${spawnError}\n${logs}`);
        try { if ((await fetch(base + "/api/health", { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* wait only for this fixture */ }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    })(), 60000, "employee fixture startup");
    browser = await chromium.launch({ headless: true, timeout: 30000 });
    report.browser = { engine: browser.browserType().name(), version: browser.version() };

    // Ordinary editable modals retain their existing initial focus, Tab wrap and dismissal behavior.
    for (const width of [1440, 390]) {
      const employee = await target(`ordinary-modal-${width}`), s = await start(`ordinary-modal-${width}`, width), d = await edit(employee);
      await focusedFeedbackGeometry(field("Full name *", d), `ordinary-initial-${width}`);
      await page.keyboard.press("Shift+Tab"); await focusedFeedbackGeometry(button("Save changes", d), `ordinary-reverse-wrap-${width}`);
      await page.keyboard.press("Tab"); await focusedFeedbackGeometry(field("Full name *", d), `ordinary-forward-wrap-${width}`);
      await shot(`ordinary-editable-modal-${width}`);
      await page.keyboard.press("Escape"); await d.waitFor({ state: "hidden" });
      await page.waitForFunction(email => { const row = [...document.querySelectorAll("tbody tr")].find(node => node.textContent.includes(email)); return row && [...row.querySelectorAll("button")].some(node => node.textContent === "Edit" && document.activeElement === node); }, employee.email);
      await page.keyboard.press("Enter"); await d.waitFor(); await focusedFeedbackGeometry(field("Full name *", d), `ordinary-reopened-${width}`);
      await page.keyboard.press("Escape"); await d.waitFor({ state: "hidden" });
      assert.equal(s.writes.length, 0, "Ordinary modal keyboard checks never submit staff changes");
      await s.context.close(); report.checks.push(`Ordinary editable modal ${width}px: initial focus, forward/reverse Tab wrap, Escape restore and reopen remain unchanged`);
    }

    // Definite server rejection keeps every typed field and permits correction, not a false success.
    {
      const employee = await target("rejected"), s = await start("rejected");
      const d = await edit(employee);
      await field("Full name *", d).fill("Unsaved synthetic name");
      await field("Email *", d).fill("owner-a@example.test");
      const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/employees" && response.request().method() === "POST");
      await button("Save changes", d).click(); assert.equal((await response).status(), 400);
      await d.getByRole("alert").filter({ hasText: /Email is already in use/i }).waitFor();
      assert.equal(await field("Full name *", d).inputValue(), "Unsaved synthetic name");
      assert.equal(await field("Email *", d).inputValue(), "owner-a@example.test");
      assert(await button("Save changes", d).isEnabled());
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: employee.id } })).name, employee.name);
      assert.equal(s.writes.length, 1);
      await shot("rejected-fields-kept"); await s.context.close(); report.checks.push("Real validation rejection preserves typed fields and existing employee");
    }

    // An action-level forbidden result is not a changed identity: keep the HR operator's draft.
    {
      const employee = await db.user.findUniqueOrThrow({ where: { id: "owner-a" } });
      const s = await start("hr-forbidden-admin", 1440, "staff-hr"), d = await edit(employee);
      const typedName = "Unsaved HR administrator edit";
      await field("Full name *", d).fill(typedName); await field("Role *", d).selectOption("role-hr");
      assert.equal(await field("Reset password", d).count(), 0, "HR is not offered a colleague password reset");
      const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/employees" && response.request().method() === "POST");
      await button("Save changes", d).click(); const denied = await response;
      assert.equal(denied.status(), 403); const body = await denied.json(); assert.equal(body.employeeWrite, "rejected"); assert.match(body.recoveryContext, /^[a-f0-9]{64}$/);
      await d.getByRole("alert").filter({ hasText: /Only an owner or super administrator may manage administrator accounts/i }).waitFor();
      assert.equal(await field("Full name *", d).inputValue(), typedName); assert.equal(await field("Role *", d).inputValue(), "role-hr");
      assert(await button("Save changes", d).isEnabled(), "A definite forbidden action preserves a correctable form");
      assert(!/Staff session or access changed/i.test(await d.innerText()));
      const saved = await db.user.findUniqueOrThrow({ where: { id: employee.id } });
      assert.equal(saved.name, employee.name); assert.equal(saved.roleId, "role-owner"); assert.equal(s.writes.length, 1);
      await shot("hr-forbidden-admin-fields-kept"); await s.context.close(); report.checks.push("Real HR administrator edit403 preserves typed fields and specific denial without changing role, credentials, or identity");
    }

    // Two submit events in one turn cannot double-write; dropped success requires an explicit read.
    for (const width of [390, 320]) {
      const employee = await target(`lost-update-${width}`), s = await start(`lost-update-${width}`, width), d = await edit(employee);
      await field("Phone", d).fill("9000000888");
      const lost = await loseAcknowledgement();
      await repeatSubmit(d.locator("form")); await within(lost.committed, 15000, "lost update committed"); await unknown(d);
      assert.equal(s.writes.length, 1, "Synchronous submit lock prevents duplicate POST");
      assert.equal(s.reads.length, 0, "A lost response does not trigger an automatic replay or speculative read");
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: employee.id } })).phone, "9000000888");
      assert.equal(await field("Phone", d).inputValue(), "9000000888"); assert(await button("Save changes", d).isDisabled());
      assert(!/Nothing was (saved|changed)/i.test(await d.innerText()));
      await lost.remove();
      const failRead = route => route.request().method() === "GET" ? route.abort("failed") : route.fallback();
      await page.route("**/api/employees*", failRead); await checkRecord(d);
      await button("Check current record", d).waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll("dialog button")].some(node => node.textContent.trim() === "Check current record" && !node.disabled));
      assert(await button("Save changes", d).isDisabled(), "Failed reconciliation must not unlock retry");
      assert.equal(await field("Phone", d).inputValue(), "9000000888");
      await page.unroute("**/api/employees*", failRead);
      const wrongRecord = async route => {
        if (route.request().method() !== "GET") return route.fallback();
        const response = await route.fetch(), data = await response.json();
        assert.equal(response.status(), 200); assert(data.employee);
        await route.fulfill({ response, json: { ...data, employee: { ...data.employee, id: "another-employee", name: "STALE-WRONG-EMPLOYEE" } } });
      };
      await page.route("**/api/employees*", wrongRecord); await checkRecord(d); await unknown(d);
      assert(await button("Save changes", d).isDisabled(), "A response for another employee cannot unlock this draft");
      assert.equal(await page.getByText("STALE-WRONG-EMPLOYEE", { exact: false }).count(), 0, "A mismatched current-record response never overwrites the originating employee");
      await page.unroute("**/api/employees*", wrongRecord); await checkRecord(d); await matches(d);
      assert(s.reads.every(url => new URL(url).searchParams.get("employeeId") === employee.id), "Recovery checks only the originating employee");
      assert.equal(s.writes.length, 1, "Successful reconciliation never replays the save");
      const status = d.locator("[data-employee-recovery-status]");
      const summaryGeometry = await focusedFeedbackGeometry(status, `reconciled-summary-${width}`);
      assert.equal(summaryGeometry.dialog.scrollTop, 0, "The result resets only the inner dialog so the heading and outcome are discoverable");
      const heading = await d.getByRole("heading").boundingBox(); assert(heading && heading.y >= summaryGeometry.dialog.top && heading.y + heading.height <= summaryGeometry.viewport.height);
      await shot(width === 390 ? "lost-update-reconciled-mobile" : "lost-update-reconciled-small-mobile");
      // Start in reverse directly from the tabindex=-1 status, before visiting a Tab stop.
      // Real keyboard navigation, no scripted focus/scroll: disabled fieldset inputs are not stops.
      await page.keyboard.press("Shift+Tab"); await focusedFeedbackGeometry(button("Close", d), `reconciled-status-immediate-reverse-${width}`);
      await page.keyboard.press("Tab"); await focusedFeedbackGeometry(button("Check current record", d), `reconciled-check-${width}`);
      await page.keyboard.press("Tab"); await focusedFeedbackGeometry(button("Close", d), `reconciled-close-${width}`);
      await page.keyboard.press("Tab"); await focusedFeedbackGeometry(button("Check current record", d), `reconciled-forward-wrap-${width}`);
      await page.keyboard.press("Shift+Tab"); await focusedFeedbackGeometry(button("Close", d), `reconciled-reverse-wrap-${width}`);
      await shot(`lost-update-keyboard-actions-${width}`);
      await page.keyboard.press("Escape"); await d.waitFor({ state: "hidden" });
      await button("Edit", rowFor(employee)).waitFor();
      await page.waitForFunction(email => { const row = [...document.querySelectorAll("tbody tr")].find(node => node.textContent.includes(email)); return row && [...row.querySelectorAll("button")].some(node => node.textContent === "Edit" && document.activeElement === node); }, employee.email);
      assert.equal(s.writes.length, 1, "Keyboard review and dismissal cannot replay the mutation");
      await s.context.close(); report.checks.push(`Lost committed update ${width}px: retained draft, scoped recovery, visible focused result, immediate status Shift+Tab containment, real Tab/Shift+Tab controls, Escape return focus, no replay`);
    }

    // Dismissing an unknown result preserves the blocking page banner and gives it focus.
    {
      const employee = await target("unknown-dismissal"), s = await start("unknown-dismissal", 390), d = await edit(employee);
      await field("Phone", d).fill("9000000999");
      const abortWrite = route => route.request().method() === "POST" ? route.abort("failed") : route.fallback();
      await page.route("**/api/employees*", abortWrite); await button("Save changes", d).click(); await unknown(d);
      await focusedFeedbackGeometry(d.locator("[data-employee-recovery-status]"), "unknown-before-dismissal");
      await page.keyboard.press("Escape"); await d.waitFor({ state: "hidden" });
      const banner = page.getByRole("region", { name: "Employee save recovery", exact: true });
      const status = banner.locator("[data-employee-recovery-status]"); const handle = await status.elementHandle(); assert(handle);
      try { await page.waitForFunction(node => document.activeElement === node, handle); } finally { await handle.dispose(); }
      assert(await button("+ New employee").isDisabled()); assert(await button("Edit", rowFor(employee)).isDisabled());
      await page.keyboard.press("Tab");
      assert(await button("Check current record", banner).evaluate(node => document.activeElement === node), "Unknown dismissal focuses its recovery action, not the disabled original editor");
      assert.equal(s.writes.length, 1); assert.equal(s.reads.length, 0, "Escape does not clear uncertainty or silently check/replay it");
      await shot("unknown-dismissal-blocking-banner"); await s.context.close(); report.checks.push("Unknown result Escape keeps a focused blocking banner; creation/edit remain disabled and no check or write is repeated");
    }

    // If no write reached the server, a scoped differing record permits only an explicit new save.
    {
      const employee = await target("not-committed"), s = await start("not-committed"), d = await edit(employee);
      await field("Phone", d).fill("9000000666");
      const abortWrite = route => route.request().method() === "POST" ? route.abort("failed") : route.fallback();
      await page.route("**/api/employees*", abortWrite); await button("Save changes", d).click(); await unknown(d);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: employee.id } })).phone, employee.phone);
      await page.unroute("**/api/employees*", abortWrite);
      const heldRead = deferred(), releaseRead = deferred();
      const readHandler = async route => {
        if (route.request().method() !== "GET") return route.fallback();
        try { const response = await route.fetch(); assert.equal(response.status(), 200); heldRead.resolve(); await releaseRead.promise; await route.fulfill({ response }); }
        catch (error) { heldRead.reject(error); await route.abort("failed").catch(() => {}); }
      };
      await page.route("**/api/employees*", readHandler); await checkRecord(d); await within(heldRead.promise, 15000, "held scoped current record");
      assert(await button("Close", d).isDisabled(), "An in-flight reconciliation cannot be dismissed into another employee editor");
      assert(await button("Edit", rowFor(employee)).isDisabled(), "The outstanding operation cannot target another record");
      releaseRead.resolve(); await d.getByText(/Current record differs/i).waitFor();
      await page.unroute("**/api/employees*", readHandler);
      await d.getByLabel("Current employee record", { exact: true }).getByText(new RegExp(employee.phone)).waitFor();
      assert.equal(await field("Phone", d).inputValue(), "9000000666", "Current record is reviewed separately, never copied over local input");
      assert.equal(s.writes.length, 1); await button("Review and allow another save", d).click();
      await button("Save changes", d).waitFor(); assert(await button("Save changes", d).isEnabled());
      assert.equal(s.writes.length, 1, "Allowing another save is not itself a mutation");
      await button("Save changes", d).click(); await d.waitFor({ state: "hidden" });
      assert.equal(s.writes.length, 2); assert.equal((await db.user.findUniqueOrThrow({ where: { id: employee.id } })).phone, "9000000666");
      assert.equal(await db.auditLog.count({ where: { entity: "User", entityId: employee.id, action: "EDIT" } }), 1);
      await shot("explicit-retry-after-scoped-review"); await s.context.close(); report.checks.push("Uncommitted transport failure: held scoped read prevents record switching; reviewed latest value preserves draft; only explicit save retries once");
    }

    // A newer employee revision is a rejected write, not permission to overwrite unseen changes.
    {
      const employee = await target("revision-conflict"), s = await start("revision-conflict"), d = await edit(employee);
      await field("Phone", d).fill("9000000555");
      await db.user.update({ where: { id: employee.id }, data: { phone: "9000000444" } });
      const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/employees" && response.request().method() === "POST");
      await button("Save changes", d).click(); assert.equal((await response).status(), 409);
      await d.getByRole("alert").filter({ hasText: /Save rejected.*changed/i }).waitFor();
      assert(await button("Save changes", d).isDisabled()); assert.equal(await field("Phone", d).inputValue(), "9000000555");
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: employee.id } })).phone, "9000000444");
      await checkRecord(d); await d.getByText(/Current record differs/i).waitFor();
      await d.getByLabel("Current employee record", { exact: true }).getByText(/9000000444/).waitFor();
      assert.equal(await field("Phone", d).inputValue(), "9000000555");
      await button("Review and allow another save", d).click(); await button("Save changes", d).click(); await d.waitFor({ state: "hidden" });
      assert.equal(s.writes.length, 2); assert.notEqual(s.writes[0].baseRevision, s.writes[1].baseRevision, "Explicit retry binds to the reviewed revision");
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: employee.id } })).phone, "9000000555");
      await shot("competing-revision-reviewed"); await s.context.close(); report.checks.push("Competing employee revision: 409 preserves new server state, read displays it separately, explicit retry uses fresh revision");
    }

    // A known creation never degrades to an email-only retry after its follow-up read fails.
    {
      const s = await start("acknowledged-create-read-failure"); await button("+ New employee").click(); const d = dialog();
      await field("Full name *", d).fill("Synthetic acknowledged staff"); await field("Email *", d).fill("acknowledged-original@example.test");
      await field("Role *", d).selectOption("role-reader"); await field("Branch", d).selectOption("branch-fixture");
      await field("Initial password *", d).fill("Synthetic-Password-2026!");
      const failRead = route => route.request().method() === "GET" ? route.abort("failed") : route.fallback();
      await page.route("**/api/employees*", failRead);
      const acknowledgement = page.waitForResponse(response => new URL(response.url()).pathname === "/api/employees" && response.request().method() === "POST");
      await button("Create employee", d).click(); const response = await acknowledgement; assert.equal(response.status(), 200); const saved = await response.json();
      await d.getByText(/Save was acknowledged, but its current record could not be checked/i).waitFor();
      await page.unroute("**/api/employees*", failRead);
      await db.user.update({ where: { id: saved.employeeId }, data: { email: "acknowledged-renamed@example.test" } });
      await checkRecord(d); await d.getByLabel("Current employee record", { exact: true }).getByText(/acknowledged-renamed@example.test/).waitFor();
      assert(s.reads.every(url => new URL(url).searchParams.get("employeeId") === saved.employeeId), "Known creation is reconciled only by its immutable ID");
      assert.equal(await button("Review and allow another save", d).count(), 0); assert(await button("Create employee", d).isDisabled());
      // Synthetic-only deletion yields a real scoped null response, not proof of failed creation.
      await db.user.delete({ where: { id: saved.employeeId } }); await checkRecord(d);
      await d.getByText(/Its save was acknowledged; do not create it again/i).waitFor();
      assert.equal(await button("Review and allow another save", d).count(), 0); assert(await button("Create employee", d).isDisabled());
      assert.equal(s.writes.length, 1, "A rename or later scoped null never replays acknowledged creation");
      await shot("acknowledged-create-id-preserved"); await s.context.close(); report.checks.push("Acknowledged create plus failed read: stable ID survives email rename and later not-found; creation replay remains disabled");
    }

    // A lost create acknowledgement must not invite a duplicate staff account or password reset.
    {
      const s = await start("lost-create"); await button("+ New employee").click(); const d = dialog();
      await field("Full name *", d).fill("Synthetic newly created staff"); await field("Email *", d).fill("lost-create@example.test");
      await field("Phone", d).fill("9000000777"); await field("Role *", d).selectOption("role-reader"); await field("Branch", d).selectOption("branch-fixture");
      await field("Initial password *", d).fill("Synthetic-Password-2026!");
      const lost = await loseAcknowledgement(); await repeatSubmit(d.locator("form")); await within(lost.committed, 15000, "lost create committed"); await unknown(d);
      assert.equal(s.writes.length, 1); assert.equal(await db.user.count({ where: { email: "lost-create@example.test" } }), 1);
      assert(await button("Create employee", d).isDisabled()); assert.equal(await field("Email *", d).inputValue(), "lost-create@example.test");
      await lost.remove(); await checkRecord(d); await matches(d);
      assert(s.reads.every(url => new URL(url).searchParams.get("email") === "lost-create@example.test"), "Create recovery uses exact originating email");
      assert.equal(s.writes.length, 1); assert(await button("Create employee", d).isDisabled());
      assert.equal(await button("Review and allow another save", d).count(), 0, "A found employee never enables creation replay");
      await shot("lost-create-current-record"); await s.context.close(); report.checks.push("Lost committed create: exact-email current record, no duplicate POST or password replay");
    }

    // A lost acknowledgement plus a concurrent email rename is not a safe create retry.
    {
      const s = await start("unknown-create-renamed"); await button("+ New employee").click(); const d = dialog();
      await field("Full name *", d).fill("Synthetic unknown renamed staff"); await field("Email *", d).fill("unknown-original@example.test");
      await field("Role *", d).selectOption("role-reader"); await field("Branch", d).selectOption("branch-fixture");
      await field("Initial password *", d).fill("Synthetic-Password-2026!");
      const lost = await loseAcknowledgement(); await button("Create employee", d).click();
      const saved = await within(lost.committed, 15000, "renamed unknown create committed"); await unknown(d); await lost.remove();
      await db.user.update({ where: { id: saved.employeeId }, data: { email: "unknown-renamed@example.test" } });
      await checkRecord(d); await d.getByText(/Do not repeat employee creation based on this search/i).waitFor();
      assert.equal(await field("Email *", d).inputValue(), "unknown-original@example.test", "Unknown outcome retains the original typed draft");
      assert.equal(await button("Review and allow another save", d).count(), 0); assert(await button("Create employee", d).isDisabled());
      await repeatSubmit(d.locator("form")); assert.equal(s.writes.length, 1, "Null email search after real committed create never permits replay");
      assert.equal(await db.user.count({ where: { id: saved.employeeId } }), 1);
      await shot("unknown-create-null-search-no-replay"); await s.context.close(); report.checks.push("Lost creation acknowledgement plus concurrent email rename: null exact-email lookup retains draft and blocks creation replay");
    }

    // Matching visible fields never prove a lost password reset; do not offer a replay shortcut.
    {
      const employee = await target("lost-password"), s = await start("lost-password"), d = await edit(employee);
      const password = "Synthetic-Changed-2026!"; await field("Reset password", d).fill(password);
      const lost = await loseAcknowledgement(); await repeatSubmit(d.locator("form")); await within(lost.committed, 15000, "lost password committed"); await unknown(d);
      assert.equal(s.writes.length, 1); assert.notEqual((await db.user.findUniqueOrThrow({ where: { id: employee.id } })).passwordHash, hash);
      assert.equal(await field("Reset password", d).inputValue(), password); await lost.remove(); await checkRecord(d); await matches(d);
      await d.getByText(/A password cannot be verified from this record/i).waitFor();
      assert.equal(await button("Review and allow another save", d).count(), 0); assert(await button("Save changes", d).isDisabled());
      assert.equal(s.writes.length, 1); assert.equal(await db.auditLog.count({ where: { entity: "User", entityId: employee.id, action: "EDIT" } }), 1);
      const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
      assert(!storage.includes(password), "A retained password stays in the current form, never browser storage");
      await shot("lost-password-not-replayed"); await s.context.close(); report.checks.push("Lost synthetic password reset: one commit, retained in-memory input, visible-profile check cannot prove credentials or enable replay");
    }

    // Activation changes are explicit values, synchronously locked, and reconciled from the server.
    {
      const employee = await target("lost-toggle"), s = await start("lost-toggle"), row = rowFor(employee);
      const lost = await loseAcknowledgement(); await repeatClick(button("Deactivate", row)); await within(lost.committed, 15000, "lost toggle committed"); await unknown();
      assert.equal(s.writes.length, 1); assert.equal(s.writes[0].active, false); assert.equal((await db.user.findUniqueOrThrow({ where: { id: employee.id } })).active, false);
      assert(!/Nothing was (saved|changed)/i.test(await page.locator("main").innerText()));
      await lost.remove(); await checkRecord();
      await row.getByText("Inactive", { exact: true }).waitFor();
      assert.equal(s.writes.length, 1, "Status check does not activate the newly deactivated account");
      assert(s.reads.every(url => new URL(url).searchParams.get("employeeId") === employee.id));
      await shot("lost-toggle-reconciled"); await s.context.close(); report.checks.push("Activation double click creates one explicit false write; scoped recovery displays server Inactive state without inverse replay");
    }

    // A replacement cookie while a response is held cannot make an old modal report a fresh save.
    {
      const employee = await target("late-actor"), s = await start("late-actor"), d = await edit(employee);
      const privateText = "PRIVATE-old-actor-draft"; await field("Full name *", d).fill(privateText);
      const held = deferred(), release = deferred();
      const handler = async route => {
        if (route.request().method() !== "POST") return route.fallback();
        try { const response = await route.fetch(); assert.equal(response.status(), 200); held.resolve(); await release.promise; await route.fulfill({ response }); }
        catch (error) { held.reject(error); await route.abort("failed").catch(() => {}); }
      };
      await page.route("**/api/employees*", handler); await button("Save changes", d).click(); await within(held.promise, 15000, "held old actor acknowledgement");
      assert(await button("Saving…", d).isDisabled());
      await page.keyboard.press("Escape"); assert(await d.isVisible(), "Pending write cannot discard its result barrier");
      await setCookie(s.context, await session("owner-b")); release.resolve();
      await page.waitForFunction(() => !document.querySelector("dialog") || [...document.querySelectorAll('[role="alert"]')].some(node => /session|access|sign.in|changed/i.test(node.textContent)));
      assert.equal(s.writes.length, 1);
      assert(!/Employee (updated|saved)/i.test(await page.locator("body").innerText()), "Old actor response must not produce a new-session success toast");
      await shot("old-actor-response-blocked"); await s.context.close(); report.checks.push("Held committed response after session replacement cannot submit again or falsely report new-session success");
    }

    assert.deepEqual(report.errors, [], "No unhandled browser exceptions");
    assert.deepEqual(report.blocked, [], "No external network dependency");
    report.passed = true; console.log(`PASS employee recovery browser: ${report.checks.length} interrupted/repeated staff flows`);
  } catch (error) { report.failure = error?.stack ?? String(error); await page?.screenshot({ path: join(out, "failure.png"), fullPage: false, timeout: 5000 }).catch(() => {}); throw error; }
}, async () => {
  persist();
  await browser?.close();
  if (server) await stopFixtureChild(server);
  await db?.$disconnect(); await rm(dir, { recursive: true, force: true });
}, error => { report.passed = false; report.failure += `\nCleanup: ${String(error)}`; persist(); });
