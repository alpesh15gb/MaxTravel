// CI-only visual evidence. The same script + synthetic fixture server are run on pinned core
// and the candidate. No live origin, real customer data, or external services are used.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "./browser.mjs";
const root = process.cwd(), port = 3358, label = process.env.STUDIO_LABEL ?? "candidate";
assert(["before", "after", "candidate"].includes(label));
const out = path.resolve("test-artifacts/studio", label), fixturePath = path.resolve("tests/.runtime/visual-review-current.json");
fs.mkdirSync(out, { recursive: true }); fs.rmSync(fixturePath, { force: true });
const server = spawn(process.execPath, ["tests/visual-review-server.mjs"], { cwd: root, env: { ...process.env, REVIEW_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
let logs = "", browser; server.stdout.on("data", d => logs += d); server.stderr.on("data", d => logs += d);
const measurements = [], browserErrors = [];
try {
  let fixture;
  for (let i = 0; i < 160; i++) { if (server.exitCode !== null) throw Error(logs); if (fs.existsSync(fixturePath) && logs.includes("VISUAL REVIEW READY")) { fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")); break; } await new Promise(r => setTimeout(r, 500)); }
  assert(fixture, logs); const base = fixture.base; assert.equal(base, `http://127.0.0.1:${port}`);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage(); page.on("pageerror", e => browserErrors.push(e.message));
  await page.goto(base + "/login"); await page.getByLabel("Work email", { exact: true }).fill("review@visual.test"); await page.getByLabel("Password", { exact: true }).fill("Review-Visual-2026!"); await page.getByRole("button", { name: "Sign in to workspace", exact: true }).click(); await page.waitForURL("**/dashboard");
  const routes = [["dashboard", "/dashboard"], ["customers", "/customers"], ["customer-detail", `/customers/${fixture.customerId}`], ["ticketing", "/ticketing"], ["booking-detail", `/ticketing/${fixture.bookingId}`], ["visa", "/visa"], ["visa-detail", `/visa/${fixture.visaCaseId}`], ["documents", "/documents"], ["payments", "/payments"], ["reports", "/reports"], ["sales", "/sales"], ["packages", "/travel-packages"]];
  for (const [viewport, width, height] of [["desktop", 1440, 1000], ["tablet", 1024, 900], ["mobile", 390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const [name, route] of routes) {
      const response = await page.goto(base + route, { waitUntil: "networkidle" }); assert(response?.ok(), `${route}: ${response?.status()}`);
      await page.screenshot({ path: path.join(out, `${viewport}-${name}.png`), fullPage: false });
      const geometry = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth + 1, width: window.innerWidth, mainLeft: document.querySelector("main")?.getBoundingClientRect().left, heading: document.querySelector("main h1")?.textContent, primaryCount: document.querySelectorAll("main .btn-primary").length }));
      measurements.push({ viewport, route, ...geometry });
    }
    await page.getByRole("button", { name: "+ Create package", exact: true }).click(); await page.getByLabel("Package title", { exact: true }).fill("Kerala, at your own pace"); await page.getByLabel("Destination / region", { exact: true }).fill("Kerala, India");
    await page.locator('section[aria-label="Package editor"]').evaluate(el => window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 100 }));
    if (width === 390) assert.equal(await page.locator("#workspace-navigation").isVisible(), false, "Closed mobile drawer must stay hidden");
    await page.screenshot({ path: path.join(out, `${viewport}-package-editor.png`), fullPage: false });
    await page.getByLabel("Internal notes — never published", { exact: false }).focus();
    await page.screenshot({ path: path.join(out, `${viewport}-package-editor-save.png`), fullPage: false });
    const fieldGeometry = await page.getByLabel("Internal notes — never published", { exact: false }).evaluate(el => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom, focused: document.activeElement === el }));
    assert(fieldGeometry.focused && fieldGeometry.top >= 0 && fieldGeometry.top < height, "Last draft field remains visibly focusable");
    page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Close editor", exact: true }).click();
    if (width === 390) {
      await page.getByRole("button", { name: "Open navigation", exact: true }).click();
      const drawer = page.getByRole("dialog", { name: "Workspace navigation" }); assert(await drawer.isVisible());
      await page.waitForFunction(() => { const node = document.querySelector('#workspace-navigation[data-drawer="open"]'); if (!node) return false; const box = node.getBoundingClientRect(); const transform = getComputedStyle(node).transform; return box.width > 200 && box.left >= -0.5 && box.right <= innerWidth + 0.5 && (transform === "none" || Math.abs(new DOMMatrixReadOnly(transform).m41) < 0.5); });
      const customerLink = drawer.getByRole("link", { name: "Customers", exact: true });
      assert(await customerLink.isVisible());
      const navGeometry = await customerLink.evaluate(node => { const r = node.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:innerWidth, height:innerHeight, pointerReachable:node === hit || node.contains(hit) }; });
      assert(navGeometry.pointerReachable && navGeometry.top >= 0 && navGeometry.bottom <= height, "Visible menu link must be inside viewport and unobscured");
      fs.writeFileSync(path.join(out, "mobile-navigation-geometry.json"), JSON.stringify(navGeometry, null, 2));
      await page.screenshot({ path: path.join(out, "mobile-navigation.png"), fullPage: false });
      await customerLink.click(); await page.waitForURL("**/customers");
      await page.locator("#workspace-navigation").waitFor({ state:"hidden" });
      assert.equal(await page.locator("#workspace-navigation").isVisible(), false, "Real navigation closes the mobile drawer");
      await page.getByRole("button", { name: "Open navigation", exact: true }).click();
      const groupToggle = drawer.getByRole("button", { name: "Daily work", exact: true });
      if (await groupToggle.count()) {
        await groupToggle.click(); assert.equal(await groupToggle.getAttribute("aria-expanded"), "false");
        assert.equal(await groupToggle.evaluate(el => document.activeElement === el), true, "Collapsing a nav group retains focus");
        await groupToggle.click(); await page.keyboard.press("Tab");
        assert.equal(await drawer.evaluate(el => el.contains(document.activeElement)), true, "Drawer keyboard focus stays inside");
      }
      // Both the old and new nav must retain keyboard dismissal and focus restoration.
      await page.keyboard.press("Escape"); assert.equal(await page.getByRole("button", { name: "Open navigation", exact: true }).evaluate(el => document.activeElement === el), true);
    }
  }
  fs.writeFileSync(path.join(out, "measurements.json"), JSON.stringify({ label, measurements, browserErrors }, null, 2));
  assert.deepEqual(browserErrors, [], "No client runtime errors during visual route coverage");
  assert(!measurements.some(m => m.overflow), "A captured route overflows its viewport; inspect measurements.json and PNGs");
  console.log(`Studio ${label}: ${measurements.length} route/viewport screenshots plus editor and navigation captured.`);
} finally {
  fs.writeFileSync(path.join(out, "server.log"), logs); await browser?.close();
  // The fixture harness owns the nested Next server; terminate both explicit fixture PIDs.
  if (fs.existsSync(fixturePath)) { const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")); if (fixture.serverPid) { try { process.kill(fixture.serverPid, "SIGTERM"); } catch {} } }
  server.kill("SIGTERM");
}
