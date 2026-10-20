import assert from "node:assert/strict";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// Called by the UI gate after its visual measurements, against its disposable review database only.
export async function checkStaffHandoffs(page, base, fixture) {
  const runtime = path.resolve(fixture.runtime);
  assert.ok(runtime.startsWith(path.resolve("tests/.runtime") + path.sep), "Never seed a non-test database");
  const db = new PrismaClient({ datasources: { db: { url: `file:${path.join(runtime, "test.db")}` } } });
  let original;
  let refund;
  try {
    await page.goto(`${base}/customers/${fixture.customerId}?tab=tasks`, { waitUntil: "networkidle" });
    const task = page.locator('a[href^="/tasks?focus="]').first();
    await task.click();
    await page.waitForURL(/\/tasks\?focus=/);
    assert.match(page.url(), /\/tasks\?focus=/, "Customer task must hand off to actionable task desk");

    original = await db.document.findFirstOrThrow({ where: { customerId: fixture.customerId } });
    await db.document.update({ where: { id: original.id }, data: { status: "RECEIVED", storagePath: "review-test-placeholder.pdf" } });
    await page.goto(`${base}/customers/${fixture.customerId}?tab=documents`, { waitUntil: "networkidle" });
    await page.locator(`a[href="/documents?focus=${original.id}"]`).click();
    const row = page.locator(`[id="document-${original.id}"]`);
    await row.waitFor({ state: "visible" });
    assert.match(await row.getAttribute("class"), /ring-2/, "Focused document is visibly identified");
    await row.getByRole("button", { name: "Reject", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const reason = "The passport image is blurred; please upload a clear full-page scan.";
    await dialog.getByLabel("Reason for rejection").fill(reason);
    let calls = 0;
    await page.route("**/api/documents/verify", async route => {
      calls++;
      assert.equal(route.request().postDataJSON().reason, reason);
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary review failure" }) });
    });
    await dialog.getByRole("button", { name: "Reject document", exact: true }).click();
    await dialog.getByRole("alert").waitFor();
    assert.equal(await dialog.getByLabel("Reason for rejection").inputValue(), reason, "Failure preserves typed reason");
    assert.equal(calls, 1);
    await page.unroute("**/api/documents/verify");
    await dialog.getByRole("button", { name: "Reject document", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal((await db.document.findUniqueOrThrow({ where: { id: original.id } })).rejectionReason, reason);

    await page.goto(`${base}/payments?action=record&customer=${fixture.customerId}`, { waitUntil: "networkidle" });
    await page.getByLabel("03 / Amount received (INR) *", { exact: true }).fill("1.00");
    const paymentCountBefore = await db.payment.count({ where: { customerId: fixture.customerId } });
    let committedPayment;
    let originalRequestKey;
    let paymentRequests = 0;
    await page.route("**/api/payments", async route => {
      paymentRequests++;
      originalRequestKey = route.request().postDataJSON().requestKey;
      assert.match(originalRequestKey, /^[0-9a-f-]{36}$/i, "Opened form owns a durable request key");
      const committed = await route.fetch();
      assert.ok(committed.ok(), "First request must commit before losing its response");
      committedPayment = await committed.json();
      await route.abort("failed");
    });
    await page.getByRole("button", { name: "Save receipt", exact: true }).click();
    await page.getByRole("dialog").getByRole("alert").waitFor();
    assert.equal(await page.getByLabel("03 / Amount received (INR) *", { exact: true }).inputValue(), "1.00", "Lost response preserves form details");
    assert.equal(paymentRequests, 1, "Failure must wait for staff retry, not automatically replay");
    assert.equal(await db.payment.count({ where: { customerId: fixture.customerId } }), paymentCountBefore + 1);
    await page.unroute("**/api/payments");
    const saved = page.waitForResponse(response => response.url().endsWith("/api/payments") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Save receipt", exact: true }).click();
    const response = await saved;
    assert.ok(response.ok());
    const result = await response.json();
    assert.equal(response.request().postDataJSON().requestKey, originalRequestKey, "Staff retry reuses original request key");
    assert.equal(result.payment.id, committedPayment.payment.id, "Retry recovers the same receipt");
    assert.equal(await db.payment.count({ where: { customerId: fixture.customerId } }), paymentCountBefore + 1, "Lost-response retry must not duplicate money");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("button", { name: "Receipts", exact: true }).getAttribute("aria-pressed"), "true", "Saved receipt opens receipts context");
    await page.locator(`[role="status"] a[href="/payments/print?receipt=${result.payment.id}"]`).waitFor();
    await page.waitForURL(url => url.pathname === "/payments" && !url.searchParams.has("action"));
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.getByRole("dialog").count(), 0, "Reload must not reopen a submitted form");
    await page.goto(`${base}/customers/${fixture.customerId}?tab=payments`, { waitUntil: "networkidle" });
    assert.equal(await page.getByRole("table", { name: "Customer invoices" }).getByRole("columnheader", { name: "Status", exact: true }).count(), 1);
    assert.equal(await page.getByRole("table", { name: "Customer receipts" }).getByRole("columnheader", { name: "Mode", exact: true }).count(), 1);
    refund = await db.refund.create({ data: { refundNo: `RF-UI-${Date.now()}`, customerId: fixture.customerId, bookingId: fixture.bookingId, amount: 1, status: "PROCESSED", reason: "Isolated UI confirmation test" } });
    await page.goto(`${base}/refunds?focus=${refund.id}`, { waitUntil: "networkidle" });
    const refundRow = page.locator(`[id="${refund.id}"]`);
    await refundRow.getByRole("button", { name: "Record completed customer payout" }).click();
    await page.getByRole("dialog").getByText(/does not transfer money/).waitFor();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal((await db.refund.findUniqueOrThrow({ where: { id: refund.id } })).status, "PROCESSED", "Cancel must not record payout");
    await refundRow.getByRole("button", { name: "Record completed customer payout" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm payout already completed" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.equal((await db.refund.findUniqueOrThrow({ where: { id: refund.id } })).status, "PAID");
    console.log("Staff handoffs passed: customer task/document links, reason-preserving document rejection, receipt result context.");
  } finally {
    await page.unroute("**/api/documents/verify").catch(() => {});
    await page.unroute("**/api/payments").catch(() => {});
    if (refund) await db.refund.delete({ where: { id: refund.id } });
    if (original) await db.document.update({ where: { id: original.id }, data: { status: original.status, storagePath: original.storagePath, rejectionReason: original.rejectionReason, verificationStatus: original.verificationStatus, verifiedById: original.verifiedById, verifiedAt: original.verifiedAt } });
    await db.$disconnect();
  }
}
