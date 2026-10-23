// Synthetic loopback-only task-first workspace checks; no deployed origin or customer records.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "./browser.mjs";
const port = 3362, out = path.resolve("test-artifacts/mobile-workspace");
const fixturePath = path.resolve("tests/.runtime/visual-review-current.json");
fs.mkdirSync(out, { recursive: true }); fs.rmSync(fixturePath, { force: true });
const server = spawn(process.execPath, ["tests/visual-review-server.mjs"], { env: { ...process.env, REVIEW_PORT: String(port), WA_PROVIDER: "manual" }, stdio: ["ignore", "pipe", "pipe"] });
let logs = "", browser, page; const errors = [], geometry = [];
server.stdout.on("data", data => logs += data); server.stderr.on("data", data => logs += data);
try {
  let fixture;
  for (let attempt = 0; attempt < 160; attempt++) { if (server.exitCode !== null) throw Error(logs); if (logs.includes("VISUAL REVIEW READY") && fs.existsSync(fixturePath)) { fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")); break; } await new Promise(resolve => setTimeout(resolve, 500)); }
  assert(fixture, logs); assert.equal(fixture.base, `http://127.0.0.1:${port}`);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.on("pageerror", error => errors.push(error.message));
  await page.goto(fixture.base + "/login"); await page.getByLabel("Work email", { exact: true }).fill("review@visual.test"); await page.getByLabel("Password", { exact: true }).fill("Review-Visual-2026!"); await page.getByRole("button", { name: "Sign in to workspace", exact: true }).click(); await page.waitForURL("**/dashboard");
  async function capture(name) {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${name} must not overflow`);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
  }
  for (const [width, height] of [[390, 844], [1024, 900], [1440, 1000]]) {
    await page.setViewportSize({ width, height }); await page.goto(fixture.base + "/dashboard");
    const first = page.locator(".attention-row").first(); await first.waitFor();
    const action = await first.locator(".attention-actions > button").count() ? first.locator(".attention-actions > button").first() : first.locator(".attention-record-content > a");
    const box = await action.boundingBox(); geometry.push({ viewport: width, firstAction: box }); await capture(`dashboard-${width}`);
    assert(box && box.y >= 0 && box.y + box.height <= height, `First priority action must be visible initially at ${width}px: ${JSON.stringify(box)}`);
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(fixture.base + "/dashboard");
  const breakdown = page.locator(".kpi-mobile-breakdown"); await breakdown.locator("summary").click(); assert(await breakdown.locator("p").isVisible()); await capture("dashboard-breakdown-open"); await breakdown.locator("summary").click();
  async function assertFocused(locator) {
    const handle = await locator.elementHandle(); assert(handle, "Expected focus target to exist");
    try { await page.waitForFunction(el => document.activeElement === el, handle, { timeout: 3000 }); }
    finally { await handle.dispose(); }
    assert(await locator.evaluate(el => document.activeElement === el), "Focus must reach the intended control");
  }
  const trigger = page.getByRole("button", { name: "Search your workspace", exact: true }); const search = page.getByRole("combobox", { name: "Search your workspace", exact: true });
  assert.equal(await search.isVisible(), false); const triggerBox = await trigger.boundingBox(); assert(triggerBox.width >= 44 && triggerBox.height >= 44);
  await trigger.click(); await search.waitFor(); await assertFocused(search); await search.fill("Meera"); await page.locator("#workspace-search-results").getByRole("button", { name: /Meera/ }).first().waitFor(); await capture("search-mobile");
  await search.press("Escape"); await search.waitFor({ state: "hidden" }); assert.equal(await search.isVisible(), false); await assertFocused(trigger);
  await page.keyboard.press("Control+k"); await search.waitFor(); await assertFocused(search); await page.getByRole("button", { name: "Close workspace search", exact: true }).click(); await assertFocused(trigger);
  await trigger.click(); await search.fill("Meera"); const result = page.locator("#workspace-search-results").getByRole("button", { name: /Meera/ }).first(); await result.waitFor();
  await Promise.all([page.waitForURL(url => url.pathname !== "/dashboard"), result.click()]); assert.equal(await page.getByRole("combobox", { name: "Search your workspace", exact: true }).isVisible(), false, "Choosing a result closes the mobile panel");
  await page.goto(fixture.base + "/customers");
  const filters = page.getByRole("button", { name: /^Filters & view/ }); assert.equal(await filters.getAttribute("aria-expanded"), "false");
  const firstCustomer = page.locator(".customer-mobile-cards").getByRole("link", { name: /Open customer/ }).first(); await firstCustomer.waitFor(); const customerBox = await firstCustomer.boundingBox(); geometry.push({ viewport: 390, firstCustomer: customerBox }); await capture("customers-mobile"); assert(customerBox && customerBox.y + customerBox.height <= 844, "First customer action must be in the initial mobile viewport");
  await capture("customers-mobile"); await filters.focus(); await filters.press("Enter"); assert.equal(await filters.getAttribute("aria-expanded"), "true");
  await page.getByRole("combobox", { name: "Customer type", exact: true }).selectOption("INDIVIDUAL"); await filters.click(); assert.equal(await filters.getAttribute("aria-expanded"), "false"); await page.getByLabel("Applied customer filters", { exact: true }).waitFor(); await capture("customers-filtered-mobile"); await page.getByRole("button", { name: "Clear filters", exact: true }).click(); assert(await page.getByRole("searchbox", { name: "Filter customers", exact: true }).evaluate(el => document.activeElement === el));
  await page.goto(fixture.base + "/reports"); const chooser = page.getByRole("combobox", { name: "Choose a report", exact: true }); await chooser.selectOption("receipts"); await page.getByRole("heading", { name: "Receipts & refunds", exact: true }).waitFor(); await capture("reports-mobile");
  await page.getByRole("button", { name: "Generate report", exact: true }).click(); await page.getByRole("list", { name: "Report record cards", exact: true }).waitFor(); await capture("reports-generated-mobile");
  await page.setViewportSize({ width: 1440, height: 1000 }); assert.equal(await page.getByRole("button", { name: "Receipts & refunds", exact: true }).getAttribute("aria-pressed"), "true");
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(fixture.base + "/travel-packages"); await page.getByText("Your next great trip starts here", { exact: true }).waitFor(); await capture("packages-mobile");
  await page.getByRole("button", { name: "+ Create package", exact: true }).click(); assert(await page.getByRole("button", { name: "+ Create package", exact: true }).evaluate(el => el.classList.contains("btn-secondary"))); assert(await page.getByRole("button", { name: "Save draft", exact: true }).evaluate(el => el.classList.contains("btn-primary"))); const editorHeading = page.getByRole("heading", { name: "New package", exact: true }); await assertFocused(editorHeading); const editorBox = await editorHeading.boundingBox(); geometry.push({ editorHeading: editorBox }); assert(editorBox && editorBox.y >= 64 && editorBox.y + editorBox.height < 844, "New editor heading must be visible after Create"); const firstEditorField = await page.getByLabel("Package title", { exact: true }).boundingBox(); geometry.push({ firstEditorField }); assert(firstEditorField && firstEditorField.y >= 64 && firstEditorField.y + firstEditorField.height <= 844, "First editor field must be visible after Create without a test-driven scroll"); await capture("package-editor-mobile");
  assert.deepEqual(errors, []); console.log("Mobile workspace: visible priority/customer actions, compact KPIs, breakdown disclosure, search focus/escape, applied-filter visibility, report state, editor CTA hierarchy and viewport bounds passed.");
} finally {
  fs.writeFileSync(path.join(out, "server.log"), logs); fs.writeFileSync(path.join(out, "geometry.json"), JSON.stringify({ geometry, errors }, null, 2));
  await page?.screenshot({ path: path.join(out, "terminal-state.png") }).catch(() => {});
  await browser?.close(); server.kill("SIGTERM"); await new Promise(resolve => server.exitCode !== null ? resolve() : server.once("exit", resolve));
}
