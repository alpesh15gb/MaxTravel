#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, createWriteStream } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { PrismaClient } from "@prisma/client";

const ROOT = process.cwd();
const runtime = path.join(ROOT, "tests", ".runtime", `run-${Date.now()}`);
mkdirSync(runtime, { recursive: true });
writeFileSync(path.join(runtime, "test.db"), Buffer.alloc(0));
const database = `file:${path.join(runtime, "test.db").replaceAll("\\", "/")}`;
const port = Number(process.env.TEST_PORT ?? 3211);
assert(port !== 3210 && port !== 3000 && port > 1024, "Tests must not use the live or unrelated app ports");
const BASE = `http://127.0.0.1:${port}`;
const password = `Test-${randomBytes(15).toString("hex")}!`;
const env = { ...process.env, DATABASE_URL: database, JWT_SECRET: randomBytes(32).toString("hex"), UPLOAD_ROOT: path.join(runtime, "uploads") };
const prisma = new PrismaClient({ datasources: { db: { url: database } } });
const out = createWriteStream(path.join(runtime, "server.log"));
let server; let passed = 0; const checks = [];
const prismaCli = path.join(ROOT, "node_modules", "prisma", "build", "index.js");
const nextCli = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
function check(name, fn) { fn(); passed++; checks.push(name); console.log(`✓ ${name}`); }
async function post(url, body, cookie = "", extra = {}) { return fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...extra }, body: JSON.stringify(body) }); }
async function get(url, cookie = "", redirect = "follow") { return fetch(BASE + url, { headers: cookie ? { cookie } : {}, redirect }); }
async function ok(url, body, cookie = "") { const r = await post(url, body, cookie); const data = await r.json(); assert(r.ok, `${url}: ${r.status} ${JSON.stringify(data)}`); return data; }
async function login(email, secret = password) { const r = await post("/api/auth/login", { email, password: secret }); assert.equal(r.status, 200, `Login ${email}`); const data = await r.json(); return { cookie: r.headers.getSetCookie().map(c => c.split(";")[0]).join("; "), user: data.user }; }
async function status(name, url, body, cookie, expected) { const r = await post(url, body, cookie); const data = await r.json(); check(name, () => assert.equal(r.status, expected, JSON.stringify(data))); }
async function ready() { for (let i = 0; i < 100; i++) { if (server.exitCode !== null) throw new Error(`Test server exited ${server.exitCode}`); try { if ((await get("/setup")).ok) return; } catch {} await new Promise(r => setTimeout(r, 200)); } throw new Error("Test server did not become ready"); }
async function freePort() { await new Promise((resolve, reject) => { const s = net.createServer(); s.once("error", reject); s.listen(port, "127.0.0.1", () => s.close(resolve)); }); }

