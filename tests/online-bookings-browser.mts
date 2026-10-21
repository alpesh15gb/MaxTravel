import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";

/** Invoked by online-bookings-query.mts after its isolated >100-record fixture checks. */
export async function verifyOnlineBookingsUi(db: PrismaClient, databaseUrl: string, browserEnabled: boolean) {
  assert(databaseUrl.includes("online-bookings-fixture-"));
  const origin = "http://127.0.0.1:3259", output = resolve("test-artifacts/online-bookings");
  await mkdir(output, { recursive: true });
  const password = randomBytes(24).toString("hex");
  await db.role.update({ where: { id: "role" }, data: { key: "BRANCH_MANAGER" } });
  await db.user.update({ where: { id: "staff-a" }, data: { passwordHash: await bcrypt.hash(password, 10) } });
  await db.platformBookingLink.create({ data: { platformId: "synthetic-platform-id", bookingId: "booking-134", revision: 1, platformStatus: "CONFIRMED", supplierReference: "SYNTHETIC-134", documentsCurrent: false } });
  const env = { ...process.env, DATABASE_URL: databaseUrl, APP_ORIGIN: origin, JWT_SECRET: randomBytes(48).toString("hex"), WA_PROVIDER: "manual", CRM_REQUIRE_MFA: "false" };
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3259", "-H", "127.0.0.1"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let logs = ""; server.stdout.on("data", value => logs += value); server.stderr.on("data", value => logs += value);
  let browser: import("playwright").Browser | undefined;
  let page: import("playwright").Page | undefined;
  const navigationEvidence: unknown[] = [], responseReads: Promise<void>[] = [];
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (server.exitCode !== null) throw Error(logs);
      try { if ((await fetch(origin + "/api/health", { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch {}
      await new Promise(r => setTimeout(r, 250));
    }
    assert(ready, logs);
    const login = await fetch(origin + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ email: "a@example.test", password }) });
    assert.equal(login.status, 200); const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const load = async (query = "") => { const response = await fetch(origin + "/online-bookings" + query, { headers: { Cookie: cookie } }); assert.equal(response.status, 200); return (await response.text()).replaceAll("<!-- -->", ""); };
    let html = await load(); assert(html.includes("50 bookings")); assert(html.includes("Older bookings")); assert(!html.includes("ONLINE-OTHER</"));
    html = await load("?q=ONLINE-001"); assert(html.includes("ONLINE-001")); assert(html.includes("1 booking")); assert(!html.includes("ONLINE-OTHER</"));
    html = await load("?q=does-not-exist"); assert(html.includes("No matching online bookings"));
    html = await load("?cursor=%25"); assert(html.includes("These filters or page link are invalid"));
    console.log("PASS online queue HTTP: authenticated server rendering, old-record search, empty and malformed states");
    if (!browserEnabled) return;
    const { chromium } = await import("./browser.mjs");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: "tos_session", value: cookie.slice(cookie.indexOf("=") + 1), url: origin }]);
    await context.addInitScript(() => { for (const event of ["pagehide","pageshow","beforeunload"]) window.addEventListener(event, () => console.info("QUEUE_LIFECYCLE",event,Date.now(),location.pathname,location.search)); });
    page = await context.newPage(); const errors: string[] = [];
    page.on("console", message => { if (message.type() === "error" || message.text().startsWith("QUEUE_LIFECYCLE")) navigationEvidence.push({event:"console",at:Date.now(),type:message.type(),text:message.text().slice(0,1500)}); });
    page.on("framenavigated", frame => { if (frame === page!.mainFrame()) navigationEvidence.push({event:"navigation",at:Date.now(),url:frame.url()}); });
    page.on("requestfailed", request => { const url = new URL(request.url()); navigationEvidence.push({ event:"requestfailed", at:Date.now(), path:url.pathname, direction:url.searchParams.get("direction"), error:request.failure()?.errorText }); });
    page.on("response", response => { const url = new URL(response.url()); if (url.pathname !== "/online-bookings") return; responseReads.push((async () => { const body = await response.text().catch(() => "unavailable"); navigationEvidence.push({ event:"response", at:Date.now(), status:response.status(), direction:url.searchParams.get("direction"), rsc:url.searchParams.has("_rsc"), type:response.headers()["content-type"], references:[...new Set(body.match(/ONLINE-[A-Z0-9-]+/g) || [])].slice(0,60) }); })()); });
    page.on("pageerror", error => errors.push(error.message));
    // Never contact a provider: expanding details only gets this synthetic command list.
    const submittedIds: string[] = [];
    await page.route("**/api/integrations/booking-platform/**", route => {
      if (route.request().method() === "POST") {
        submittedIds.push(route.request().postDataJSON().id);
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic uncertain response; retry the same command." }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ commands: [] }) });
    });
    await page.goto(origin + "/online-bookings");
    await page.getByRole("heading", { name: "Online bookings", exact: true }).waitFor();
    const references = () => page!.locator("tbody tr td:first-child strong").allTextContents();
    const first = await references(); assert.equal(first.length, 50);
    const seen = [...first];
    navigationEvidence.push({ event:"before-older", href:await page.getByRole("link", { name:"Older bookings →" }).getAttribute("href"), current:page.url() });
    await page.getByRole("link", { name: "Older bookings →" }).click(); await page.waitForURL(/direction=older/);
    await page.getByRole("link", { name: "← Newer bookings" }).waitFor(); const second = await references(); assert.equal(second.length, 50); seen.push(...second);
    await page.getByRole("link", { name: "Older bookings →" }).click(); await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 36); seen.push(...await references());
    assert.equal(seen.length, 136); assert.equal(new Set(seen).size, 136); assert(!seen.includes("ONLINE-OTHER"));
    await page.getByRole("link", { name: "← Newer bookings" }).click(); await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 50); assert.deepEqual(await references(), second);
    await page.getByRole("link", { name: "First page", exact: true }).click(); await page.waitForURL(origin + "/online-bookings"); assert.deepEqual(await references(), first);
    await page.getByLabel("Search bookings", { exact: true }).fill("ONLINE-001"); await page.getByRole("button", { name: "Apply filters" }).click(); await page.waitForURL(/q=ONLINE-001/); assert.deepEqual(await references(), ["ONLINE-001"]);
    await page.getByLabel("Search bookings", { exact: true }).fill("Shared customer"); await page.getByLabel("Product", { exact: true }).selectOption("HOTEL"); await page.getByLabel("CRM status", { exact: true }).selectOption("ENQUIRY"); await page.getByRole("button", { name: "Apply filters" }).click(); await page.waitForURL(/product=HOTEL/);
    assert.equal((await references()).length, 50);
    await page.getByRole("link", { name: "Older bookings →" }).click(); await page.waitForURL(/cursor=/); assert(page.url().includes("product=HOTEL")); assert(page.url().includes("status=ENQUIRY")); assert.equal((await references()).length, 17);
    await page.getByRole("button", { name: "Apply filters" }).click(); await page.waitForURL(url => !url.searchParams.has("cursor")); assert.equal((await references()).length, 50);
    await page.screenshot({ path: resolve(output, "filtered-desktop.png") });
    await page.getByRole("link", { name: "Clear", exact: true }).click(); await page.waitForURL(origin + "/online-bookings");
    assert.equal(await page.locator("summary").filter({ hasText: "Manage online booking" }).count(), 50);
    const firstAction = page.locator("tbody tr").first().locator("details").first();
    await firstAction.locator("summary").click();
    await firstAction.getByLabel("Action", { exact: true }).selectOption("CANCELLATION_REQUEST");
    await firstAction.getByLabel("Reason / customer-facing note").fill("Unsaved synthetic note retained across resize");
    // All command requests are intercepted above: simulate an uncertain response, never a real mutation.
    await firstAction.getByRole("button", { name: "Request cancellation review", exact: true }).click();
    await firstAction.getByRole("status").filter({ hasText: "Synthetic uncertain response" }).waitFor();
    assert.equal(submittedIds.length, 1);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.getByRole("table", { name: "Online bookings", exact: true }).waitFor();
      assert.equal(await page.locator("summary").filter({ hasText: "Manage online booking" }).count(), 50, "One action instance per booking across resize");
      assert.equal(await firstAction.getByLabel("Action", { exact: true }).inputValue(), "CANCELLATION_REQUEST");
      assert.equal(await firstAction.getByLabel("Reason / customer-facing note").inputValue(), "Unsaved synthetic note retained across resize");
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${width}px`);
      const searchBox = await page.getByLabel("Search bookings", { exact: true }).boundingBox(); assert(searchBox && searchBox.height >= 44);
      await page.screenshot({ path: resolve(output, `queue-mobile-${width}.png`) });
    }
    await firstAction.getByRole("button", { name: "Request cancellation review", exact: true }).click();
    await firstAction.getByRole("status").filter({ hasText: "Synthetic uncertain response" }).waitFor();
    assert.equal(submittedIds.length, 2); assert.equal(submittedIds[1], submittedIds[0], "Pending command idempotency key survives viewport resize");
    await page.getByLabel("Search bookings", { exact: true }).fill("not-a-booking"); await page.getByRole("button", { name: "Apply filters" }).press("Enter"); await page.getByRole("heading", { name: "No matching online bookings" }).waitFor();
    await page.screenshot({ path: resolve(output, "empty-mobile.png") });
    await page.goto(origin + "/online-bookings?cursor=%25"); await page.getByRole("alert").filter({ hasText: "These filters" }).waitFor();
    assert.deepEqual(errors, []);
    console.log("PASS online queue browser: >100 rows, older/newer/first, filter retention/reset, 390/320px overflow, keyboard submit, honest empty/invalid state");
  } finally {
    await Promise.allSettled(responseReads);
    if (page) { await page.screenshot({path:resolve(output,"terminal-state.png"),fullPage:false}).catch(() => {}); navigationEvidence.push({event:"terminal",url:page.url(),status:await page.locator("main").innerText().catch(() => "unavailable")}); }
    await writeFile(resolve(output,"navigation-evidence.json"),JSON.stringify(navigationEvidence,null,2));
    await writeFile(resolve(output, "server.log"), logs);
    await browser?.close();
    if (server.exitCode === null) { const exited = new Promise<void>(r => server.once("exit", () => r())); server.kill("SIGTERM"); await exited; }
  }
}
