// Linux WebKit smoke with desktop/iPhone emulation, not physical iOS Safari certification.
// Uses only disposable visual-review fixtures and rejects all browser traffic outside loopback.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { webkit, devices } from "playwright";
import { within, withFixtureCleanup } from "./fixture-lifecycle.mjs";

assert.equal(process.platform, "linux", "This dedicated smoke is scoped to Linux WebKit");
const port = 3367, base = `http://127.0.0.1:${port}`;
const ephemeral = fs.readFileSync("/proc/sys/net/ipv4/ip_local_port_range", "utf8").trim().split(/\s+/).map(Number);
assert(ephemeral.length === 2 && ephemeral.every(Number.isInteger), "Expected Linux ephemeral port range");
assert(port < ephemeral[0] || port > ephemeral[1], "Fixture listener must not overlap client ephemeral ports");
const out = path.resolve("test-artifacts/webkit-workspace"), fixturePath = path.resolve("tests/.runtime/visual-review-current.json");
fs.mkdirSync(out, { recursive: true }); fs.rmSync(fixturePath, { force: true });
const server = spawn(process.execPath, ["tests/visual-review-server.mjs"], {
  env: { ...process.env, REVIEW_PORT: String(port), REVIEW_DEV: "0", WA_PROVIDER: "manual" },
  detached: true, stdio: ["ignore", "pipe", "pipe"],
});
let logs = "", spawnError = "", browser, page;
const report = { scope: "Linux WebKit desktop and iPhone 13 emulation; not real-device Safari", engine: null, version: null, scenarios: [], errors: [], blockedRequests: [], passed: false };
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
    const seededCustomer = page.locator(`main a[href="/customers/${fixture.customerId}"]:visible`);
    await seededCustomer.waitFor();
    assert((await seededCustomer.innerText()).includes("Meera Sharma"), "Seeded customer content must render before capture");
    await screenshot(`${name}-customers`);
    const menu = mobile ? await openMobileDrawer() : navigation;
    const manage = menu.getByRole("button", { name: "Manage", exact: true });
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
    assert(geometry.headingFocused); report.scenarios.push({ name, geometry, navigation: reachable, settledFixtureContent: { dashboardBooking: true, customer: true } });
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
  console.log("Linux WebKit desktop + iPhone emulation: synthetic auth, real navigation, editor handoff and discard guards passed.");
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
