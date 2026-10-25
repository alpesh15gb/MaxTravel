// Linux WebKit smoke with desktop/iPhone emulation, not physical iOS Safari certification.
// Uses only disposable visual-review fixtures and rejects all browser traffic outside loopback.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { webkit, devices } from "playwright";
import { within, withFixtureCleanup } from "./fixture-lifecycle.mjs";

assert.equal(process.platform, "linux", "This dedicated smoke is scoped to Linux WebKit");
const port = 3367, base = `http://127.0.0.1:${port}`;
const ephemeral = fs.readFileSync("/proc/sys/net/ipv4/ip_local_port_range", "utf8").trim().split(/\s+/).map(Number);
assert(ephemeral.length === 2 && ephemeral.every(Number.isInteger), "Expected Linux ephemeral port range");
assert(port < ephemeral[0] || port > ephemeral[1], "Fixture listener must not overlap client ephemeral ports");
const out = path.resolve("test-artifacts/webkit-workspace"), fixturePath = path.resolve("tests/.runtime/visual-review-current.json");
const provenance = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  runId: process.env.GITHUB_RUN_ID || null,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
};
if (process.env.GITHUB_ACTIONS === "true") {
  assert.equal(provenance.commit, process.env.GITHUB_SHA, "Evidence must identify the tested checkout");
  assert(provenance.runId && provenance.runAttempt, "CI evidence requires run and attempt");
}
fs.mkdirSync(out, { recursive: true }); fs.rmSync(fixturePath, { force: true });
const server = spawn(process.execPath, ["tests/visual-review-server.mjs"], {
  env: { ...process.env, REVIEW_PORT: String(port), REVIEW_DEV: "0", WA_PROVIDER: "manual" },
  detached: true, stdio: ["ignore", "pipe", "pipe"],
});
let logs = "", spawnError = "", browser, page;
const report = { provenance, scope: "Linux WebKit desktop and iPhone 13 emulation; not real-device Safari", engine: null, version: null, scenarios: [], errors: [], blockedRequests: [], passed: false };
server.stdout.on("data", value => logs += value); server.stderr.on("data", value => logs += value);
server.on("error", error => { spawnError = String(error); });
async function focused(locator) {
  const handle = await locator.elementHandle(); assert(handle, "Focus target must exist");
  try { await page.waitForFunction(element => document.activeElement === element, handle, { timeout: 5000 }); }
  finally { await handle.dispose(); }
}
async function screenshot(name) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: no horizontal overflow`);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: false, animations: "disabled", timeout: 5000 });
}
async function openMobileDrawer() {
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.waitForFunction(() => {
    const node = document.querySelector('#workspace-navigation[data-drawer="open"]');
    if (!node) return false;
    const box = node.getBoundingClientRect(), transform = getComputedStyle(node).transform;
    return box.left >= -0.5 && box.right <= innerWidth + 0.5 && box.width > 200 && (transform === "none" || Math.abs(new DOMMatrixReadOnly(transform).m41) < 0.5);
  }, undefined, { timeout: 5000 });
  return page.getByRole("dialog", { name: "Workspace navigation", exact: true });
}
await withFixtureCleanup(async () => {
 try {
  await within((async () => {
  let fixture;
  for (let attempt = 0; attempt < 160; attempt++) {
    assert(!spawnError && server.exitCode === null && server.signalCode === null, `Owned fixture exited before readiness: ${spawnError}\n${logs}`);
    if (logs.includes("VISUAL REVIEW READY") && fs.existsSync(fixturePath)) { fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")); break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(fixture, logs); assert.equal(fixture.base, base); assert(Number.isInteger(fixture.serverPid));
  browser = await webkit.launch({ headless: true, timeout: 30000 });
  assert.equal(browser.browserType().name(), "webkit", "Never substitute Chromium for this engine gate");
  report.engine = browser.browserType().name(); report.version = browser.version();
  const iphone = devices["iPhone 13"]; assert(iphone && iphone.defaultBrowserType === "webkit");
  for (const [name, options] of [["desktop", { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 }], ["iphone-emulation", iphone]]) {
    const context = await within(browser.newContext({ ...options, serviceWorkers: "block" }), 30000, "WebKit context creation");
    context.setDefaultTimeout(30000); context.setDefaultNavigationTimeout(30000);
    await context.route("**/*", route => {
      if (new URL(route.request().url()).origin === base) return route.continue();
      const url = new URL(route.request().url()); report.blockedRequests.push({ scenario: name, origin: url.origin, pathname: url.pathname });
      return route.abort("blockedbyclient");
    });
    await context.routeWebSocket("**/*", socket => {
      const url = new URL(socket.url()); report.blockedRequests.push({ scenario: name, origin: url.origin, pathname: url.pathname, transport: "websocket" });
      return socket.close({ code: 1008, reason: "No WebSockets in this isolated smoke" });
    });
    page = await within(context.newPage(), 30000, "WebKit page creation"); page.on("pageerror", error => report.errors.push({ scenario: name, message: error.message }));
    await page.goto(base + "/dashboard"); await page.waitForURL("**/login**");
    await page.getByLabel("Work email", { exact: true }).fill("review@visual.test");
    await page.getByLabel("Password", { exact: true }).fill("Review-Visual-2026!");
    await page.getByRole("button", { name: "Sign in to workspace", exact: true }).click();
    await page.waitForURL("**/dashboard"); await page.locator("main h1").waitFor();
    // Route headings can precede client data. Require the actual seeded record, not a skeleton.
    await page.locator(`main .attention-row a[href="/ticketing/${fixture.bookingId}"]:visible`).waitFor();
    await screenshot(`${name}-dashboard`);
    const mobile = name === "iphone-emulation";
    const navigation = mobile ? await openMobileDrawer() : page.locator("#workspace-navigation");
    const customer = navigation.getByRole("link", { name: "Customers", exact: true });
    const reachable = await customer.evaluate(node => { const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { top: r.top, bottom: r.bottom, height: innerHeight, hit: node === hit || node.contains(hit) }; });
    assert(reachable.hit && reachable.top >= 0 && reachable.bottom <= reachable.height, "Customer navigation must be genuinely pointer-reachable");
    if (mobile) await screenshot(`${name}-navigation`);
    await customer.click(); await page.waitForURL("**/customers");
    if (mobile) await page.locator("#workspace-navigation").waitFor({ state: "hidden" });
    const seededCustomer = page.locator(`main a[href="/customers/${fixture.customerId}"]:visible`).filter({ hasText: "Meera Sharma" });
    await seededCustomer.waitFor();
    assert((await seededCustomer.innerText()).includes("Meera Sharma"), "Seeded customer content must render before capture");
    await screenshot(`${name}-customers`);
    await seededCustomer.click(); await page.waitForURL(`**/customers/${fixture.customerId}`);
    const identity = page.getByRole("region", { name: "Customer record", exact: true });
    await identity.getByRole("heading", { name: "Meera Sharma", exact: true }).waitFor();
    assert((await identity.innerText()).includes("meera@example.test"), "Actual customer identity email must render");
    assert((await identity.innerText()).includes("+919812345678"), "Actual customer identity phone must render");
    await screenshot(`${name}-customer-detail`);

    const reportReads = [];
    const captureReportRead = request => {
      const url = new URL(request.url());
      if (url.origin === base && url.pathname === "/api/reports/accounts" && !url.searchParams.has("options")) reportReads.push(url);
    };
    page.on("request", captureReportRead);
    await identity.getByRole("link", { name: "Customer statement", exact: true }).click();
    await page.waitForURL("**/reports?**");
    // Use the associated accessible name; raw wrapping-label text includes every option.
    const customerFilter = page.locator("#report-filters").getByRole("combobox", { name: "Customer *", exact: true });
    const apply = page.getByRole("button", { name: "Apply report filters", exact: true });
    await apply.waitFor();
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("button")].find(button => button.textContent === "Apply report filters");
      return button && !button.disabled;
    });
    assert.equal(await customerFilter.inputValue(), fixture.customerId, "Customer detail link must preserve identity scope");
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await customerFilter.selectOption("");
    // Observe real native validation without calling checkValidity/reportValidity ourselves.
    await page.locator("#report-filters").evaluate(form => {
      window.__webkitReportEvents = { invalid: 0, submits: 0 };
      form.addEventListener("invalid", () => window.__webkitReportEvents.invalid++, true);
      form.addEventListener("submit", () => window.__webkitReportEvents.submits++);
    });
    await apply.click();
    await focused(customerFilter);
    assert(await customerFilter.evaluate(node => node.required && node.validity.valueMissing));
    assert.deepEqual(await page.evaluate(() => window.__webkitReportEvents), { invalid: 1, submits: 0 });
    await screenshot(`${name}-report-native-validation`);
    assert.equal(reportReads.length, 0, "Invalid lower Apply must make zero report reads");

    await customerFilter.selectOption(fixture.customerId);
    const appliedDates = { from: await page.getByLabel("From", { exact: true }).inputValue(), to: await page.getByLabel("Through", { exact: true }).inputValue() };
    const responsePromise = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === base && url.pathname === "/api/reports/accounts" && url.searchParams.get("report") === "statement" && !url.searchParams.has("options");
    });
    await apply.focus(); await apply.press("Enter");
    const response = await responsePromise; assert(response.ok(), "Scoped statement response must succeed");
    const statement = await response.json();
    const applied = page.getByRole("region", { name: "Applied report filters", exact: true });
    await applied.getByRole("heading", { name: "Meera Sharma", exact: true }).waitFor();
    assert.equal(statement.party.name, "Meera Sharma");
    assert.deepEqual(statement.period, appliedDates, "Rendered statement must use the applied India-calendar dates");
    assert.equal(statement.summary.find(item => item.label === "Closing balance")?.value, 81400, "Fixture: visa 10,000 + flight 40,000 + hotel 48,900 + invoice 2,500 - receipt 20,000");
    assert.equal(await page.locator(".report-summary section").filter({ has: page.getByRole("heading", { name: "Closing balance", exact: true }) }).locator("p").innerText(), "₹81,400");
    assert.deepEqual(await page.evaluate(() => window.__webkitReportEvents), { invalid: 1, submits: 1 });
    assert.equal(reportReads.length, 1, "Valid keyboard activation must issue exactly one report query");
    assert.equal(reportReads[0].searchParams.get("customerId"), fixture.customerId);
    assert.equal(reportReads[0].searchParams.get("from"), appliedDates.from);
    assert.equal(reportReads[0].searchParams.get("to"), appliedDates.to);
    assert.equal(reportReads[0].searchParams.get("page"), "1");
    const exports = {};
    for (const format of ["csv", "xlsx", "pdf"]) {
      const href = await applied.getByRole("link", { name: `Download ${format.toUpperCase()}`, exact: true }).getAttribute("href");
      const url = new URL(href, base);
      const expected = new URLSearchParams(reportReads[0].searchParams); expected.delete("page"); expected.set("format", format);
      assert.equal(url.origin, base); assert.equal(url.pathname, "/api/reports/accounts");
      assert.deepEqual([...url.searchParams].sort(), [...expected].sort(), "Export links must reflect applied query, not draft controls");
      exports[format] = href;
    }
    await applied.scrollIntoViewIfNeeded(); await screenshot(`${name}-report-applied`);
    await page.getByRole("heading", { name: "Closing balance", exact: true }).scrollIntoViewIfNeeded();
    await screenshot(`${name}-report-closing-balance`);
    const otherCustomer = await customerFilter.locator("option").evaluateAll(options => options.find(option => option.value && option.textContent.includes("Arjun Mehta"))?.value);
    assert(otherCustomer && otherCustomer !== fixture.customerId);
    await customerFilter.selectOption(otherCustomer);
    await page.getByText("Filter changes not applied. Results, pages and downloads still use the applied filters below.", { exact: true }).waitFor();
    assert.equal(await applied.getByRole("heading").innerText(), "Meera Sharma");
    for (const [format, href] of Object.entries(exports)) assert.equal(await applied.getByRole("link", { name: `Download ${format.toUpperCase()}`, exact: true }).getAttribute("href"), href);
    await page.getByRole("button", { name: "Restore applied filters", exact: true }).scrollIntoViewIfNeeded();
    await screenshot(`${name}-report-unapplied`);
    await page.getByRole("button", { name: "Restore applied filters", exact: true }).click();
    assert.equal(await customerFilter.inputValue(), fixture.customerId);
    assert.equal(reportReads.length, 1, "Draft changes and restore must not query reports");
    page.off("request", captureReportRead);
    const reportProof = { nativeInvalidEvents: 1, invalidReportReads: 0, validKeyboardReportReads: reportReads.length, customerId: fixture.customerId, closingBalance: statement.summary.find(item => item.label === "Closing balance").value, appliedDates, exports, draftPreservedAppliedExports: true };
    const menu = mobile ? await openMobileDrawer() : navigation;
    const manage = menu.getByRole("button", { name: "Catalogue", exact: true });
    if (await manage.getAttribute("aria-expanded") === "false") await manage.click();
    await menu.getByRole("link", { name: "Travel packages", exact: true }).click(); await page.waitForURL("**/travel-packages");
    if (mobile) await page.locator("#workspace-navigation").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "+ Create package", exact: true }).click();
    const heading = page.getByRole("heading", { name: "New package", exact: true });
    await focused(heading);
    // Do not focus/scroll these targets from the test: this verifies the application's handoff.
    const geometry = await page.evaluate(() => {
      const heading = document.querySelector('section[aria-label="Package editor"] h2');
      const title = [...document.querySelectorAll("label")].find(label => label.textContent?.trim() === "Package title")?.querySelector("input");
      const box = element => { const r = element?.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom } : null; };
      return { heading: box(heading), firstField: box(title), width: innerWidth, height: innerHeight, headingFocused: document.activeElement === heading, userAgent: navigator.userAgent };
    });
    for (const target of [geometry.heading, geometry.firstField]) assert(target && target.top >= 64 && target.bottom <= geometry.height, "Editor heading and first field must be visible without test scrolling");
    assert(geometry.headingFocused); report.scenarios.push({ name, geometry, navigation: reachable, settledFixtureContent: { dashboardBooking: true, customer: true, customerIdentity: true }, reportProof });
    await screenshot(`${name}-package-editor`);
    await page.getByLabel("Package title", { exact: true }).fill("Synthetic WebKit draft; not published");
    page.once("dialog", dialog => dialog.dismiss()); await page.getByRole("button", { name: "Close editor", exact: true }).click();
    assert(await heading.isVisible(), "Dismissing discard preserves the editor");
    assert.equal(await page.getByLabel("Package title", { exact: true }).inputValue(), "Synthetic WebKit draft; not published");
    page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Close editor", exact: true }).click();
    await heading.waitFor({ state: "hidden" }); await focused(page.getByRole("button", { name: "+ Create package", exact: true }));
    await within(context.close(), 3000, "WebKit context close"); page = undefined;
  }
  assert.deepEqual(report.errors, [], "No client runtime errors");
  assert.deepEqual(report.blockedRequests, [], "No unexpected external browser traffic");
  if (!report.failure) report.passed = true;
  console.log("Linux WebKit desktop + iPhone emulation: synthetic auth, real customer identity, native report validation, scoped statement/export filters, editor handoff and discard guards passed.");
  })(), 240000, "complete WebKit fixture smoke");
 } catch (error) {
  report.failure = String(error);
  try { persistEvidence(); } catch (writeError) { console.error("Could not persist original failure evidence:", writeError); }
  // Original failure survives even if screenshot or browser protocol is stalled.
  if (page) await within(page.screenshot({ path: path.join(out, "failure.png"), fullPage: false, timeout: 3000 }), 3000, "WebKit failure screenshot").catch(() => {});
  throw error;
 }
}, async () => {
  persistEvidence();
  const cleanupErrors = [];
  if (browser) try { await within(browser.close(), 3000, "WebKit browser close"); } catch (error) { cleanupErrors.push(error); }
  // Signal only the detached process group created above, including its nested Next server.
  if (server.pid) {
    const signal = value => { try { process.kill(-server.pid, value); return true; } catch (error) { if (error.code === "ESRCH") return false; throw error; } };
    const waitGone = async milliseconds => {
      const deadline = Date.now() + milliseconds;
      while (Date.now() < deadline) { if (!signal(0)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
      if (signal(0)) throw Error("Owned fixture process group did not exit within its cleanup deadline");
    };
    try {
      if (signal("SIGTERM")) {
        try { await within(waitGone(3000), 3500, "fixture process group SIGTERM"); }
        catch (error) {
          if (error?.code && error.code !== "ESRCH") throw error;
          signal("SIGKILL"); await within(waitGone(2000), 2500, "fixture process group SIGKILL");
        }
      }
    } catch (error) { cleanupErrors.push(error); }
  }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "WebKit fixture cleanup incomplete");
}, error => {
  report.passed = false; report.cleanupFailure = String(error); persistEvidence(); console.error("WebKit cleanup failure:", error);
});

function persistEvidence() {
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(out, "server.log"), logs);
}
