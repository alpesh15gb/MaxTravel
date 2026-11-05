/** Disposable SQLite fixture: Today's "Payments to collect" shows what is really owed. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { SessionUser } from "../src/lib/session";
await mkdir(join(process.cwd(), "tests/.runtime"), { recursive: true });
const dir = await mkdtemp(join(process.cwd(), "tests/.runtime/pulse-overdue-")), url = `file:${join(dir, "fixture.db").replaceAll("\\", "/")}`;
await writeFile(join(dir, "fixture.db"), "");
await writeFile(join(dir, "schema.prisma"), await readFile(new URL("../prisma/schema.prisma", import.meta.url)));
await cp(new URL("../prisma/migrations", import.meta.url), join(dir, "migrations"), { recursive: true });
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", join(dir, "schema.prisma")], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
process.env.DATABASE_URL = url;
const { prisma: db } = await import("../src/lib/db");
const { computePulse } = await import("../src/lib/pulse");
const owner = { id: "owner", name: "Owner", email: "o@example.test", role: "OWNER", roleName: "x", branchId: "b", branchName: "b", employeeCode: "o", accessMode: "ALL", permissions: ["dashboard:view", "ticketing:view", "visa:view", "payment:view", "invoice:view", "customer:view", "task:view", "payment:record"] } as unknown as SessionUser;
const past = new Date(Date.now() - 2 * 86400000), future = new Date(Date.now() + 30 * 86400000);
try {
  await db.role.create({ data: { id: "role", key: "FIXTURE", name: "Fixture", desc: "Test only" } });
  await db.branch.create({ data: { id: "b", code: "b", name: "b", city: "x" } });
  await db.user.create({ data: { id: "owner", employeeCode: "o", name: "Owner", email: "o@example.test", phone: "", passwordHash: "x", roleId: "role", branchId: "b" } });
  await db.customer.create({ data: { id: "c", code: "C-1", name: "Customer", phone: "", city: "x", branchId: "b" } });
  const booking = (id: string, data: object) => db.booking.create({ data: { id, bookingNo: id, customerId: "c", ownerId: "owner", branchId: "b", status: "TICKETED", sellingPrice: 60000, ...data } });
  await booking("BK-INV", { travelDate: future });
  await db.payment.create({ data: { receiptNo: "R1", customerId: "c", bookingId: "BK-INV", amount: 20000 } });
  await db.invoice.create({ data: { id: "linked", invoiceNo: "INV-LINKED", customerId: "c", bookingId: "BK-INV", amount: 60000, dueDate: past } });
  await booking("BK-DUE", { sellingPrice: 10000, status: "CONFIRMED", product: "HOTEL", paymentDueDate: past });
  await booking("BK-PAID", { sellingPrice: 500, paymentDueDate: past });
  await db.payment.create({ data: { receiptNo: "R2", customerId: "c", bookingId: "BK-PAID", amount: 500 } });
  await booking("BK-ENQ", { status: "ENQUIRY", sellingPrice: 700, paymentDueDate: past });
  await booking("BK-LATER", { sellingPrice: 800, paymentDueDate: future });
  // A due date on the booking and an overdue linked invoice are one debt, listed once.
  await booking("BK-BOTH", { sellingPrice: 900, paymentDueDate: past });
  await db.invoice.create({ data: { id: "both", invoiceNo: "INV-BOTH", customerId: "c", bookingId: "BK-BOTH", amount: 900, dueDate: past } });
  const stage = await db.visaStage.create({ data: { id: "s", key: "SUBMITTED", name: "Submitted" } });
  await db.visaCase.create({ data: { id: "v", caseNo: "VC-DUE", customerId: "c", ownerId: "owner", branchId: "b", stageId: stage.id, visaType: "Tourist", destination: "UAE", sellingPrice: 8000, amountReceived: 3000, paymentDueDate: past } });

  const items = (await computePulse(db, owner)).items.filter(i => i.kind === "PAYMENT_OVERDUE");
  const titles = items.map(i => i.title);
  const has = (ref: string) => titles.find(t => t.includes(ref));
  assert.match(has("INV-LINKED") ?? "", /40,000/, "linked invoice shows what is owed after receipts");
  assert.match(has("BK-DUE") ?? "", /10,000/, "booking past its payment due date is listed");
  assert.match(has("VC-DUE") ?? "", /5,000/, "visa past its payment due date is listed");
  assert.equal(has("BK-PAID"), undefined, "paid booking is not listed");
  assert.equal(has("BK-ENQ"), undefined, "enquiry is not money to collect");
  assert.equal(has("BK-LATER"), undefined, "not yet due");
  assert.equal(titles.filter(t => t.includes("BOTH")).length, 1, "one debt is listed once");
  console.log("Today payments to collect passed.");
} finally {
  await db.$disconnect();
  await rm(dir, { recursive: true, force: true });
}
