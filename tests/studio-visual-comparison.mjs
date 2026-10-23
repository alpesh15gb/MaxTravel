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
const measurements = [], browserErrors = [], responsiveGeometry = [];
const persistResponsive = () => fs.writeFileSync(path.join(out, "responsive-controls-geometry.json"), JSON.stringify({ label, checks: responsiveGeometry }, null, 2));
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
  // Candidate-only regression gate; the baseline intentionally retains the observed defects.
  if (label !== "before") for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.goto(base + "/payments", { waitUntil: "networkidle" });
    await page.getByRole("region", { name: "Payment overview", exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const value = page.locator(".payments-summary .stat-value").first();
    const original = await value.innerText();
    for (const sample of ["actual", "large-inr"]) {
      if (sample === "large-inr") await value.evaluate(node => { node.textContent = "₹90,07,19,92,54,740.91"; }); // DOM-only layout stress: no finance writes/calculations.
      const geometry = await page.locator(".payments-summary").evaluate(strip => {
        const box = node => { const r = node.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom }; };
        return { viewport:innerWidth, scrollWidth:document.documentElement.scrollWidth, cards:[...strip.querySelectorAll(".stat-card")].map(card => {
          const style = getComputedStyle(card), value = card.querySelector(".stat-value"), range = document.createRange(); range.selectNodeContents(value);
          return { card:box(card), padding:{left:parseFloat(style.paddingLeft),right:parseFloat(style.paddingRight),bottom:parseFloat(style.paddingBottom)}, text:value.textContent, textRects:[...range.getClientRects()].map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom})) };
        }) };
      });
      responsiveGeometry.push({ name:`payment-kpi-${width}-${sample}`, ...geometry }); persistResponsive();
      await page.screenshot({ path:path.join(out, `payment-kpi-${width}-${sample}.png`), animations:"disabled" });
      assert.equal(geometry.cards.length, 3); assert(geometry.scrollWidth <= width + 1, "Payment KPI never overflows the viewport");
      for (const item of geometry.cards) for (const text of item.textRects) {
        assert(text.left >= item.card.left + item.padding.left - 1 && text.right <= item.card.right - item.padding.right + 1, "Complete KPI text stays inside its own padded card, away from adjacent values");
        assert(text.bottom <= item.card.bottom - item.padding.bottom + 1, "Wrapped INR remains fully visible, not clipped");
      }
      if (width === 1440) assert(geometry.cards.every(item => Math.abs(item.card.top - geometry.cards[0].card.top) < 1), "Desktop keeps three KPI cards on one row");
    }
    await value.evaluate((node, text) => { node.textContent = text; }, original);
    assert.equal(await value.innerText(), original, "Layout stress never changes the application total");
    await page.goto(base + "/sales", { waitUntil: "networkidle" });
    await page.getByLabel("Filter by stage", { exact:true }).waitFor(); await page.evaluate(() => document.fonts.ready);
    const geometry = await page.locator(".sales-toolbar").evaluate(toolbar => {
      const box = node => { const r = node.getBoundingClientRect(); return { left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height }; };
      const select = toolbar.querySelector("select"), style = getComputedStyle(select), canvas = document.createElement("canvas"), context = canvas.getContext("2d");
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      return { viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,select:box(select),selected:select.selectedOptions[0].textContent,
        textWidth:Math.max(...[...select.options].map(option=>context.measureText(option.textContent).width)),
        availableTextWidth:select.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)-24,
        controls:[...toolbar.querySelectorAll("input,select,button")].map(node=>({name:node.getAttribute("aria-label")||node.textContent||node.id,...box(node)})) };
    });
    responsiveGeometry.push({ name:`sales-toolbar-${width}`, ...geometry }); persistResponsive();
    await page.screenshot({ path:path.join(out, `sales-toolbar-${width}.png`), animations:"disabled" });
    assert.equal(geometry.selected, "All stages");
    assert(geometry.textWidth <= geometry.availableTextWidth, "All stage option text fits alongside native select arrow");
    assert(geometry.scrollWidth <= width + 1, "Sales toolbar never overflows the viewport");
    for (const control of geometry.controls) {
      assert(control.left >= 0 && control.right <= width && control.height >= 40, "Every labelled toolbar control stays usable inside viewport");
      for (const other of geometry.controls) if (control !== other) assert(!(control.left < other.right-1 && control.right > other.left+1 && control.top < other.bottom-1 && control.bottom > other.top+1), "Toolbar controls wrap rather than overlap");
    }
    await page.getByRole("button", { name:"Search all enquiries", exact:true }).waitFor();
    await page.getByRole("button", { name:"Refresh records", exact:true }).waitFor();
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
