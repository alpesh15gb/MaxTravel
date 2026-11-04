/** Disposable SQLite fixture for the trip history timeline. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { SessionUser } from "../src/lib/session";
await mkdir(join(process.cwd(), "tests/.runtime"), { recursive: true });
const dir = await mkdtemp(join(process.cwd(), "tests/.runtime/trip-history-")), url = `file:${join(dir, "fixture.db").replaceAll("\\", "/")}`;
await writeFile(join(dir, "fixture.db"), "");
await writeFile(join(dir, "schema.prisma"), await readFile(new URL("../prisma/schema.prisma", import.meta.url)));
await cp(new URL("../prisma/migrations", import.meta.url), join(dir, "migrations"), { recursive: true });
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", join(dir, "schema.prisma")], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
process.env.DATABASE_URL = url;
const { prisma: db } = await import("../src/lib/db");
const { tripHistory } = await import("../src/lib/trip-history");
const person = (id: string, accessMode: string, permissions: string[]) => ({ id, name: id, email: `${id}@example.test`, role: "OWNER", roleName: "x", branchId: "branch-a", branchName: "a", employeeCode: id, accessMode, permissions }) as unknown as SessionUser;
const read = ["customer:view", "ticketing:view", "visa:view", "payment:view", "task:view"];
const owner = person("owner", "ALL", [...read, "audit:view"]);
const viewer = person("viewer", "ALL", read);
const staff = person("staff", "ASSIGNED", read);
const at = (m: number) => new Date(Date.UTC(2026, 10, 5, 6, m));
try {
  await db.role.create({ data: { id: "role", key: "FIXTURE", name: "Fixture", desc: "Test only" } });
  await db.branch.create({ data: { id: "branch-a", code: "a", name: "a", city: "Synthetic" } });
  for (const [id, name] of [["owner", "Owner Name"], ["staff", "Staff Name"]]) await db.user.create({ data: { id, employeeCode: id, name, email: `${id}@example.test`, phone: "", passwordHash: "x", roleId: "role", branchId: "branch-a" } });
  await db.customer.create({ data: { id: "cust", code: "C-1", name: "Customer", phone: "", city: "x", branchId: "branch-a" } });
  await db.serviceCase.create({ data: { id: "trip", caseNo: "MAX-1", customerId: "cust", branchId: "branch-a", ownerId: "owner", service: "FLIGHT", title: "Trip" } });
  await db.booking.create({ data: { id: "bk", bookingNo: "BK-1", customerId: "cust", ownerId: "owner", branchId: "branch-a", serviceCaseId: "trip", sellingPrice: 10000 } });
  await db.payment.create({ data: { id: "pay", receiptNo: "RCP-1", customerId: "cust", bookingId: "bk", amount: 5000 } });
  await db.booking.create({ data: { id: "other-bk", bookingNo: "BK-9", customerId: "cust", ownerId: "owner", branchId: "branch-a" } });
  await db.serviceCaseEvent.create({ data: { caseId: "trip", actorId: "owner", kind: "CREATED", summary: "Max ID created", at: at(1) } });
  await db.auditLog.create({ data: { userId: "owner", action: "UPDATE", entity: "Booking", entityId: "bk", detail: JSON.stringify({ fields: ["supplierCost"], from: 8000, to: 11000 }), at: at(2) } });
  await db.auditLog.create({ data: { userId: "staff", action: "CREATE", entity: "Payment", entityId: "pay", detail: "RCP-1", at: at(3) } });
  await db.auditLog.create({ data: { userId: "owner", action: "UPDATE", entity: "Booking", entityId: "other-bk", at: at(4) } });
  await db.auditLog.create({ data: { userId: "owner", action: "SIGN_URL", entity: "Booking", entityId: "bk", at: at(5) } });

  const h = await tripHistory(owner, "trip", 1);
  assert.equal(h.rows.length, 3); assert.equal(h.more, false);
  assert.deepEqual(h.rows.map(r => r.who), ["Staff Name", "Owner Name", "Owner Name"]);
  assert.match(h.rows[0].what, /Payment RCP-1/i);
  assert.match(h.rows[1].what, /Booking BK-1/); assert.match(h.rows[1].what, /supplier cost/i); assert.match(h.rows[1].what, /8000 → 11000/);
  assert.equal(h.rows[1].href, "/ticketing/bk");
  assert.equal(h.rows[2].what, "Max ID created");
  assert.deepEqual((await tripHistory(viewer, "trip", 1)).rows.map(r => r.what), ["Max ID created"]);
  await assert.rejects(tripHistory(staff, "trip", 1), (e: { status?: number }) => e.status === 404);
  console.log("Trip history passed: merged events and audit, newest first, scoped.");
} finally {
  await db.$disconnect();
  await rm(dir, { recursive: true, force: true });
}
