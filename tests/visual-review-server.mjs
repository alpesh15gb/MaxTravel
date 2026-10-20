// Persistent visual-review workspace: isolated DB, its own port, seeded with realistic data. Not for live data.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, createWriteStream, writeFileSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const ROOT = process.cwd();
const runtime = path.join(ROOT, "tests", ".runtime", `visual-review-${Date.now()}`);
mkdirSync(runtime, { recursive: true });
writeFileSync(path.join(runtime, "test.db"), Buffer.alloc(0));
const database = `file:${path.join(runtime, "test.db").replaceAll("\\", "/")}`;
const PORT = Number(process.env.REVIEW_PORT ?? 3214);
const dev = process.env.REVIEW_DEV === "1";
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error("Invalid review port");
await new Promise((resolve, reject) => { const s = net.createServer(); s.once("error", reject); s.listen(PORT, "127.0.0.1", () => s.close(resolve)); });
const BASE = `http://127.0.0.1:${PORT}`;
const password = "Review-Visual-2026!";
const env = { ...process.env, DATABASE_URL: database, JWT_SECRET: randomBytes(32).toString("hex"), UPLOAD_ROOT: path.join(runtime, "uploads"), ...(dev ? { NEXT_DIST_DIR: ".next-review" } : {}) };
const prisma = new PrismaClient({ datasources: { db: { url: database } } });
// Migrations, not db push: the review workspace must be built the way a deployment is, or it can
// hide a schema change that never made it into prisma/migrations.
execFileSync(process.execPath, [path.join(ROOT, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: ROOT, env, stdio: "pipe" });
const log = createWriteStream(path.join(runtime, "server.log"));
const server = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), dev ? "dev" : "start", "--port", String(PORT), "--hostname", "127.0.0.1"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.pipe(log); server.stderr.pipe(log);
let ready = false;
for (let i = 0; i < 150; i++) {
  if (server.exitCode !== null) throw new Error(`Server exited ${server.exitCode}`);
  try { const r = await fetch(`${BASE}/setup`, { signal: AbortSignal.timeout(2000) }); if (r.ok) { ready = true; break; } } catch {}
  await new Promise(r => setTimeout(r, 200));
}
if (!ready) { server.kill(); throw new Error("Review server did not become HTTP-ready; inspect server.log"); }

const post = (url, body, cookie = "") => fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
async function ok(url, body, cookie) { const r = await post(url, body, cookie); const d = await r.json(); if (!r.ok) throw new Error(`${url}: ${JSON.stringify(d)}`); return d; }
const stageId = async key => (await prisma.visaStage.findUniqueOrThrow({ where: { key } })).id;