async function run() {
  await freePort();
  // The suite builds its database with the same migrations a deploy applies, so a migration that
  // cannot run against an empty database fails here instead of during a release.
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: ROOT, env, stdio: "pipe" });
  server = spawn(process.execPath, [nextCli, "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.pipe(out); server.stderr.pipe(out); await ready();
  console.log(`Isolated Travel OS regression suite → ${BASE}`);
  const home = await get("/", "", "manual");
  check("Fresh root routes to one-time setup", () => assert.equal(home.headers.get("location"), "/setup"));
  const setupPage = await (await get("/setup")).text();
  check("Setup has no prefilled accounts or demo credentials", () => { assert(!setupPage.includes("demo1234")); assert(!setupPage.includes("owner@travelos.in")); });
  await status("Weak owner password rejected", "/api/setup", { agencyName: "Test agency", city: "Pune", name: "Test Owner", email: "owner@example.test", password: "short" }, "", 400);
  await status("Incomplete setup rejected", "/api/setup", {}, "", 400);
  const origin = await post("/api/setup", {}, "", { Origin: "https://untrusted.example" });
  check("Foreign Origin blocked", () => assert.equal(origin.status, 403));
  await ok("/api/setup", { agencyName: "Regression Agency", city: "Pune", name: "Test Owner", email: "owner@example.test", phone: "+919000000001", password });
  await status("Setup cannot run twice", "/api/setup", {}, "", 409);
  check("Setup initializes only one actual owner, no customers or transactions", () => {});
  assert.equal(await prisma.user.count(), 1); assert.equal(await prisma.customer.count(), 0); assert.equal(await prisma.payment.count(), 0); assert.equal(await prisma.quickReply.count(), 0);
  const owner = await login("owner@example.test");
  check("Real login sets an HTTP-safe session cookie", () => assert(owner.cookie.startsWith("tos_session=")));
  await status("Unauthenticated payment rejected", "/api/payments", {}, "", 401);
  const emptyPulse = await (await get("/api/pulse", owner.cookie)).json();
  check("Fresh pulse has truthful zero metrics", () => { assert(emptyPulse.firstRun); assert.equal(emptyPulse.items.length, 0); assert(emptyPulse.kpis.every(k => /^(0|₹0)$/.test(k.value))); });
  const routes = ["/dashboard", "/customers", "/visa", "/visa/new", "/ticketing", "/ticketing/new", "/documents", "/payments", "/refunds", "/suppliers", "/tasks", "/whatsapp", "/employees", "/checklists", "/settings", "/audit", "/notifications"];
  for (const route of routes) { const r = await get(route, owner.cookie); const html = await r.text(); check(`Empty-state route ${route}`, () => { assert.equal(r.status, 200); assert(!html.includes('"digest"'), "Server route error"); assert(!html.includes("Skyline")); }); }
  const alice = await ok("/api/customers", { name: "Alice Regression", phone: "+919000000002", email: "alice@example.test", city: "Pune" }, owner.cookie);
  const bob = await ok("/api/customers", { name: "Bob Regression", phone: "+919000000003", city: "Pune" }, owner.cookie);
  const aliceTraveller = await prisma.traveller.findFirstOrThrow({ where: { customerId: alice.id } });
  const bobTraveller = await prisma.traveller.findFirstOrThrow({ where: { customerId: bob.id } });
  const family = await ok("/api/travellers", { customerId: alice.id, fullName: "Alex Regression", relation: "SPOUSE" }, owner.cookie);
  check("Customer creation includes a primary traveller", () => assert(aliceTraveller.primary));
  check("References are readable agency numbers", () => { assert.match(alice.code, /^C-\d{4}-\d{4,}$/); assert.notEqual(alice.code, bob.code); });
  const checklist = await ok("/api/checklists", { country: "Test destination", visaType: "Visitor", applicantType: "STANDARD", items: [{ name: "Passport", required: true, fileTypes: "pdf,jpg,png", maxSizeMb: 1, needsVerification: true }] }, owner.cookie);
  await status("Invalid checklist does not supersede master", "/api/checklists", { country: "Test destination", visaType: "Visitor", applicantType: "STANDARD", items: [{ name: "" }] }, owner.cookie, 400);
  assert((await prisma.checklist.findUniqueOrThrow({ where: { id: checklist.checklist.id } })).active);
  const visa = await ok("/api/visa/cases", { customerId: alice.id, travellerIds: [aliceTraveller.id, family.travellerId], destination: "Test destination", visaType: "Visitor", checklistId: checklist.checklist.id, visaFee: 75.25, serviceFee: 24.85 }, owner.cookie);
  const documents = await prisma.document.findMany({ where: { visaCaseId: visa.caseId } });
  check("Requirements are created for each traveller", () => { assert.equal(documents.length, 2); assert.equal(new Set(documents.map(d => d.travellerId)).size, 2); });
  await status("Cross-customer visa traveller rejected", "/api/visa/cases", { customerId: alice.id, travellerIds: [bobTraveller.id], destination: "Test", visaType: "Visitor" }, owner.cookie, 400);
  await status("Explicit passengers required", "/api/bookings", { customerId: alice.id, travellerIds: [] }, owner.cookie, 400);
  const booking = await ok("/api/bookings", { customerId: alice.id, travellerIds: [aliceTraveller.id], pnr: "REG001", sector: "AAA → BBB", deadlineHours: 2, fare: 200.10, taxes: 10.20 }, owner.cookie);
  await status("Negative fare rejected", "/api/bookings", { customerId: alice.id, travellerIds: [aliceTraveller.id], fare: -1 }, owner.cookie, 400);
  await status("Invalid dates rejected", "/api/bookings", { customerId: alice.id, travellerIds: [aliceTraveller.id], travelDate: "bad" }, owner.cookie, 400);
  await status("Mock ticketing is disallowed", "/api/bookings/status", { bookingId: booking.bookingId, status: "TICKETED" }, owner.cookie, 400);
  assert.equal(await prisma.ticket.count(), 0);
  await ok("/api/bookings/status", { bookingId: booking.bookingId, status: "TICKETED", tickets: [{ travellerId: aliceTraveller.id, ticketNo: "123-1234567890", originalFare: 210.30 }] }, owner.cookie);
  check("Actual ticket number stored without invention", () => {}); assert.equal((await prisma.ticket.findFirstOrThrow()).ticketNo, "123-1234567890");
  const inv = await ok("/api/invoices", { customerId: alice.id, visaCaseId: visa.caseId, amount: 100.10, description: "Visa service", dueDate: "2020-01-01" }, owner.cookie);
  check("Case, booking and invoice numbers share the agency format", () => { for (const value of [visa.caseNo, booking.bookingNo, inv.invoiceNo]) assert.match(String(value), /^[A-Z]+-\d{4}-\d{4,}$/); });
  check("Sequential numbers increment instead of skipping", () => assert.equal(Number(bob.code.slice(-4)) - Number(alice.code.slice(-4)), 1));
  await status("Cross-customer invoice allocation rejected", "/api/invoices", { customerId: bob.id, bookingId: booking.bookingId, amount: 10 }, owner.cookie, 400);
  await status("Fractional-cent invoice rejected", "/api/invoices", { customerId: alice.id, amount: 1.001 }, owner.cookie, 400);
  await status("Non-finite payment rejected", "/api/payments", { customerId: alice.id, amount: "Infinity" }, owner.cookie, 400);
  const paymentsBefore = await prisma.payment.count();
  await status("Cross-customer payment rejected atomically", "/api/payments", { customerId: bob.id, invoiceId: inv.invoiceId, amount: 1 }, owner.cookie, 400);
  assert.equal(await prisma.payment.count(), paymentsBefore);
  await ok("/api/payments", { customerId: alice.id, invoiceId: inv.invoiceId, amount: 40.05, mode: "NEFT", bookingId: "", visaCaseId: "" }, owner.cookie);
  let record = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.invoiceId } });
  check("Partial receipt updates invoice in cents", () => { assert.equal(record.amountPaid, 40.05); assert.equal(record.status, "PARTIAL"); });
  assert.equal((await prisma.visaCase.findUniqueOrThrow({ where: { id: visa.caseId } })).amountReceived, 40.05);
  await status("Overpayment rejected", "/api/payments", { customerId: alice.id, invoiceId: inv.invoiceId, amount: 60.06 }, owner.cookie, 400);
  await ok("/api/payments", { customerId: alice.id, invoiceId: inv.invoiceId, amount: 60.05, mode: "UPI" }, owner.cookie);
  record = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.invoiceId } });
  check("Invoice and visa balance finish exactly", () => { assert.equal(record.amountPaid, 100.10); assert.equal(record.status, "PAID"); });
  await ok("/api/payments", { customerId: alice.id, bookingId: booking.bookingId, amount: 50, mode: "CASH" }, owner.cookie);
  const refund = await ok("/api/refunds", { customerId: alice.id, bookingId: booking.bookingId, amount: 10, reason: "Regression request" }, owner.cookie);
  await status("Refund cannot exceed receipts", "/api/refunds", { customerId: alice.id, bookingId: booking.bookingId, amount: 100, reason: "Too much" }, owner.cookie, 400);
  await status("Refund approval cannot skip pipeline", "/api/refunds/update", { refundId: refund.refund.id, status: "PAID" }, owner.cookie, 400);
  const afterRequest = await prisma.booking.findUniqueOrThrow({ where: { id: booking.bookingId } });
  check("Requesting a refund does not un-sell the booking", () => assert.equal(afterRequest.status, "TICKETED"));
  for (const status of ["SUPPLIER_PENDING", "SUPPLIER_RECEIVED", "APPROVED", "PROCESSED", "PAID"]) await ok("/api/refunds/update", { refundId: refund.refund.id, status }, owner.cookie);
  const afterPartial = await prisma.booking.findUniqueOrThrow({ where: { id: booking.bookingId } });
  check("A completed partial refund leaves the sale status truthful", () => {
    // ₹10 returned out of ₹50 received: the trip is still sold. The refund pipeline state lives on
    // the refund, and only a refund that returns every receipt withdraws the booking.
    assert.equal(afterPartial.status, "TICKETED");
  });
  const willReject = await ok("/api/refunds", { customerId: alice.id, bookingId: booking.bookingId, amount: 5, reason: "Regression rejection" }, owner.cookie);
  await status("Refund rejection requires a recorded reason", "/api/refunds/update", { refundId: willReject.refund.id, status: "REJECTED" }, owner.cookie, 400);
  await ok("/api/refunds/update", { refundId: willReject.refund.id, status: "REJECTED", rejectionReason: "Supplier declined the waiver" }, owner.cookie);
  const afterReject = await prisma.booking.findUniqueOrThrow({ where: { id: booking.bookingId } });
  check("A rejected refund neither cancels nor refunds the sale", () => assert.equal(afterReject.status, "TICKETED"));
  const supplier = await ok("/api/suppliers", { name: "Real test supplier", type: "CONSOLIDATOR", paymentDueDays: 15 }, owner.cookie);
  const payable = await ok("/api/suppliers/dues", { supplierId: supplier.supplier.id, description: "Actual test payable", amount: 12.34, dueDate: "2020-01-01" }, owner.cookie);
  const supplierSettlement = await ok("/api/suppliers/dues", { dueId: payable.due.id, amount: 12.34, method: "NEFT", requestKey: `smoke-${randomBytes(8).toString("hex")}` }, owner.cookie);
  const task = await ok("/api/tasks", { title: "Follow up regression", customerId: alice.id, dueAt: "2020-01-01", priority: "HIGH" }, owner.cookie);
  await ok("/api/tasks/status", { taskId: task.task.id, status: "DONE" }, owner.cookie);
  await ok("/api/notes", { customerId: alice.id, body: "Real customer preference" }, owner.cookie);
  const logged = await ok("/api/whatsapp/send", { customerId: alice.id, text: "Regression message" }, owner.cookie);
  check("WhatsApp is honestly logged, never marked delivered", () => { assert.equal(logged.status, "LOGGED"); assert(logged.whatsappUrl.startsWith("https://wa.me/")); });
  const hook = await post("/api/whatsapp/webhook", { from: "+919000000002", text: "Forged" });
  check("Unconfigured inbound webhook disabled", () => assert.equal(hook.status, 503));
  const link = await ok("/api/upload-links", { customerId: alice.id, visaCaseId: visa.caseId }, owner.cookie);
  check("Upload token is cryptographically sized", () => assert.equal(link.token.length, 32));
  const pdf = new Blob(["%PDF-1.4\nRegression document only\n%%EOF"], { type: "application/pdf" });
  async function upload(documentId, file = pdf) { const f = new FormData(); f.append("documentId", documentId); f.append("file", file, "passport.pdf"); return fetch(`${BASE}/api/upload/${link.token}`, { method: "POST", body: f }); }
  const invalidFile = await upload(documents[0].id, new Blob(["not a pdf"], { type: "application/pdf" }));
  check("File signature mismatch rejected", () => assert.equal(invalidFile.status, 400));
  const uploadResult = await upload(documents[1].id); assert.equal(uploadResult.status, 200, await uploadResult.text());
  const updated = await prisma.document.findUniqueOrThrow({ where: { id: documents[1].id } });
  check("Upload updates the correct traveller requirement", () => { assert.equal(updated.status, "RECEIVED"); assert.equal(updated.travellerId, documents[1].travellerId); assert.equal(updated.extracted, null); });
  assert.equal((await prisma.document.findUniqueOrThrow({ where: { id: documents[0].id } })).status, "REQUIRED");
  await ok("/api/documents/verify", { documentId: updated.id, decision: "ACCEPTED" }, owner.cookie);
  const signed = await ok(`/api/documents/${updated.id}/file`, {}, owner.cookie);
  check("Signed private file is readable", () => {}); assert.equal((await get(signed.url)).status, 200);
  const foreign = await prisma.document.create({ data: { docNo: "DOC-FOREIGN", customerId: bob.id, travellerId: bobTraveller.id, docType: "Passport" } });
  check("Public link cannot modify another customer document", () => {}); assert.equal((await upload(foreign.id)).status, 403);
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "READ_ONLY" } });
  const staff = await ok("/api/employees", { name: "Read Only Regression", email: "readonly@example.test", roleId: role.id, password }, owner.cookie);
  const readonly = await login("readonly@example.test");
  await status("Read-only cannot record payments", "/api/payments", { customerId: alice.id, amount: 1 }, readonly.cookie, 403);
  await status("Owner cannot deactivate themselves", "/api/employees", { id: owner.user.id, active: false }, owner.cookie, 400);
  await ok("/api/employees", { id: staff.employeeId, active: false }, owner.cookie);
  check("Deactivation revokes existing session", () => {}); assert.equal((await get("/api/pulse", readonly.cookie)).status, 401);
  const salesRole = await prisma.role.findUniqueOrThrow({ where: { key: "SALES_EXECUTIVE" } });
  await ok("/api/employees", { name: "Sales Regression", email: "sales@example.test", roleId: salesRole.id, password }, owner.cookie);
  const sales = await login("sales@example.test");
  const search = await (await get("/api/search?q=Alice", sales.cookie)).json();
  check("Assigned search does not leak another staff's customer", () => assert.equal(search.groups.length, 0));
  const restrictedCustomer = await (await get(`/customers/${alice.id}`, sales.cookie)).text();
  check("Cross-scope customer renders missing-record UI without customer details", () => {
    // Next App Router can stream a notFound boundary with HTTP 200 after its layout flushes.
    assert(restrictedCustomer.includes("This page isn’t available."));
    assert(!restrictedCustomer.includes("Alice Regression"));
    assert(!restrictedCustomer.includes("alice@example.test"));
  });
  await status("Cross-scope case creation forbidden", "/api/visa/cases", { customerId: alice.id, travellerIds: [aliceTraveller.id], destination: "Test", visaType: "Visitor" }, sales.cookie, 403);
  const hrRole = await prisma.role.findUniqueOrThrow({ where: { key: "HR" } });
  await ok("/api/employees", { name: "HR Regression", email: "hr@example.test", roleId: hrRole.id, password }, owner.cookie);
  const hr = await login("hr@example.test");
  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { key: "OWNER" } });
  await status("HR cannot create an owner", "/api/employees", { name: "Escalation", email: "escalation@example.test", roleId: ownerRole.id, password }, hr.cookie, 403);
  const hrPulse = await (await get("/api/pulse", hr.cookie)).json();
  // The dashboard had a "Needs attention" tile beside the module KPIs; it repeated the count already
  // on the attention panel's own heading and is gone, so for an HR role with no visa, ticketing or
  // invoice permission the KPI list is now genuinely empty rather than empty-but-for-one-tile.
  check("HR pulse exposes no finance or visa KPIs", () => { assert.equal(hrPulse.kpis.length, 0); assert.equal(hrPulse.counts.urgent + hrPulse.counts.high, hrPulse.items.filter(i => i.severity !== "MEDIUM").length); });
  const searchOwner = await (await get("/api/search?q=Alice", owner.cookie)).json();
  check("Owner search returns linked actual records", () => assert(searchOwner.groups.some(g => g.key === "CUSTOMER")));
  const legacyMarks = ["bg-zinc-950", "text-zinc-100", "Skyline", "demo1234", "owner@travelos.in"];
  for (const route of [...routes, `/customers/${alice.id}`, `/visa/${visa.caseId}`, `/ticketing/${booking.bookingId}`, `/employees/${owner.user.id}`, `/upload/${link.token}`]) {
    const r = await get(route, owner.cookie); const html = await r.text();
    check(`Populated route ${route.split("/").slice(0,2).join("/")}`, () => assert.equal(r.status, 200));
    check(`Light workspace UI on ${route.split("/").slice(0,2).join("/")}`, () => { for (const mark of legacyMarks) assert(!html.includes(mark), `legacy marker ${mark}`); });
  }
  // --- Money owed must be counted the same way everywhere --------------------------------
  // Booking 1 has taken ₹50 and returned ₹10, so it still owes ₹170.30 of its ₹210.30. An
  // "unpaid invoices only" total would report ₹0; a gross-receipts total would report ₹160.30.
  // These checks pin the shared definition in lib/receivables.
  const booking2 = await ok("/api/bookings", { customerId: alice.id, travellerIds: [aliceTraveller.id], sector: "AAA → CCC", fare: 300 }, owner.cookie);
  const case2 = await ok("/api/visa/cases", { customerId: alice.id, travellerIds: [aliceTraveller.id], destination: "Regression destination", visaType: "Visitor", visaFee: 100, serviceFee: 50 }, owner.cookie);
  const general = await ok("/api/invoices", { customerId: bob.id, amount: 25, description: "General regression invoice" }, owner.cookie);
  let moneyPulse = await (await get("/api/pulse", owner.cookie)).json();
  check("Receivables include unpaid bookings and visa cases, not invoices alone", () => {
    assert.equal(moneyPulse.receivables.bookings, 470.30);
    assert.equal(moneyPulse.receivables.visaCases, 150);
    assert.equal(moneyPulse.receivables.unlinkedInvoices, 25);
    assert.equal(moneyPulse.receivables.unpaidWork, 3);
    assert.equal(moneyPulse.receivables.total, 645.30);
    assert.equal(moneyPulse.kpis.find(k => k.label === "Receivables").value, "₹645.3");
  });
  check("Money returned raises what the customer still owes", () => {
    // 210.30 − (50 received − 10 refunded) = 170.30 for booking 1, plus booking 2's unpaid 300.
    assert.equal(moneyPulse.receivables.bookings, 470.30);
  });
  await ok("/api/payments", { customerId: bob.id, invoiceId: general.invoiceId, amount: 10, mode: "CASH" }, owner.cookie);
  moneyPulse = await (await get("/api/pulse", owner.cookie)).json();
  check("A part-paid standalone invoice counts only its remaining balance", () => {
    assert.equal(moneyPulse.receivables.unlinkedInvoices, 15);
    assert.equal(moneyPulse.receivables.openInvoices, 1);
    assert.equal(moneyPulse.receivables.total, 635.30);
  });
  check("A work-linked invoice is not counted twice", () => {
    // The paid visa invoice is excluded because the visa case's own balance already covers it, so
    // the total is bookings 470.30 + visa 150 + standalone 15 and never 150 again.
    assert.equal(moneyPulse.receivables.visaCases, 150);
    assert.equal(moneyPulse.receivables.total, 635.30);
  });
  const moneyPage = await (await get("/payments", owner.cookie)).text();
  check("Money page shows the same receivables total as the dashboard", () => {
    assert(moneyPage.includes("Outstanding receivables"));
    assert(moneyPage.includes("₹635.30"));
  });
  // --- Cash refunds do not implicitly cancel an active sale ----------------------------
  await ok("/api/payments", { customerId: alice.id, bookingId: booking2.bookingId, amount: 50, mode: "UPI" }, owner.cookie);
  const beforeFullRefundStatus = (await prisma.booking.findUniqueOrThrow({ where: { id: booking2.bookingId } })).status;
  const fullRefund = await ok("/api/refunds", { customerId: alice.id, bookingId: booking2.bookingId, amount: 50, reason: "Trip cancelled" }, owner.cookie);
  for (const stage of ["SUPPLIER_PENDING", "SUPPLIER_RECEIVED", "APPROVED", "PROCESSED", "PAID"]) await ok("/api/refunds/update", { refundId: fullRefund.refund.id, status: stage }, owner.cookie);
  const refundedBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking2.bookingId } });
  check("Returning every receipt does not implicitly cancel the sale", () => assert.equal(refundedBooking.status, beforeFullRefundStatus));
  moneyPulse = await (await get("/api/pulse", owner.cookie)).json();
  check("Cash refund alone preserves the agreed customer demand", () => assert.equal(moneyPulse.receivables.total, 635.30));
  await ok("/api/bookings/status", { bookingId: booking2.bookingId, status: "CANCELLED", refundAmount: 0, cancellationSupplierCharge: 0, cancellationAgencyFee: 0, cancellationReason: "Explicit cancellation after deposit return" }, owner.cookie);
  moneyPulse = await (await get("/api/pulse", owner.cookie)).json();
  check("A withdrawn booking drops out of receivables", () => {
    assert.equal(moneyPulse.receivables.bookings, 170.30);
    assert.equal(moneyPulse.receivables.unpaidWork, 2);
    assert.equal(moneyPulse.receivables.total, 335.30);
  });
  const receiptsBefore = await prisma.payment.count();
  await status("Receipts cannot be allocated to a withdrawn booking", "/api/payments", { customerId: alice.id, bookingId: booking2.bookingId, amount: 5 }, owner.cookie, 400);
  assert.equal(await prisma.payment.count(), receiptsBefore);
  await status("A sale cannot be marked refunded by hand", "/api/bookings/status", { bookingId: booking.bookingId, status: "REFUNDED" }, owner.cookie, 400);
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: booking.bookingId } })).status, "TICKETED");
  await status("A withdrawn sale stays closed", "/api/bookings/status", { bookingId: booking2.bookingId, status: "TICKETED" }, owner.cookie, 400);
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: booking2.bookingId } })).status, "CANCELLED");
  assert(booking2.bookingId && case2.caseId);
  const refundBookingPage = await (await get(`/ticketing/${booking.bookingId}`, owner.cookie)).text();
  check("A partly refunded booking shows its refunds and net receipts on the sale", () => {
    assert(refundBookingPage.includes("net received"));
    assert(refundBookingPage.includes("₹10 refunded"));
  });
  const bookingPage = await (await get(`/ticketing/${booking.bookingId}`, owner.cookie)).text();
  check("An uncosted booking never shows the selling price as profit", () => {
    assert(bookingPage.includes("Recorded markup &amp; service fee"));
    assert(bookingPage.includes("Supplier cost is not recorded"));
    assert(bookingPage.includes("Not entered"));
  });
  // --- The dashboard date chip must be formatted on the server only ----------------------
  const dashHtml = await (await get("/dashboard", owner.cookie)).text();
  check("Dashboard day chip is server-computed, so React hydration cannot disagree", () => {
    assert(dashHtml.includes("todayLabel"), "day label is passed down as a prop");
    assert(/[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]+/.test(dashHtml), "server-rendered day chip");
  });
  // --- Private workspace hardening -------------------------------------------------------
  const hardened = await get("/login", "", "manual");
  const hardenedHtml = await hardened.text();
  check("Private workspace is not indexable and leaks no framework version", () => {
    assert.equal(hardened.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.equal(hardened.headers.get("x-content-type-options"), "nosniff");
    assert.equal(hardened.headers.get("x-powered-by"), null);
    assert(hardenedHtml.includes("noindex"));
  });
  // --- Shell layout and copy hygiene -----------------------------------------------------
  check("Dashboard carries no decorative hero copy", () => {
    for (const mark of ["THE BIG PICTURE", "A fresh workspace.", "Every detail connected", "YOUR DAY"])
      assert(!dashHtml.includes(mark), `decorative copy ${mark}`);
  });
  const modulePaths = ["/ticketing", "/visa", "/customers", "/documents", "/payments", "/refunds", "/tasks", "/suppliers", "/employees", "/checklists", "/settings", "/whatsapp", "/notifications", "/audit"];
  const moduleHtml = (await Promise.all(modulePaths.map(async (p) => (await get(p, owner.cookie)).text()))).join("\n");
  check("Module pages carry plain operational headings, not marketing copy", () => {
    for (const mark of [
      "AIR OPERATIONS", "From enquiry to take-off.",
      "RELATIONSHIPS", "Every customer. One clear view.", "connected home for your customers",
      "VISA OPERATIONS", "Dossiers, beautifully organized.", "From first enquiry to passport delivery",
      "PAPERWORK, WITH PEACE OF MIND", "review real uploads and keep sensitive files private",
      "FINANCE, WITHOUT THE FRICTION", "Know exactly what", "A CLEAR REQUEST FOR PAYMENT",
      "CLOSE THE LOOP", "supplier follow-up to approval and recorded payout",
      "CONVERSATIONS, CONNECTED", "NOTHING IMPORTANT, MISSED", "ACCOUNTABILITY, BUILT IN",
      "KEEP EVERY PROMISE", "YOUR PARTNER NETWORK", "THE PEOPLE BEHIND THE JOURNEYS",
      "PREPARATION, STANDARDIZED", "MAKE IT YOURS", "A JOURNEY BEGINS", "A WELL-PREPARED JOURNEY",
      "A NEW RELATIONSHIP", 'class="eyebrow"',
    ])
      assert(!moduleHtml.includes(mark), `marketing copy ${mark}`);
    for (const plain of [
      "Track flight bookings and manual hotel stays, guests, supplier references and flight ticketing deadlines.",
      "Track applicants, destination requirements, documents and stages.",
      "Document requirements and uploaded files for each traveller.",
      "Invoices, receipts and outstanding balances.",
      "Refund requests recorded against bookings.",
      "The next action, its owner, priority and due date.",
    ])
      assert(moduleHtml.includes(plain), `plain heading ${plain}`);
  });
  check("First-run setup asks for an agency, without marketing framing", () => {
    assert(setupPage.includes("Set up your agency"));
    for (const mark of ["A FRESH START", "Your agency. Your workspace.", "Private workspace · Role-based access"])
      assert(!setupPage.includes(mark), `setup copy ${mark}`);
  });
  // Next may emit the local-font sheet before the application sheet. Check the full linked
  // stylesheet set instead of assuming a particular chunk ordering.
  const cssHrefs = [...new Set([...dashHtml.matchAll(/href="([^"]*\/_next\/static\/css\/[^"]+)"/g)].map(match => match[1].replace(/^https?:\/\/[^/]+/, "")))];
  const cssHref = cssHrefs[0];
  const appCss = (await Promise.all(cssHrefs.map(async href => (await get(href)).text()))).join("\n");
  check("Desktop sidebar reset ships in the built CSS", () => {
    // The shell adds -translate-x-full to the rail for the mobile drawer; without this later, more
    // specific reset the desktop sidebar is parked 244px off-screen and the app looks empty on the left.
    assert(cssHref, "stylesheet link found");
    assert(appCss.includes("aside.app-sidebar{transform:none}"), "desktop rail reset present");
  });
  check("Closed phone drawer ships untabbable in the built CSS", () => {
    // Off-canvas is not the same as out of reach: with only a transform, the drawer's 15 controls
    // stayed in the tab order and in the accessibility tree while sitting at x≈-196. The quoted
    // attribute value may be minified away, hence the optional quotes.
    assert(cssHref, "stylesheet link found");
    assert(/aside\.app-sidebar\[data-drawer="?closed"?\]\{visibility:hidden\}/.test(appCss), "closed drawer hidden below lg");
  });
  const templates = await (await get("/api/quick-replies", owner.cookie)).json();
  check("Built-in message templates are always offered", () => {
    for (const key of ["PAYMENT_REMINDER", "PNR_EXPIRY", "DOC_REQUEST", "STATUS_UPDATE", "APPOINTMENT_REMINDER"])
      assert(templates.templates.some(t => t.key === key), `template ${key}`);
  });
  const doomed = await ok("/api/upload-links", { customerId: alice.id }, owner.cookie);
  await status("Unknown upload link cannot be revoked", "/api/upload-links/revoke", { linkId: "missing" }, owner.cookie, 404);
  await ok("/api/upload-links/revoke", { linkId: doomed.linkId }, owner.cookie);
  const deadForm = new FormData(); deadForm.append("docType", "Passport"); deadForm.append("file", pdf, "passport.pdf");
  check("A revoked upload link stops working", () => {});
  assert.equal((await fetch(`${BASE}/api/upload/${doomed.token}`, { method: "POST", body: deadForm })).status, 410);
  const opsRole = await prisma.role.findUniqueOrThrow({ where: { key: "OPERATIONS" } });
  await ok("/api/employees", { name: "Ops Regression", email: "ops@example.test", roleId: opsRole.id, password }, owner.cookie);
  const ops = await login("ops@example.test");
  const opsBookingPage = await (await get(`/ticketing/${booking.bookingId}`, ops.cookie)).text();
  check("Booking money is hidden without finance visibility", () => {
    assert(opsBookingPage.includes("restricted for your role"));
    assert(!opsBookingPage.includes("Base fare"));
  });
  const opsCasePage = await (await get(`/visa/${visa.caseId}`, ops.cookie)).text();
  check("Case money is hidden without finance visibility", () => {
    assert(opsCasePage.includes("Fee and receipt figures are restricted"));
    assert(!opsCasePage.includes("Visa fee"));
  });
  await status("Case fees cannot change without finance visibility", `/api/visa/cases/${visa.caseId}/edit`, { sellingPrice: 999 }, ops.cookie, 403);
  await ok(`/api/visa/cases/${visa.caseId}/edit`, { internalNotes: "Regression note" }, ops.cookie);
  await ok("/api/settings", { "agency.name": "Verified Agency", "agency.city": "Pune", "pnr.warning.hours": 48, "pnr.urgent.hours": 12, "passport.min.validity.months": 6 }, owner.cookie);
  const exportCsv = await (await get("/api/export?entity=invoices", owner.cookie)).text();
  check("CSV export contains actual invoice", () => assert(exportCsv.includes(inv.invoiceNo)));
  const exportVisaCsv = await (await get("/api/export?entity=visa", owner.cookie)).text();
  check("Finance-visible export carries the money columns", () => {
    // These are the column names a CSV would leak. export/route.ts drops all three for anyone without
    // payment:view, so this check is here to notice if they ever stop being produced and the masking
    // rule starts stripping them from everyone instead.
    for (const column of ["sellingPrice", "received", "outstanding"]) assert(exportVisaCsv.includes(column), column);
  });

  // ── Money and permission regressions ───────────────────────────────────────────────────────
  const bookingStatus = async id => (await prisma.booking.findUniqueOrThrow({ where: { id } })).status;
  const caseOutcome = async id => (await prisma.visaCase.findUniqueOrThrow({ where: { id } })).visaOutcome;

  // Recording a decision and taking one back are the same privilege. Only the first one used to need
  // approval permission, so anyone who could edit a case could quietly reopen an APPROVED one.
  const visaExecRole = await prisma.role.findUniqueOrThrow({ where: { key: "VISA_EXECUTIVE" } });
  await ok("/api/employees", { name: "Visa Exec Regression", email: "visaexec@example.test", roleId: visaExecRole.id, password }, owner.cookie);
  const execSession = await login("visaexec@example.test");
  const approvedStage = await prisma.visaStage.findUniqueOrThrow({ where: { key: "APPROVED" } });
  const earlyStage = await prisma.visaStage.findFirstOrThrow({ where: { key: "ASSESSMENT" } });
  const exemptChecklist = await prisma.checklist.create({ data: { country: "Regression destination", visaType: "Visitor", applicantType: "EXEMPT" } });
  await ok("/api/visa/requirements", { caseId: case2.caseId, travellerId: aliceTraveller.id, checklistId: exemptChecklist.id }, owner.cookie);
  await ok(`/api/visa/cases/${case2.caseId}/stage`, { stageId: approvedStage.id }, owner.cookie);
  const outcomeBefore = await caseOutcome(case2.caseId);
  check("A recorded decision is written to the case", () => assert.equal(outcomeBefore, "APPROVED"));
  await status("Reopening a decided case needs approval permission", `/api/visa/cases/${case2.caseId}/stage`, { stageId: earlyStage.id }, execSession.cookie, 403);
  check("A refused reopening leaves the decision standing", () => assert.equal(outcomeBefore, "APPROVED"));
  assert.equal(await caseOutcome(case2.caseId), "APPROVED");

  // Cancelling a sale that still holds customer money used to drop it out of receivables with nothing
  // recording what was owed. It now raises that refund, and only somebody who can raise one may do it.
  const paidBooking = await ok("/api/bookings", { customerId: alice.id, travellerIds: [aliceTraveller.id], pnr: "REG002", sector: "AAA → DDD", fare: 30 }, owner.cookie);
  await ok("/api/payments", { customerId: alice.id, bookingId: paidBooking.bookingId, amount: 30, mode: "UPI" }, owner.cookie);
  const ticketingExecRole = await prisma.role.findUniqueOrThrow({ where: { key: "TICKETING_EXECUTIVE" } });
  await ok("/api/employees", { name: "Ticketing Exec Regression", email: "ticketingexec@example.test", roleId: ticketingExecRole.id, password }, owner.cookie);
  const ticketingExec = await login("ticketingexec@example.test");
  await status("Cancelling a paid booking needs refund permission", "/api/bookings/status", { bookingId: paidBooking.bookingId, status: "CANCELLED", refundAmount: 30, cancellationSupplierCharge: 0, cancellationAgencyFee: 0, cancellationReason: "Synthetic full-refund cancellation" }, ticketingExec.cookie, 403);
  const stillOpen = await bookingStatus(paidBooking.bookingId);
  check("A refused cancellation leaves the booking open", () => assert.equal(stillOpen, "PNR_CREATED"));
  await status("Cancelling without saying what to refund is refused", "/api/bookings/status", { bookingId: paidBooking.bookingId, status: "CANCELLED" }, owner.cookie, 400);
  await status("A refund larger than the money held is refused", "/api/bookings/status", { bookingId: paidBooking.bookingId, status: "CANCELLED", refundAmount: 31, cancellationSupplierCharge: 0, cancellationAgencyFee: 0, cancellationReason: "Synthetic excessive-refund check" }, owner.cookie, 400);
  const refundsBefore = await prisma.refund.count({ where: { bookingId: paidBooking.bookingId } });
  check("No refund is raised by a refused cancellation", () => assert.equal(refundsBefore, 0));
  const cancelled = await ok("/api/bookings/status", { bookingId: paidBooking.bookingId, status: "CANCELLED", refundAmount: 30, cancellationSupplierCharge: 0, cancellationAgencyFee: 0, cancellationReason: "Synthetic full-refund cancellation" }, owner.cookie);
  const raised = await prisma.refund.findFirstOrThrow({ where: { bookingId: paidBooking.bookingId } });
  check("Cancelling a paid booking raises the refund it owes", () => {
    assert.equal(raised.amount, 30);
    assert.equal(raised.status, "REQUESTED");
    assert.equal(cancelled.refundNo, raised.refundNo);
  });
  // The sale already ended as a cancellation, so paying the money back must not rewrite that.
  for (const stage of ["SUPPLIER_PENDING", "SUPPLIER_RECEIVED", "APPROVED", "PROCESSED", "PAID"]) await ok("/api/refunds/update", { refundId: raised.id, status: stage }, owner.cookie);
  const afterRefundPaid = await bookingStatus(paidBooking.bookingId);
  check("A completed refund does not overwrite a cancellation", () => assert.equal(afterRefundPaid, "CANCELLED"));

  // A price below what has already been collected leaves a negative balance that receivables clamps
  // away, so the case looks fully paid while the agency is the one holding the money.
  await status("Selling price cannot drop below money received", `/api/visa/cases/${visa.caseId}/edit`, { sellingPrice: 50 }, owner.cookie, 400);
  const priceBefore = (await prisma.visaCase.findUniqueOrThrow({ where: { id: visa.caseId } })).sellingPrice;
  check("A refused price change leaves the case untouched", () => assert.equal(priceBefore, 100.10));

  await status("Supplier settlement reversal requires a reason", "/api/suppliers/dues", { action: "reverse", dueId: payable.due.id, settlementId: supplierSettlement.settlement.id, reason: "bad" }, owner.cookie, 400);
  await ok("/api/suppliers/dues", { action: "reverse", dueId: payable.due.id, settlementId: supplierSettlement.settlement.id, reason: "Duplicate supplier payment" }, owner.cookie);
  const reversedDue = await prisma.supplierDue.findUniqueOrThrow({ where: { id: payable.due.id } });
  const reversalRecord = await prisma.supplierSettlement.findUniqueOrThrow({ where: { id: supplierSettlement.settlement.id } });
  check("Reversal preserves the original supplier settlement", () => { assert.equal(reversedDue.paidAmount, 0); assert(reversalRecord.reversedOn); assert.equal(reversalRecord.reversalReason, "Duplicate supplier payment"); });
  const resettled = await ok("/api/suppliers/dues", { dueId: payable.due.id, amount: 12.34, method: "BANK_TRANSFER", requestKey: `smoke-${randomBytes(8).toString("hex")}` }, owner.cookie);
  check("A reversed payable can be settled again", () => { assert.equal(resettled.due.paid, true); assert.equal(resettled.due.paidAmount, 12.34); });

  // HR may administer HR and read-only accounts, but resetting a colleague's password hands over
  // that person's whole account, salary and bank details included.
  const secondHr = await ok("/api/employees", { name: "HR Two", email: "hr2@example.test", roleId: hrRole.id, password }, owner.cookie);
  await status("HR cannot reset a peer's password", "/api/employees", { id: secondHr.employeeId, name: "HR Two", email: "hr2@example.test", password: "Different-Password-9" }, hr.cookie, 403);
  const stillActive = await prisma.user.count({ where: { id: secondHr.employeeId, active: true } });
  check("A refused password reset leaves the account active", () => assert.equal(stillActive, 1));

  // An invoice on a withdrawn sale is a demand for money that is no longer owed.
  await status("No invoice for a withdrawn booking", "/api/invoices", { customerId: alice.id, bookingId: booking2.bookingId, amount: 10 }, owner.cookie, 400);

  // Refund progress lives on the refund itself. Setting these by hand claimed money was on its way
  // back with no request behind it and nothing recording what was owed.
  for (const manual of ["REFUND_REQUESTED", "REFUND_PENDING"]) {
    await status(`${manual} cannot be set by hand`, "/api/bookings/status", { bookingId: booking.bookingId, status: manual }, owner.cookie, 400);
  }
  const untouchedSale = await bookingStatus(booking.bookingId);
  check("A refused refund state leaves the sale untouched", () => assert.equal(untouchedSale, "TICKETED"));

  // An unparseable date used to reach Prisma as an Invalid Date and surface as an opaque 500.
  await status("An unparseable traveller date is rejected, not a crash", "/api/travellers", { customerId: alice.id, fullName: "Bad Date", dateOfBirth: "not-a-date" }, owner.cookie, 400);
  await status("An unknown traveller relation is rejected", "/api/travellers", { customerId: alice.id, fullName: "Bad Relation", relation: "COUSIN" }, owner.cookie, 400);
  await status("A passport that expired years ago is rejected", "/api/travellers", { customerId: alice.id, fullName: "Old Passport", passportExpiry: "2001-01-01" }, owner.cookie, 400);
  const strays = await prisma.traveller.count({ where: { fullName: { in: ["Bad Date", "Bad Relation", "Old Passport"] } } });
  check("A refused traveller leaves no half-written record", () => assert.equal(strays, 0));

  // Passport edits were dropped with a success response, so staff walked away believing a correction
  // had saved when the old number was still on file. TICKETING_EXECUTIVE can edit travellers but has
  // no sensitive:view, which is the pair of permissions that made the old behaviour reachable.
  const scopedCustomer = await ok("/api/customers", { name: "Passport Scope", phone: "+919000000010", assignedToId: ticketingExec.user.id }, owner.cookie);
  const scopedTraveller = await prisma.traveller.findFirstOrThrow({ where: { customerId: scopedCustomer.id } });
  await ok(`/api/travellers/${aliceTraveller.id}`, { passportNumber: "P1234567" }, owner.cookie);
  await status("Passport edits are refused, not silently dropped", `/api/travellers/${scopedTraveller.id}`, { passportNumber: "P7654321" }, ticketingExec.cookie, 403);
  const storedPassport = (await prisma.traveller.findUniqueOrThrow({ where: { id: scopedTraveller.id } })).passportNumber;
  check("A refused passport edit leaves the stored number alone", () => assert.equal(storedPassport, null));
  const keptPassport = (await prisma.traveller.findUniqueOrThrow({ where: { id: aliceTraveller.id } })).passportNumber;
  check("A permitted passport edit still saves", () => assert.equal(keptPassport, "P1234567"));

  // An expired passport is ordinary data, not a mistake, and the traveller form always posts the
  // expiry. A rule that refused any past date would therefore block every other edit to the many
  // travellers whose passports have run out.
  await prisma.traveller.update({ where: { id: scopedTraveller.id }, data: { passportExpiry: new Date("2020-03-15") } });
  await ok(`/api/travellers/${scopedTraveller.id}`, { fullName: "Renamed After Expiry", passportExpiry: "2020-03-15" }, owner.cookie);
  const renamedAfterExpiry = await prisma.traveller.findUniqueOrThrow({ where: { id: scopedTraveller.id } });
  check("An expired passport does not block unrelated edits", () => assert.equal(renamedAfterExpiry.fullName, "Renamed After Expiry"));
  await status("A newly typed expiry that has already run out is still caught", `/api/travellers/${scopedTraveller.id}`, { passportExpiry: "2019-01-01" }, owner.cookie, 400);

  // Unbounded free text is stored whole, or quietly cut off at the column, and nobody is told.
  await status("An oversized customer address is rejected", "/api/customers", { name: "Too Long", phone: "+919000000009", address: "x".repeat(1200) }, owner.cookie, 400);
  const strayCustomers = await prisma.customer.count({ where: { name: "Too Long" } });
  check("A refused customer leaves no partial record", () => assert.equal(strayCustomers, 0));
  await status("An oversized supplier contact is rejected", `/api/suppliers/${supplier.supplier.id}`, { contact: "y".repeat(400) }, owner.cookie, 400);

  // Deactivating a stage the workflow starts from, or one that open cases sit in, strands live work.
  const enquiryStage = await prisma.visaStage.findUniqueOrThrow({ where: { key: "ENQUIRY" } });
  await status("The enquiry stage cannot be deactivated", "/api/visa/stages", { id: enquiryStage.id, active: false }, owner.cookie, 400);
  const holdStage = await ok("/api/visa/stages", { name: "Regression hold" }, owner.cookie);
  await ok(`/api/visa/cases/${case2.caseId}/stage`, { stageId: holdStage.stage.id }, owner.cookie);
  await status("A stage with open cases cannot be deactivated", "/api/visa/stages", { id: holdStage.stage.id, active: false }, owner.cookie, 400);
  const stageActive = (await prisma.visaStage.findUniqueOrThrow({ where: { id: holdStage.stage.id } })).active;
  check("A refused deactivation leaves the stage selectable", () => assert.equal(stageActive, true));
  // Reports must reconcile with operational money without counting linked invoices twice.
  check("Unauthenticated reporting is rejected", () => {});
  assert.equal((await get("/api/reports")).status,401);
  check("HR cannot access financial reporting", () => {});
  assert.equal((await get("/api/reports",hr.cookie)).status,403);
  for (const query of ["from=2026-02-30", "from=2026-10-12&to=2026-10-01", "from=2020-01-01&to=2026-01-01"]) {
    const response=await get("/api/reports?"+query,owner.cookie);
    check("Invalid reporting period rejected: "+query,()=>assert.equal(response.status,400));
  }
  const reportResponse=await get("/api/reports",owner.cookie);
  assert.equal(reportResponse.status,200);
  const report=await reportResponse.json();
  const currentPulse=await (await get("/api/pulse",owner.cookie)).json();
  check("Reporting outstanding reconciles with dashboard",()=>assert.equal(report.receivables.total,currentPulse.receivables.total));
  const periodStart=new Date(report.period.from+"T00:00:00+05:30"),periodEnd=new Date(new Date(report.period.to+"T00:00:00+05:30").getTime()+86400000);
  const receiptSum=await prisma.payment.aggregate({where:{receivedOn:{gte:periodStart,lt:periodEnd}},_sum:{amount:true}});
  check("Report collections include all period receipts",()=>assert.equal(report.collected,Math.round((receiptSum._sum.amount||0)*100)/100));
  check("Monthly trends reconcile with report totals",()=>{assert.equal(Math.round(report.trend.reduce((s,r)=>s+r.sales,0)*100),Math.round(report.sales*100));assert.equal(Math.round(report.trend.reduce((s,r)=>s+r.collections,0)*100),Math.round(report.collected*100));});
  const reportCsv=await get("/api/reports?format=csv",owner.cookie);
  check("Reporting CSV exports an auditable financial summary",()=>{assert.equal(reportCsv.status,200);assert(reportCsv.headers.get("content-disposition").includes("agency-report"));});
  assert((await reportCsv.text()).includes('"Current receivables"'));
  check("Reporting export is audited",()=>{});
  assert(await prisma.auditLog.findFirst({where:{entity:"reports",action:"EXPORT"}}));
  const reportsPage=await get("/reports",owner.cookie);
  check("Reports workspace renders",()=>assert.equal(reportsPage.status,200));
  assert.equal((await get("/api/reports/accounts?report=ageing")).status,401);
  assert.equal((await get("/api/reports/accounts?report=ageing",hr.cookie)).status,403);
  check("Financial account reports require finance access",()=>{});
  const optionsResponse=await get("/api/reports/accounts?options=1",owner.cookie);
  const accountOptions=await optionsResponse.json();
  check("Report options expose permitted accounts and journal cutoff",()=>{assert.equal(optionsResponse.status,200);assert(accountOptions.cutover);assert(accountOptions.customers.some(c=>c.id===alice.id));});
  const statementQuery="report=statement&customerId="+alice.id;
  const statementResponse=await get("/api/reports/accounts?"+statementQuery,owner.cookie);
  const accountStatement=await statementResponse.json();
  check("Customer statement API has running balances",()=>{assert.equal(statementResponse.status,200);assert(accountStatement.summary.some(s=>s.label==="Closing balance"));assert(accountStatement.rows.every(row=>typeof row.balance==="number"));});
  for(const format of ["csv","xlsx","pdf"]){const exported=await get("/api/reports/accounts?"+statementQuery+"&format="+format,owner.cookie);check("Customer statement exports "+format,()=>{assert.equal(exported.status,200);assert(exported.headers.get("content-disposition").endsWith('.'+format+'"'));});await exported.arrayBuffer();}
  assert(await prisma.auditLog.findFirst({where:{entity:"FinancialReport",action:"EXPORT"}}));
  check("Financial statement exports are audited",()=>{});
  await status("Invalid payment term date rejected","/api/reports/terms",{type:"Booking",id:booking.bookingId,dueDate:"2026-02-30"},owner.cookie,400);
  const reportBranch=await prisma.branch.create({data:{name:"Isolated reporting branch",code:"REPORT",city:"Pune"}});
  const managerRole=await prisma.role.findUniqueOrThrow({where:{key:"BRANCH_MANAGER"}});
  const ownerRecord=await prisma.user.findUniqueOrThrow({where:{id:owner.user.id}});
  await prisma.user.create({data:{name:"Report branch manager",employeeCode:"EMP-REPORT",phone:"+919000000099",email:"report-manager@example.test",passwordHash:ownerRecord.passwordHash,roleId:managerRole.id,branchId:reportBranch.id}});
  const reportManager=await login("report-manager@example.test");
  const scopedReport=await (await get("/api/reports",reportManager.cookie)).json();
  check("Branch reporting excludes other branches' records",()=>{assert.equal(scopedReport.sales,0);assert.equal(scopedReport.collected,0);assert.equal(scopedReport.receivables.total,0);assert.equal(scopedReport.outstanding.length,0);});
  const boundaryInvoice=await prisma.invoice.create({data:{invoiceNo:"INV-REPORT-BOUNDARY",customerId:alice.id,amount:12.34,issuedOn:new Date("2025-06-01T18:29:59.999Z")}});
  const inclusiveReport=await (await get("/api/reports?from=2025-06-01&to=2025-06-01",owner.cookie)).json();
  check("Reporting includes the last millisecond of the India calendar day",()=>assert.equal(inclusiveReport.sales,12.34));
  await prisma.invoice.update({where:{id:boundaryInvoice.id},data:{issuedOn:new Date("2025-06-01T18:30:00.000Z")}});
  const exclusiveReport=await (await get("/api/reports?from=2025-06-01&to=2025-06-01",owner.cookie)).json();
  check("Reporting excludes midnight of the next India calendar day",()=>assert.equal(exclusiveReport.sales,0));
  const notification=await prisma.notification.create({data:{userId:owner.user.id,title:"Explicit read regression"}});
  await get("/notifications",owner.cookie);
  check("Viewing notifications does not silently clear unread items",()=>{});
  assert.equal((await prisma.notification.findUniqueOrThrow({where:{id:notification.id}})).read,false);
  await ok("/api/notifications",{},owner.cookie);
  check("Explicit mark-read updates the signed-in user's inbox",()=>{});
  assert.equal((await prisma.notification.findUniqueOrThrow({where:{id:notification.id}})).read,true);
  const fixture = { base: BASE, database, uploadRoot: env.UPLOAD_ROOT, jwtSecret: env.JWT_SECRET, password, ownerEmail: "owner@example.test", ownerId: owner.user.id, customerId: alice.id, bookingId: booking.bookingId, visaCaseId: visa.caseId, uploadToken: link.token };
  writeFileSync(path.join(runtime, "fixture.json"), JSON.stringify(fixture, null, 2));
  writeFileSync(path.join(ROOT, "tests", ".runtime", "latest.json"), JSON.stringify({ runtime, fixture: path.join(runtime, "fixture.json") }));
  writeFileSync(path.join(ROOT, "docs", "verification-results.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), passed, checks, isolation: "Temporary SQLite database and private uploads; live database untouched" }, null, 2) + "\n");
  console.log(`\n${passed} checks passed. Isolated fixture saved for optional browser verification.`);
}
try { await run(); } catch (e) { console.error(e); process.exitCode = 1; }
finally { await prisma.$disconnect(); if (server?.pid) { if (process.platform === "win32") { try { execFileSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "pipe" }); } catch {} } else { server.kill("SIGTERM"); } } out.end(); }
