/** Disposable SQLite fixture for the trip read model. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { SessionUser } from "../src/lib/session";
await mkdir(join(process.cwd(), "tests/.runtime"), { recursive: true });
const dir = await mkdtemp(join(process.cwd(), "tests/.runtime/trips-read-")), url = `file:${join(dir, "fixture.db").replaceAll("\\", "/")}`;
await writeFile(join(dir, "fixture.db"), "");
await writeFile(join(dir, "schema.prisma"), await readFile(new URL("../prisma/schema.prisma", import.meta.url)));
await cp(new URL("../prisma/migrations", import.meta.url), join(dir, "migrations"), { recursive: true });
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", join(dir, "schema.prisma")], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
process.env.DATABASE_URL = url;
const { prisma: db } = await import("../src/lib/db");
const { readTrips, readTrip } = await import("../src/lib/trips-read");
const person = (id: string, accessMode: string, permissions: string[]) => ({ id, name: id, email: `${id}@example.test`, role: "OWNER", roleName: "x", branchId: "branch-a", branchName: "a", employeeCode: id, accessMode, permissions }) as unknown as SessionUser;
const owner = person("owner", "ALL", ["customer:view", "ticketing:view", "visa:view", "payment:view", "task:view"]);
const staff = person("staff", "ASSIGNED", ["customer:view", "ticketing:view", "visa:view", "task:view"]);
try {
  await db.role.create({ data: { id: "role", key: "FIXTURE", name: "Fixture", desc: "Test only" } });
  await db.branch.create({ data: { id: "branch-a", code: "a", name: "a", city: "Synthetic" } });
  for (const id of ["owner", "staff"]) await db.user.create({ data: { id, employeeCode: id, name: id === "owner" ? "Owner" : "Staff", email: `${id}@example.test`, phone: "", passwordHash: "not-a-login", roleId: "role", branchId: "branch-a" } });
  for (const x of ["a", "b", "c"]) await db.customer.create({ data: { id: `cust-${x}`, code: `C-${x}`, name: `Customer ${x}`, phone: "", city: "Synthetic", branchId: "branch-a", assignedToId: "owner" } });
  const trip = (x: string, ownerId: string) => db.serviceCase.create({ data: { id: `trip-${x}`, caseNo: `MAX-${x}`, customerId: `cust-${x}`, branchId: "branch-a", ownerId, service: "FLIGHT", title: `Trip ${x}` } });
  await trip("a", "staff"); await trip("b", "owner"); await trip("c", "owner");
  const travel = new Date(Date.now() + 20 * 86400000);
  await db.booking.create({ data: { id: "bk-a", bookingNo: "BK-a", customerId: "cust-a", ownerId: "staff", branchId: "branch-a", status: "TICKETED", travelDate: travel, sellingPrice: 1000, serviceCaseId: "trip-a" } });
  await db.salesLead.create({ data: { id: "lead-b", customerId: "cust-b", branchId: "branch-a", ownerId: "owner", title: "Goa enquiry", source: "Fixture", serviceCaseId: "trip-b" } });
  await db.booking.create({ data: { id: "bk-c", bookingNo: "BK-c", customerId: "cust-c", ownerId: "owner", branchId: "branch-a", status: "CANCELLED", travelDate: travel, serviceCaseId: "trip-c" } });

  const all = await readTrips(owner, {});
  assert.equal(all.rows.length, 3); assert.equal(all.total, 3);
  assert.equal(all.counts.BOOKED, 1); assert.equal(all.counts.ENQUIRY, 1); assert.equal(all.counts.CANCELLED, 1);
  const a = all.rows.find(r => r.id === "trip-a")!;
  assert.equal(a.stage, "BOOKED"); assert.equal(a.customer.name, "Customer a"); assert.equal(a.owner, "Staff");
  assert.equal(a.services[0].kind, "FLIGHT"); assert.equal(a.services[0].href, "/ticketing/bk-a"); assert.equal(a.online, false);
  assert.equal(typeof a.balanceMinor, "number");
  assert.equal(all.rows.find(r => r.id === "trip-c")!.services[0].dead, true);
  assert.equal((await readTrips(owner, { stage: "ACTIVE" })).rows.length, 2);
  assert.equal((await readTrips(owner, { stage: "CANCELLED" })).rows[0].id, "trip-c");
  assert.equal((await readTrips(owner, { search: "Customer b" })).rows[0]?.id, "trip-b");
  assert.equal((await readTrips(owner, { customerId: "cust-a" })).rows.length, 1);
  const mine = await readTrips(staff, {});
  assert.deepEqual(mine.rows.map(r => r.id), ["trip-a"]);
  assert.equal(mine.rows[0].balanceMinor, null);
  await assert.rejects(readTrip(staff, "trip-b"), (e: { status?: number }) => e.status === 404);
  const detail = await readTrip(owner, "trip-b");
  assert.equal(detail.stage, "ENQUIRY"); assert.equal(detail.quotes[0].leadId, "lead-b"); assert.equal(detail.quotes[0].latestQuote, null);
  assert.equal(detail.services[0].kind, "ENQUIRY");
  const detailA = await readTrip(owner, "MAX-a");
  assert.equal(detailA.id, "trip-a"); assert.equal(detailA.money?.invoicedMinor, 100000);
  assert.equal((await readTrip(staff, "trip-a")).money, null);
  console.log("Trip read model passed: scoped list, stage counts, filters, detail, money gating.");
} finally {
  await db.$disconnect();
  await rm(dir, { recursive: true, force: true });
}