await ok("/api/setup", { agencyName: "Skyline Travels", city: "Pune", name: "Asha Verma", email: "review@visual.test", phone: "+919000000001", password }, "");
const login = await post("/api/auth/login", { email: "review@visual.test", password });
const owner = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
const meera = await ok("/api/customers", { name: "Meera Sharma", phone: "+919812345678", email: "meera@example.test", city: "Pune" }, owner);
const arjun = await ok("/api/customers", { name: "Arjun Mehta", phone: "+919823456789", city: "Mumbai" }, owner);
const ravi = await ok("/api/customers", { name: "Ravi Kulkarni", phone: "+919845001122", email: "ravi@example.test", city: "Nagpur" }, owner);
const meeraT = await prisma.traveller.findFirstOrThrow({ where: { customerId: meera.id } });
const arjunT = await prisma.traveller.findFirstOrThrow({ where: { customerId: arjun.id } });
const raviT = await prisma.traveller.findFirstOrThrow({ where: { customerId: ravi.id } });
const checklist = await ok("/api/checklists", { country: "Schengen (Germany)", visaType: "Tourist", applicantType: "STANDARD", items: [{ name: "Passport", required: true, fileTypes: "pdf,jpg", maxSizeMb: 5, needsVerification: true }, { name: "Bank statement", required: true, fileTypes: "pdf", maxSizeMb: 10, needsVerification: true }] }, owner);
const v1 = await ok("/api/visa/cases", { customerId: meera.id, travellerIds: [meeraT.id], destination: "Schengen (Germany)", visaType: "Tourist", checklistId: checklist.checklist.id, visaFee: 7500, serviceFee: 2500, travelDate: "2026-12-15" }, owner);
const ukChecklist = await ok("/api/checklists", { country: "United Kingdom", visaType: "Visitor", applicantType: "STANDARD", items: [{ name: "Passport", required: true, fileTypes: "pdf,jpg", maxSizeMb: 5, needsVerification: true }, { name: "Bank statement", required: true, fileTypes: "pdf", maxSizeMb: 10, needsVerification: true }] }, owner);
const v2 = await ok("/api/visa/cases", { customerId: arjun.id, travellerIds: [arjunT.id], destination: "United Kingdom", visaType: "Visitor", checklistId: ukChecklist.checklist.id, visaFee: 9000, serviceFee: 3000, travelDate: "2027-01-10" }, owner);
await ok("/api/visa/cases", { customerId: ravi.id, travellerIds: [raviT.id], destination: "Schengen (Germany)", visaType: "Tourist", checklistId: checklist.checklist.id, visaFee: 7500, serviceFee: 2500 }, owner);
await ok(`/api/visa/cases/${v1.caseId}/stage`, { stageId: await stageId("ASSESSMENT") }, owner);
await ok(`/api/visa/cases/${v2.caseId}/stage`, { stageId: await stageId("DOCUMENTS_PENDING") }, owner);
const booking = await ok("/api/bookings", { customerId: meera.id, travellerIds: [meeraT.id], pnr: "SKY7QX", sector: "BOM → FRA", airline: "Lufthansa", deadlineHours: 20, fare: 32000, taxes: 4500, markup: 2000, serviceFee: 1500 }, owner);
await ok("/api/bookings", { customerId: arjun.id, travellerIds: [arjunT.id], sector: "BOM → DXB", fare: 18500, taxes: 2800 }, owner);
const reviewUser = await prisma.user.findUniqueOrThrow({ where: { email: "review@visual.test" } });
const meeraRecord = await prisma.customer.findUniqueOrThrow({ where: { id: meera.id } });
const acceptedLead = await prisma.salesLead.create({ data: {
  customerId: meera.id, branchId: meeraRecord.branchId, ownerId: reviewUser.id,
  title: "Dubai family holiday", source: "Website", product: "FLIGHT", stage: "QUOTED",
  budgetMinor: 2800000, destination: "Mumbai → Dubai", travelDate: new Date("2027-02-15T00:00:00.000Z"),
  followUpAt: new Date(Date.now() + 48 * 60 * 60 * 1000), notes: "Family of three; morning departure preferred.",
} });
await prisma.salesQuote.create({ data: {
  leadId: acceptedLead.id, version: 1,
  items: JSON.stringify([{ description: "BOM–DXB return airfare · 2 adults, 1 child", quantity: 1, priceMinor: 2800000, costMinor: 2580000 }]),
  terms: "Fare is subject to supplier confirmation. Cancellation fees follow the airline rules shown at booking.",
  totalMinor: 2800000, costMinor: 2580000, expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  state: "ACCEPTED", acceptedName: "Meera Sharma", acceptedAt: new Date(), createdBy: reviewUser.id,
} });
const onlineBooking = await prisma.booking.create({ data: {
  bookingNo: "ON-2026-0001", customerId: meera.id, product: "HOTEL", hotelName: "The Leela Goa",
  hotelCheckIn: new Date("2026-12-20T00:00:00.000Z"), hotelCheckOut: new Date("2026-12-24T00:00:00.000Z"),
  status: "CONFIRMED", gdsSource: "TRIPJACK_API", sector: "Goa · 4 nights",
  fare: 46000, sellingPrice: 48900, supplierCost: 46000, ownerId: reviewUser.id, branchId: meeraRecord.branchId,
} });
await prisma.platformBookingLink.create({ data: {
  platformId: "tripjack-uat-booking-001", bookingId: onlineBooking.id, revision: 4,
  supplierReference: "TJ-DEMO-5201", platformStatus: "CONFIRMED", documentsCurrent: false,
} });
// The synthetic platform booking is inserted directly above, so include the
// journal position that the real signed receiver writes in the same transaction.
await prisma.financialEntry.create({ data: {
  partyType: "CUSTOMER", partyId: meera.id, sourceType: "Booking", sourceId: onlineBooking.id,
  revision: 1, amountMinor: BigInt(Math.round(onlineBooking.sellingPrice * 100)),
  reference: onlineBooking.bookingNo, description: "Synthetic online hotel charge",
  actorId: reviewUser.id,
} });
await ok("/api/payments", { customerId: meera.id, bookingId: booking.bookingId, amount: 20000, mode: "UPI", note: "Advance towards Europe trip" }, owner);
await ok("/api/invoices", { customerId: meera.id, amount: 2500, description: "Visa service charge", dueDate: "2026-11-01" }, owner);
await ok("/api/tasks", { title: "Call Meera about travel insurance", priority: "HIGH", customerId: meera.id, details: "She asked about Schengen insurance cover on WhatsApp." }, owner);
await ok("/api/tasks", { title: "Collect Arjun's bank statements", priority: "MEDIUM", customerId: arjun.id }, owner);
writeFileSync(path.join(ROOT, "tests", ".runtime", "visual-review-current.json"), JSON.stringify({ runtime, base: BASE, serverPid: server.pid, dev, customerId: meera.id, visaCaseId: v1.caseId, bookingId: booking.bookingId, salesLeadId: acceptedLead.id, onlineBookingId: onlineBooking.id }, null, 2));
console.log(`VISUAL REVIEW READY ${BASE} pid=${server.pid}`);
console.log(`Review login: review@visual.test / ${password}`);
server.on("exit", code => { console.log(`Server exited ${code}`); log.end(); process.exitCode = code ?? 1; });
