import assert from "node:assert/strict";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// CI UI gate only. Uses its authenticated browser and disposable review database; no provider calls.
export async function checkSalesOperationalTrust(page, base, fixture) {
  const runtime = path.resolve(fixture.runtime);
  assert(runtime.startsWith(path.resolve("tests/.runtime") + path.sep));
  const db = new PrismaClient({ datasources: { db: { url: `file:${path.join(runtime, "test.db")}` } } });
  const prefix = `trust-sales-${Date.now()}`, ids = [];
  const viewport = page.viewportSize();
  let interrupt;
  try {
    const customer = await db.customer.findUniqueOrThrow({ where: { id: fixture.customerId } });
    const owner = await db.user.findFirstOrThrow({ where: { email: "review@visual.test" } });
    const lead = await db.salesLead.create({ data: { id: `${prefix}-lead`, title: "Synthetic trust enquiry", customerId: customer.id, branchId: customer.branchId, ownerId: owner.id, source: "Trust fixture", stage: "QUOTED" } }); ids.push(lead.id);
    const quoteData = { leadId: lead.id, totalMinor: 10000, costMinor: 8000, items: "[]", terms: "Synthetic fixture; no reservation or payment.", createdBy: owner.id };
    const accepted = await db.salesQuote.create({ data: { ...quoteData, version: 1, state: "ACCEPTED", acceptedAt: new Date(), expiresAt: new Date("2020-01-01") } });
    await db.salesQuote.create({ data: { ...quoteData, version: 2, state: "DRAFT", expiresAt: new Date("2099-01-01") } });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/sales?lead=${lead.id}`, { waitUntil: "networkidle" });
    const guidance = page.getByRole("region", { name: "Enquiry next step" });
    await guidance.getByRole("heading", { name: "Accepted proposal needs booking review" }).waitFor();
    assert.match(await page.getByRole("region", { name: "Selected enquiry" }).innerText(), new RegExp(customer.code));
    assert.equal(await page.getByRole("button", { name: "New quote version", exact: true }).count(), 0);
    assert(await page.getByRole("button", { name: "Publish private proposal", exact: true }).isDisabled());
    await guidance.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-artifacts/sales-trust-mobile.png", fullPage: true });
    const review = guidance.getByRole("button", { name: "Review quote v1", exact: true });
    await review.focus(); await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => document.activeElement?.id), `sales-quote-${accepted.id}`, "Keyboard review targets the accepted version, not the newest draft");
    assert.doesNotMatch(await page.locator("article").filter({ has: page.locator(`[id="sales-quote-${accepted.id}"]`) }).innerText(), /Expired offer/);
    assert.equal((await db.salesQuote.findUniqueOrThrow({ where: { id: accepted.id } })).bookingId, null);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Mobile guidance must not create horizontal document overflow");

    await page.getByText("Update stage / follow-up", { exact: true }).click();
    await page.getByLabel("Next follow-up", { exact: true }).fill("2099-12-01T12:00");
    const latestFollow = new Date("2098-01-02T10:00:00Z");
    await db.salesLead.update({ where: { id: lead.id }, data: { followUpAt: latestFollow } });
    let result = page.waitForResponse(r => new URL(r.url()).pathname === "/api/sales" && r.request().method() === "POST");
    await page.getByRole("button", { name: "Save stage / follow-up", exact: true }).click();
    assert.equal((await result).status(), 409);
    await page.getByRole("alert").filter({ hasText: "This stage or follow-up was not saved" }).waitFor();
    assert.equal(await page.getByLabel("Next follow-up", { exact: true }).inputValue(), "2099-12-01T12:00", "Stale save preserves local text for copying");
    assert.equal((await db.salesLead.findUniqueOrThrow({ where: { id: lead.id } })).followUpAt.toISOString(), latestFollow.toISOString());
    assert.equal(await db.auditLog.count({ where: { entity: "SalesLead", entityId: lead.id, action: "STAGE" } }), 0);

    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("button", { name: "Refresh records", exact: true }).click();
    assert.equal(await page.getByLabel("Next follow-up", { exact: true }).inputValue(), "2099-12-01T12:00", "Cancel refresh keeps edits");
    interrupt = route => route.request().method() === "GET" ? route.abort("failed") : route.fallback();
    await page.route("**/api/sales*", interrupt);
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Refresh records", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Latest status could not be loaded" }).waitFor();
    assert.equal(await page.getByLabel("Next follow-up", { exact: true }).inputValue(), "2099-12-01T12:00");
    await page.unroute("**/api/sales*", interrupt); interrupt = undefined;
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Refresh records", exact: true }).click();
    await page.getByText("Latest records loaded. Review the enquiry and quote versions before making another change.", { exact: true }).waitFor();
    assert.notEqual(await page.getByLabel("Next follow-up", { exact: true }).inputValue(), "2099-12-01T12:00");

    // A successful write with a lost response must remain locked; review, never replay it.
    await page.getByLabel("Next follow-up", { exact: true }).fill("2099-02-01T12:00");
    let saves = 0;
    interrupt = async route => {
      if (route.request().method() !== "POST") return route.fallback();
      saves++; const response = await route.fetch(); assert(response.ok()); await route.abort("failed");
    };
    await page.route("**/api/sales", interrupt);
    await page.getByRole("button", { name: "Save stage / follow-up", exact: true }).click();
    await page.locator('[data-sales-action-state="uncertain"]').waitFor();
    assert(await page.getByRole("button", { name: "Save stage / follow-up", exact: true }).isDisabled());
    assert.equal(saves, 1);
    await page.unroute("**/api/sales", interrupt); interrupt = undefined;
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Reload latest status", exact: true }).click();
    await page.getByText("Latest records loaded. Review the enquiry and quote versions before making another change.", { exact: true }).waitFor();
    assert.equal(await db.auditLog.count({ where: { entity: "SalesLead", entityId: lead.id, action: "STAGE" } }), 1, "Unknown outcome review does not repeat the write");
    console.log("Sales operational trust passed: accepted historical version, mobile keyboard focus, stale stage protection, interrupted refresh and unknown-save review.");
  } finally {
    if (interrupt) { await page.unroute("**/api/sales*", interrupt).catch(() => {}); await page.unroute("**/api/sales", interrupt).catch(() => {}); }
    if (viewport) await page.setViewportSize(viewport);
    await db.auditLog.deleteMany({ where: { entityId: { in: ids } } });
    await db.salesQuote.deleteMany({ where: { leadId: { in: ids } } });
    await db.salesLead.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
}
