/** Adding a service (visa, quote) to an existing trip so its wizard can open. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { SessionUser } from "../src/lib/session";
await mkdir(join(process.cwd(), "tests/.runtime"), { recursive: true });
const dir = await mkdtemp(join(process.cwd(), "tests/.runtime/trip-services-")), url = `file:${join(dir, "fixture.db").replaceAll("\\", "/")}`;
await writeFile(join(dir, "fixture.db"), "");
await writeFile(join(dir, "schema.prisma"), await readFile(new URL("../prisma/schema.prisma", import.meta.url)));
await cp(new URL("../prisma/migrations", import.meta.url), join(dir, "migrations"), { recursive: true });
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", join(dir, "schema.prisma")], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
process.env.DATABASE_URL = url;
const { prisma: db } = await import("../src/lib/db");
const { addTripService } = await import("../src/lib/trip-services");
const person = (id: string, accessMode: string, permissions: string[]) => ({ id, name: id, email: `${id}@example.test`, role: "OWNER", roleName: "x", branchId: "branch-a", branchName: "a", employeeCode: id, accessMode, permissions }) as unknown as SessionUser;
const owner = person("owner", "ALL", ["customer:view", "customer:edit", "ticketing:view", "ticketing:create", "visa:view", "visa:create"]);
const ticketOnly = person("tk", "ALL", ["customer:view", "customer:edit", "ticketing:view", "ticketing:create"]);
const outsider = person("staff", "ASSIGNED", ["customer:view", "customer:edit", "visa:view", "visa:create"]);
try {
  await db.role.create({ data: { id: "role", key: "FIXTURE", name: "Fixture", desc: "Test only" } });
  await db.branch.create({ data: { id: "branch-a", code: "a", name: "a", city: "x" } });
  for (const id of ["owner", "tk", "staff"]) await db.user.create({ data: { id, employeeCode: id, name: id, email: `${id}@example.test`, phone: "", passwordHash: "x", roleId: "role", branchId: "branch-a" } });
  await db.customer.create({ data: { id: "cust", code: "C-1", name: "Customer", phone: "", city: "x", branchId: "branch-a" } });
  await db.serviceCase.create({ data: { id: "trip", caseNo: "MAX-1", customerId: "cust", branchId: "branch-a", ownerId: "owner", service: "FLIGHT", title: "Dubai holiday" } });
  await db.serviceWork.create({ data: { caseId: "trip", service: "FLIGHT", title: "flight" } });
  await db.serviceCase.create({ data: { id: "closed", caseNo: "MAX-2", customerId: "cust", branchId: "branch-a", ownerId: "owner", service: "FLIGHT", title: "Old", status: "COMPLETED", closedAt: new Date() } });

  assert.deepEqual(await addTripService(db, owner, "trip", "VISA"), { href: "/visa/new?case=trip" });
  assert.equal(await db.serviceWork.count({ where: { caseId: "trip", service: "VISA" } }), 1);
  // Repeating is harmless: still one visa service.
  await addTripService(db, owner, "trip", "VISA");
  assert.equal(await db.serviceWork.count({ where: { caseId: "trip", service: "VISA" } }), 1);
  assert.equal(await db.serviceCaseEvent.count({ where: { caseId: "trip", summary: { contains: "Visa added" } } }), 1);
  // Quote needs a flight or hotel service; the trip already has a flight, so nothing new is created.
  assert.deepEqual(await addTripService(db, owner, "trip", "QUOTE"), { href: "/sales?action=new&case=trip" });
  assert.equal(await db.serviceWork.count({ where: { caseId: "trip" } }), 2);
  await assert.rejects(addTripService(db, ticketOnly, "trip", "VISA"), (e: { status?: number }) => e.status === 403);
  await assert.rejects(addTripService(db, outsider, "trip", "VISA"), (e: { status?: number }) => e.status === 404);
  await assert.rejects(addTripService(db, owner, "closed", "VISA"), (e: { status?: number }) => e.status === 409);
  console.log("Trip services passed: visa and quote open from any trip, scoped and idempotent.");
} finally {
  await db.$disconnect();
  await rm(dir, { recursive: true, force: true });
}
