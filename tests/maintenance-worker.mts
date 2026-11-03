import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Real route and migrated disposable database. No provider network or SMTP calls.
const parent = await realpath(tmpdir());
const directory = await mkdtemp(path.join(parent, "crm-maintenance-worker-"));
const priorEnv = { ...process.env };
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("Provider calls forbidden in maintenance fixture"); };
for (const key of Object.keys(process.env)) {
  if (/^(SMTP_|MAIL_FROM$|RAZORPAY_|PAYGLOCAL_|CRM_WORKER_SECRET$|CRM_DATA_ENCRYPTION_KEY$)/.test(key)) delete process.env[key];
}
process.env.DATABASE_URL = "file:" + path.join(directory, "test.db").replaceAll("\\", "/");
process.env.APP_ORIGIN = "http://127.0.0.1:3999";
process.env.JWT_SECRET = randomBytes(32).toString("hex");
await writeFile(path.join(directory, "test.db"), "");
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: process.env, stdio: "pipe" });
const { prisma } = await import("../src/lib/db");
const { POST } = await import("../src/app/api/jobs/maintenance/route");
const secret = randomBytes(32).toString("hex");
const request = (token?: string) => new Request("http://127.0.0.1:3999/api/jobs/maintenance", {
  method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {},
});
const lease = "maintenance.worker.lease";
const originalSettings = await prisma.settings.findMany({ orderBy: { key: "asc" } });
try {
  assert.equal((await POST(request())).status, 403, "Unconfigured worker remains unavailable");
  process.env.CRM_WORKER_SECRET = "short";
  assert.equal((await POST(request("short"))).status, 403, "Weak worker secret fails closed");
  process.env.CRM_WORKER_SECRET = secret;
  assert.equal((await POST(request())).status, 403);
  assert.equal((await POST(request("wrong"))).status, 403);
  assert.equal((await POST(request(randomBytes(32).toString("hex")))).status, 403);
  assert.deepEqual(await prisma.settings.findMany({ orderBy: { key: "asc" } }), originalSettings, "Rejected worker calls cannot acquire leases or run jobs");

  const branch = await prisma.branch.create({ data: { code: "WORKER", name: "Synthetic branch", city: "Test" } });
  const role = await prisma.role.create({ data: { key: "OWNER", name: "Owner", desc: "Synthetic" } });
  const owner = await prisma.user.create({ data: { employeeCode: "EMP-WORKER", name: "Synthetic owner", email: "worker@example.test", phone: "", passwordHash: "synthetic-not-a-login", roleId: role.id, branchId: branch.id } });
  const customer = await prisma.customer.create({ data: { code: "C-WORKER", name: "Synthetic client", phone: "", city: "Test", branchId: branch.id, assignedToId: owner.id } });
  const task = await prisma.task.create({ data: { title: "Synthetic overdue hard deadline", ownerId: owner.id, creatorId: owner.id, branchId: branch.id, dueAt: new Date(Date.now() - 3600000), hardDeadline: true } });
  const serviceCase = await prisma.serviceCase.create({ data: { caseNo: "MX-WORKER", customerId: customer.id, ownerId: owner.id, branchId: branch.id, service: "TRAIN", title: "Synthetic finished journey" } });
  await prisma.booking.create({ data: { bookingNo: "BK-WORKER", customerId: customer.id, serviceCaseId: serviceCase.id, ownerId: owner.id, branchId: branch.id, product: "TRAIN", status: "CONFIRMED", sellingPrice: 0, supplierCost: 0, supplierCostConfirmed: true, travelDate: new Date("2000-01-01"), travelEndDate: new Date("2000-01-02") } });

  const activeToken = `${Date.now()}:other-worker`;
  await prisma.settings.create({ data: { key: lease, value: activeToken } });
  const busy = await POST(request(secret));
  assert.equal(busy.status, 200);
  assert.deepEqual(await busy.json(), { ok: true, busy: true });
  assert.equal((await prisma.settings.findUniqueOrThrow({ where: { key: lease } })).value, activeToken);
  assert.equal(await prisma.notification.count(), 0, "Busy worker does not dispatch reminders");
  assert.equal((await prisma.serviceCase.findUniqueOrThrow({ where: { id: serviceCase.id } })).status, "OPEN");

  await prisma.settings.update({ where: { key: lease }, data: { value: `${Date.now() - 360000}:expired-worker` } });
  const result = await POST(request(secret));
  const body = await result.json();
  assert.equal(result.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.reminders, 1);
  assert.equal(body.casesClosed, 1);
  assert.equal(body.emailConfigured, false, "Unconfigured SMTP stays idle");
  assert.equal(body.emailProcessed, 0);
  assert.equal(body.collectionsProcessed, 0);
  assert.equal(body.collectionsRefreshed, 0);
  assert.equal(await prisma.settings.findUnique({ where: { key: lease } }), null, "Completed worker releases its lease");
  assert.equal(await prisma.notification.count({ where: { userId: owner.id } }), 1);
  assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status, "OPEN", "Reminder does not mark actual staff work done");
  assert.equal((await prisma.serviceCase.findUniqueOrThrow({ where: { id: serviceCase.id } })).status, "COMPLETED");
  assert.equal(await prisma.serviceCaseEvent.count({ where: { caseId: serviceCase.id, kind: "AUTO_CLOSED" } }), 1);

  const repeat = await POST(request(secret));
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).casesClosed, 0);
  assert.equal(await prisma.notification.count({ where: { userId: owner.id } }), 1, "Repeated tick cannot duplicate the same daily reminder");
  assert.equal(networkCalls, 0, "No payment or provider call was initiated");
  console.log("PASS maintenance worker: missing/weak/bad auth, active lease, expired lease takeover, real task reminder, reconciled Max ID closure, inactive email/payment jobs, lease release and repeat deduplication.");
} finally {
  await prisma.$disconnect();
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in priorEnv)) delete process.env[key];
  Object.assign(process.env, priorEnv);
  const owned = await realpath(directory);
  assert.equal(path.dirname(owned), parent);
  assert(path.basename(owned).startsWith("crm-maintenance-worker-"));
  await rm(owned, { recursive: true, force: true });
}
