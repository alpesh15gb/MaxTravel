import assert from "node:assert/strict";
import { randomBytes, randomUUID, randomInt } from "node:crypto";
import { spawn } from "node:child_process";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";

if (process.env.DATABASE_URL !== "file:./ticketing-journey-verification.db") throw Error("Use only isolated ticketing-journey-verification.db.");
const origin = "http://127.0.0.1:3229", suffix = randomUUID(), password = randomBytes(30).toString("hex");
const ticketPrefix = `123${randomInt(100000000, 1000000000)}`; // Unique per isolated run; repeated runs retain prior fixture tickets.
const role = await prisma.role.upsert({ where: { key: "OWNER" }, create: { key: "OWNER", name: "Fixture owner", desc: "Isolated ticketing verification" }, update: {} });
const branch = await prisma.branch.create({ data: { code: suffix, name: "Synthetic ticketing branch", city: "Test" } });
const user = await prisma.user.create({ data: { employeeCode: suffix, email: `${suffix}@example.test`, name: "Synthetic operator", phone: "", passwordHash: await bcrypt.hash(password, 12), roleId: role.id, branchId: branch.id } });
const customer = await prisma.customer.create({ data: { code: suffix, name: "Synthetic ticket customer", phone: "", city: "Test", branchId: branch.id, assignedToId: user.id, travellers: { create: [{ fullName: "Same Name" }, { fullName: "Same Name" }] } }, include: { travellers: true } });
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3229", "-H", "127.0.0.1"], { env: { ...process.env, APP_ORIGIN: origin, JWT_SECRET: randomBytes(48).toString("hex"), WA_PROVIDER: "manual" }, stdio: ["ignore", "pipe", "pipe"] });
let logs = "", cookie = "";
server.stdout.on("data", v => logs += v); server.stderr.on("data", v => logs += v);
async function post(path: string, body: unknown, expected = 200) {
  const r = await fetch(origin + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie }, body: JSON.stringify(body) });
  const data = await r.json(); assert.equal(r.status, expected, `${path}: ${JSON.stringify(data)}`);
  if (path === "/api/auth/login") cookie = r.headers.get("set-cookie")!.split(";")[0];
  return data;
}
try {
  let ready = false;
  for (let n = 0; n < 80; n++) { try { if ((await fetch(origin + "/api/health")).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 500)); }
  assert(ready, logs);
  await post("/api/auth/login", { email: user.email, password });
  const managerRole = await prisma.role.upsert({ where: { key: "BRANCH_MANAGER" }, create: { key: "BRANCH_MANAGER", name: "Fixture branch manager", desc: "Isolated access test" }, update: {} });
  const manager = await prisma.user.create({ data: { employeeCode: `M-${suffix}`, email: `manager-${suffix}@example.test`, name: "Synthetic manager", phone: "", passwordHash: await bcrypt.hash(password, 12), roleId: managerRole.id, branchId: branch.id } });
  const foreignBranch = await prisma.branch.create({ data: { code: `F-${suffix}`, name: "Other synthetic branch", city: "Test" } });
  const foreignBooking = await prisma.booking.create({ data: { bookingNo: `FOREIGN-${suffix}`, customerId: customer.id, ownerId: user.id, branchId: foreignBranch.id, sellingPrice: 100 } });
  const foreignRefund = await prisma.refund.create({ data: { refundNo: `FOREIGN-${suffix}`, customerId: customer.id, bookingId: foreignBooking.id, amount: 50, reason: "Synthetic cross-branch access test" } });
  await post("/api/auth/login", { email: manager.email, password });
  await post("/api/refunds/update", { refundId: foreignRefund.id, status: "SUPPLIER_PENDING" }, 403);
  assert.equal((await prisma.refund.findUniqueOrThrow({ where: { id: foreignRefund.id } })).status, "REQUESTED", "Customer access must not grant foreign booking access");
  await post("/api/auth/login", { email: user.email, password });
  const created = await post("/api/bookings", { customerId: customer.id, travellerIds: customer.travellers.map(t => t.id), fare: 1000, pnr: "TEST12", sector: "DEL-BOM" });
  const bookingId = created.bookingId;
  await post("/api/invoices", { customerId: customer.id, bookingId, amount: 600 });
  await post("/api/invoices", { customerId: customer.id, bookingId, amount: 400 });
  await post("/api/invoices", { customerId: customer.id, bookingId, amount: 1 }, 409);
  assert.equal(await prisma.invoice.count({ where: { bookingId } }), 2, "Invoice ceiling rejects excess while permitting instalments");
  // Quote conversions may arrive without passenger links; the pre-ticket edit closes that handoff.
  await prisma.bookingTraveller.deleteMany({ where: { bookingId } });
  await post(`/api/bookings/${bookingId}`, { travellerIds: ["not-this-customers-traveller"] }, 400);
  await post(`/api/bookings/${bookingId}`, { travellerIds: customer.travellers.map(t => t.id) });
  assert.equal(await prisma.bookingTraveller.count({ where: { bookingId } }), 2);
  for (const status of ["REISSUED", "REISSUE_REQUESTED"]) await post("/api/bookings/status", { bookingId, status }, 400);
  // One actual airline document cannot be assigned to two same-name passengers.
  await post("/api/bookings/status", { bookingId, status: "TICKETED", tickets: customer.travellers.map(t => ({ travellerId: t.id, ticketNo: `${ticketPrefix}0` })) }, 400);
  assert.equal(await prisma.ticket.count({ where: { bookingId } }), 0, "Failed issuance rolls back all tickets");
  await post("/api/bookings/status", { bookingId, status: "TICKETED", tickets: customer.travellers.map((t, i) => ({ travellerId: t.id, ticketNo: `${ticketPrefix}${i}` })) });
  await post("/api/bookings/status", { bookingId, status: "TICKETED" });
  assert.equal(await prisma.ticket.count({ where: { bookingId } }), 2);
  assert.equal(await prisma.auditLog.count({ where: { entity: "Booking", entityId: bookingId, action: "STATUS" } }), 1, "Ticketing replay is a no-op");
  await post(`/api/bookings/${bookingId}`, { travellerIds: [customer.travellers[0].id] }, 400);
  await post("/api/bookings/status", { bookingId, status: "ENQUIRY" }, 400);
  await post("/api/bookings/extend-deadline", { bookingId, hours: 24 }, 400);
  const ticket = await prisma.ticket.findFirstOrThrow({ where: { bookingId } });
  const reissue = await post("/api/reissues", { originalTicketId: ticket.id, reason: "Synthetic date change", fareDifference: 100 });
  const replacementId = reissue.reissueBookingId;
  const request = await prisma.reissue.findFirstOrThrow({ where: { reissuedBookingId: replacementId } });
  await post("/api/reissues/status", { reissueId: request.id, status: "DONE" }, 400);
  await post("/api/payments", { customerId: customer.id, bookingId: replacementId, amount: 50, mode: "CASH" });
  await post("/api/reissues/status", { reissueId: request.id, status: "REJECTED" }, 409);
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: replacementId } })).status, "REISSUE_REQUESTED");
  if (process.env.TICKETING_BROWSER === "true") {
    const { chromium } = await import("./browser.mjs");
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const separator = cookie.indexOf("=");
      await context.addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: origin }]);
      const page = await context.newPage();
      await page.goto(`${origin}/ticketing/${replacementId}`);
      await page.getByLabel("Booking status", { exact: true }).selectOption("CANCELLED");
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Supplier cancellation charge (INR) *", { exact: true }).fill("25");
      await dialog.getByLabel("Agency cancellation fee (INR) *", { exact: true }).fill("25");
      await dialog.getByLabel("Cancellation reason / agreed terms *", { exact: true }).fill("Synthetic agreed nonrefundable terms");
      assert.match(await dialog.innerText(), /New refund to request/);
      await dialog.getByRole("button", { name: "Back", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: replacementId } })).status, "REISSUE_REQUESTED", "Dismissal cannot mutate a booking");
      await page.getByLabel("Booking status", { exact: true }).selectOption("CANCELLED");
      await dialog.getByLabel("Supplier cancellation charge (INR) *", { exact: true }).fill("0");
      await dialog.getByLabel("Agency cancellation fee (INR) *", { exact: true }).fill("0");
      await dialog.getByLabel("Cancellation reason / agreed terms *", { exact: true }).fill("Full waiver agreed; synthetic browser test only");
      await dialog.getByRole("button", { name: "Save cancellation terms", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
      await page.getByRole("heading", { name: "Cancellation settlement", exact: true }).waitFor();
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: replacementId } })).status, "CANCELLED");
      console.log("Ticketing browser: cancellation preview, dismiss/no mutation, reopen and explicit zero-charge save passed.");
    } finally { await browser.close(); }
  }
  await post("/api/bookings/status", { bookingId: replacementId, status: "CANCELLED", cancellationSupplierCharge: 0, cancellationAgencyFee: 0, cancellationReason: "Full waiver agreed; synthetic test only", refundAmount: 50 });
  const refund = await prisma.refund.findFirstOrThrow({ where: { bookingId: replacementId } });
  await post("/api/refunds/update", { refundId: refund.id, status: "SUPPLIER_PENDING" });
  const pendingRefund = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
  await post("/api/refunds/update", { refundId: refund.id, status: "SUPPLIER_PENDING" });
  assert.equal((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).supplierSentOn?.toISOString(), pendingRefund.supplierSentOn?.toISOString());
  assert.equal(await prisma.auditLog.count({ where: { entity: "Refund", entityId: refund.id, action: "STATUS" } }), 1, "Refund stage retry preserves timestamp and audit history");
  await post("/api/reissues/status", { reissueId: request.id, status: "DONE" }, 409);
  await post("/api/reissues/status", { reissueId: request.id, status: "REJECTED" });
  await post("/api/reissues/status", { reissueId: request.id, status: "REJECTED" });
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: replacementId } })).status, "CANCELLED");
  assert.equal(await prisma.refund.count({ where: { bookingId: replacementId, amount: 50 } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { entity: "Reissue", entityId: request.id, action: "STATUS" } }), 1);
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status, "TICKETED");
  const successful = await post("/api/reissues", { originalTicketId: ticket.id, reason: "Synthetic replacement", fareDifference: 100 });
  const successRequest = await prisma.reissue.findFirstOrThrow({ where: { reissuedBookingId: successful.reissueBookingId } });
  await post("/api/bookings/status", { bookingId: successful.reissueBookingId, status: "TICKETED", tickets: [{ travellerId: ticket.travellerId, ticketNo: `${ticketPrefix}9` }] });
  await post("/api/reissues/status", { reissueId: successRequest.id, status: "IN_PROGRESS" });
  await post("/api/reissues/status", { reissueId: successRequest.id, status: "DONE" });
  await post("/api/reissues/status", { reissueId: successRequest.id, status: "DONE" });
  assert.equal((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status, "REISSUED");
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: successful.reissueBookingId } })).status, "REISSUED");
  console.log("Ticketing journey regressions passed: same-name passengers, duplicate tickets, status truth, retry safety, deadline closure, paid reissue rejection and cancellation/refund preservation.");
} finally { server.kill("SIGTERM"); await prisma.$disconnect(); }
