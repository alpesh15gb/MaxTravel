// Run after visual-review-server.mjs; never targets live data.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "./browser.mjs";
const fixture = JSON.parse(fs.readFileSync("tests/.runtime/visual-review-current.json", "utf8"));
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.base), "Review must use an isolated loopback server");
assert(path.resolve(fixture.runtime).startsWith(path.resolve("tests/.runtime") + path.sep), "Review fixture must be isolated");
const out = path.resolve("test-artifacts/responsive-review");
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL: fixture.base });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const results = [];
let errors = [];
page.on("pageerror", e => errors.push(`Page error: ${e.message}`));
page.on("console", m => { if (m.type() === "error") errors.push(`Console: ${m.text()}`); });
page.on("response", r => { if (r.status() >= 400 && new URL(r.url()).origin === fixture.base) errors.push(`HTTP ${r.status()}: ${new URL(r.url()).pathname}`); });
async function check(name, action) {
  errors = [];
  try {
    const details = await action();
    assert.deepEqual(errors, [], errors.join("\n"));
    results.push({ name, status: "PASS", ...details });
    console.log(`PASS ${name}`);
  } catch (e) {
    results.push({ name, status: "FAIL", error: e.message, browserErrors: errors });
    console.log(`FAIL ${name}: ${e.message.slice(0, 500)}`);
  }
}
async function go(route) {
  const response = await page.goto(route, { waitUntil: "domcontentloaded" });
  assert(response?.ok(), `${route}: HTTP ${response?.status()}`);
  await page.locator("main").waitFor();
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}
async function layout() {
  await page.getByRole("main").getByRole("heading").first().waitFor({ state: "visible" });
  const result = await page.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
    heading: [...document.querySelectorAll("main h1, main h2")].find(el => el.getBoundingClientRect().width > 0)?.textContent ?? "",
    text: document.querySelector("main")?.textContent ?? "",
    overflowing: [...document.querySelectorAll("main *")].filter(el => {
      const r = el.getBoundingClientRect();
      if (r.right <= innerWidth + 2 || r.width === 0) return false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (["auto", "scroll", "hidden", "clip"].includes(getComputedStyle(p).overflowX)) return false;
      }
      return true;
    }).slice(0, 8).map(el => ({ tag: el.tagName, class: el.className, text: el.textContent?.slice(0, 60) })),
  }));
  assert(result.heading.trim(), "Page needs a visible heading");
  assert(!/Application error|Internal Server Error|Unhandled Runtime Error/.test(result.text), "Runtime error UI");
  assert(result.width <= result.viewport + 2, `Page overflow: ${JSON.stringify(result)}`);
  assert.equal(result.overflowing.length, 0, `Uncontained overflow: ${JSON.stringify(result.overflowing)}`);
  return { heading: result.heading, viewport: result.viewport, documentWidth: result.width };
}
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  await check("Desktop login and complete sign-in", async () => {
    await go("/login");
    const details = await layout();
    await page.screenshot({ path: path.join(out, "desktop-login.png") });
    await page.getByLabel("Work email", { exact: true }).fill("review@visual.test");
    await page.getByLabel("Password", { exact: true }).fill("Review-Visual-2026!");
    await page.getByRole("button", { name: "Sign in to workspace", exact: true }).click();
    await page.waitForURL("**/dashboard", { waitUntil: "domcontentloaded" });
    return details;
  });
  const routes = [
    ["dashboard", "/dashboard"], ["customers", "/customers"],
    ["customer-detail", `/customers/${fixture.customerId}`], ["new-customer", "/customers?action=new"],
    ["visa", "/visa"], ["visa-detail", `/visa/${fixture.visaCaseId}`], ["new-visa", "/visa/new"],
    ["ticketing", "/ticketing"], ["booking-detail", `/ticketing/${fixture.bookingId}`], ["new-booking", "/ticketing/new"],
    ["documents", "/documents"], ["payments", "/payments"], ["refunds", "/refunds"],
    ["suppliers", "/suppliers"], ["tasks", "/tasks"], ["whatsapp", "/whatsapp"],
    ["team", "/employees"], ["checklists", "/checklists"], ["audit", "/audit"],
    ["settings", "/settings"], ["notifications", "/notifications"],
  ];
  for (const [size, width, height] of [["desktop", 1440, 900], ["tablet", 768, 1024], ["phone", 390, 844], ["small-phone", 320, 740]]) {
    await page.setViewportSize({ width, height });
    for (const [name, route] of routes) {
      await check(`${size}: ${name}`, async () => {
        await go(route);
        const details = await layout();
        const screenshot = `${size}-${name}.png`;
        await page.screenshot({ path: path.join(out, screenshot) });
        return { ...details, route, screenshot };
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await check("Desktop dashboard prioritizes work above the fold", async () => {
    await go("/dashboard");
    await page.getByRole("region", { name: "Attention queue", exact: true }).waitFor();
    const metrics = await page.evaluate(() => ({
      summaryHeight: document.querySelector('[aria-label="Agency summary"]').getBoundingClientRect().height,
      queueTop: document.querySelector('#attention').getBoundingClientRect().top,
      queueWidth: document.querySelector('#attention').getBoundingClientRect().width,
      navigationWidth: document.querySelector('aside.app-sidebar').getBoundingClientRect().width,
    }));
    assert(metrics.summaryHeight <= 120, `Summary must stay compact: ${JSON.stringify(metrics)}`);
    assert(metrics.queueTop < 300, `Work queue must lead the page: ${JSON.stringify(metrics)}`);
    assert(metrics.queueWidth > 650, "Queue should own most of the workspace");
    assert(metrics.navigationWidth <= 210, "Navigation must leave room for work");
    return metrics;
  });
  await check("Customer directory is list-first with board still available", async () => {
    await go("/customers");
    await page.getByRole("table").waitFor();
    assert.equal(await page.getByRole("button", { name: "List", exact: true }).getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await page.locator('[aria-label="Customers by status"]').waitFor();
    await page.getByRole("link", { name: "Meera Sharma", exact: true }).waitFor();
    return await layout();
  });
  await check("Customer identity has one primary action and reachable secondary tools", async () => {
    await go(`/customers/${fixture.customerId}`);
    const header = page.getByRole("region", { name: "Customer record", exact: true });
    assert.equal(await header.locator("button.btn-primary:visible").count(), 1, "Only Record payment should be emphasized");
    assert.equal(await header.getByRole("button", { name: "Create Task", exact: true }).isVisible(), false);
    await header.locator("summary").click();
    await header.getByRole("button", { name: "Create Task", exact: true }).click();
    await page.getByRole("dialog", { name: "Create task", exact: true }).waitFor();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await header.locator("details").getAttribute("open"), null, "Tools close after choosing an action");
    await page.getByRole("heading", { name: "Current work", exact: true }).waitFor();
    await page.getByRole("link", { name: /VC-2026-0001/ }).waitFor();
    await page.getByRole("button", { name: "View all", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Tasks", exact: true }).getAttribute("aria-pressed"), "true");
    return await layout();
  });
  await check("Visa document work is not displaced by the full stage history", async () => {
    await go(`/visa/${fixture.visaCaseId}`);
    const history = page.locator("details").filter({ has: page.locator("summary", { hasText: "Stage history" }) });
    assert.equal(await history.getAttribute("open"), null);
    await page.getByRole("heading", { name: "Documents & Checklist", exact: true }).waitFor();
    await history.locator("summary").click();
    assert(await history.getAttribute("open") !== null);
    return await layout();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await check("Phone dashboard starts the queue without tall KPI stacks", async () => {
    await go("/dashboard");
    const metrics = await page.evaluate(() => ({
      summaryHeight: document.querySelector('[aria-label="Agency summary"]').getBoundingClientRect().height,
      queueTop: document.querySelector('#attention').getBoundingClientRect().top,
    }));
    assert(metrics.summaryHeight < 180, `Phone summary must stay two compact rows: ${JSON.stringify(metrics)}`);
    assert(metrics.queueTop < 400, `Phone must show work early: ${JSON.stringify(metrics)}`);
    return metrics;
  });
  await check("Phone customer tools remain reachable and keyboard-dismissible", async () => {
    await go(`/customers/${fixture.customerId}`);
    const tools = page.locator("details.customer-tools");
    await tools.locator("summary").click();
    await page.getByRole("button", { name: "Share upload link", exact: true }).waitFor();
    const details = await layout();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const menu = await page.locator(".customer-tool-list").evaluate(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, viewport: innerWidth }));
      assert(menu.left >= 0 && menu.right <= menu.viewport, `Action menu must fit the phone: ${JSON.stringify(menu)}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await tools.locator("summary").press("Escape");
    assert.equal(await tools.getAttribute("open"), null);
    return details;
  });
  await check("Phone customer list and no-match search", async () => {
    await go("/customers");
    await page.getByRole("button", { name: "List", exact: true }).click();
    const details = await layout();
    await page.screenshot({ path: path.join(out, "phone-customer-list.png") });
    await page.getByLabel("Filter customers", { exact: true }).fill("zzzz-no-match");
    await page.getByText("No matching customers", { exact: true }).waitFor();
    return details;
  });
  await check("Phone visa list view", async () => {
    await go("/visa");
    await page.getByRole("button", { name: "List", exact: true }).click();
    const details = await layout();
    await page.screenshot({ path: path.join(out, "phone-visa-list.png") });
    return details;
  });
  await check("Phone task dialog", async () => {
    await go("/tasks");
    await page.getByRole("button", { name: "New task", exact: true }).click();
    await page.getByRole("dialog", { name: "New task", exact: true }).waitFor();
    const details = await layout();
    await page.screenshot({ path: path.join(out, "phone-task-dialog.png") });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    return details;
  });
  await check("Phone actual-ticket dialog", async () => {
    await go(`/ticketing/${fixture.bookingId}`);
    // The dialog is named by its visible heading, not by the button that opened it: this form moved
    // onto the shared <Modal>, which labels the native dialog with the heading it points at.
    await page.getByRole("button", { name: "Record actual tickets", exact: true }).click();
    await page.getByRole("dialog", { name: "Record airline-issued tickets", exact: true }).waitFor();
    const details = await layout();
    await page.screenshot({ path: path.join(out, "phone-ticket-dialog.png") });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    return details;
  });
  await check("Phone navigation drawer", async () => {
    await go("/dashboard");
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page.getByRole("link", { name: "Customers", exact: true }).click();
    await page.waitForURL("**/customers");
    await page.getByRole("button", { name: "Open navigation", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Open navigation", exact: true }).getAttribute("aria-expanded"), "false", "Navigation should close after selection");
    return await layout();
  });
  await check("Complete sign-out and phone login", async () => {
    await go("/dashboard");
    await page.getByRole("button", { name: "Account menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
    await page.waitForURL("**/login");
    await page.waitForLoadState("networkidle");
    const details = await layout();
    await page.screenshot({ path: path.join(out, "phone-login.png") });
    await page.goto("/dashboard");
    await page.waitForURL("**/login");
    return details;
  });
} finally {
  fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 2));
  const escaped = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  fs.writeFileSync(path.join(out, "gallery.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Travel OS visual review</title><style>body{font:15px system-ui;background:#f3f5f8;color:#172b42;padding:24px}h1{margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}figure{margin:0;background:white;border:1px solid #e4e9ef;border-radius:12px;padding:12px}img{width:100%;display:block}figcaption{font-weight:600;margin-bottom:12px}</style><h1>Travel OS · desktop and mobile review</h1><div class="grid">${results.filter(r => r.screenshot).map(r => `<figure><figcaption>${escaped(r.name)} · ${r.status}</figcaption><a href="${r.screenshot}"><img loading="lazy" src="${r.screenshot}" alt="${escaped(r.name)}"></a></figure>`).join("")}</div></html>`);
  await browser.close();
}
const passed = results.filter(r => r.status === "PASS").length;
console.log(`\n${passed}/${results.length} responsive browser checks passed`);
process.exitCode = passed === results.length ? 0 : 1;
