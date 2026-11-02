import assert from "node:assert/strict";
import { mkdtemp, rm, realpath, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { initializeReferenceData } from "../src/lib/bootstrap";
import { ROLE_ACCESS, ROLE_PERMISSIONS, type RoleKey } from "../src/lib/permissions";
import { assignmentUnavailable } from "../src/lib/work-assignment";
import { createServiceCase, caseFor } from "../src/lib/service-cases";
import { createWork, createWorkSchema, eligiblePerson, taskFor } from "../src/lib/work-engine";
import { seal } from "../src/lib/staff-security";
import type { SessionUser } from "../src/lib/session";
const tempRoot = await realpath(tmpdir());
const dir = await mkdtemp(path.join(tempRoot, "crm-combined-staff-"));
const url = `file:${path.join(dir, "test.db").replaceAll("\\", "/")}`;
const db = new PrismaClient({ datasources: { db: { url } } });
try {
  await writeFile(path.join(dir, "test.db"), "");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  const migratedRole = await db.role.findUniqueOrThrow({ where: { key: "TRAVEL_EXECUTIVE" } });
  assert.equal(migratedRole.name, "Visa & Ticketing Executive");
  await db.$transaction(initializeReferenceData);
  assert.equal(await db.role.count({ where: { key: "TRAVEL_EXECUTIVE" } }), 1);
  assert.equal(ROLE_ACCESS.TRAVEL_EXECUTIVE, "ASSIGNED");
  assert.deepEqual(new Set(ROLE_PERMISSIONS.TRAVEL_EXECUTIVE), new Set([...ROLE_PERMISSIONS.VISA_EXECUTIVE, ...ROLE_PERMISSIONS.TICKETING_EXECUTIVE]));
  for (const permission of ["work:assign", "work:review", "case:assign", "payment:view", "invoice:view", "refund:manage", "employee:manage", "settings:manage", "hr:view", "audit:view", "export:data"]) assert(!ROLE_PERMISSIONS.TRAVEL_EXECUTIVE.some(p => p === permission));
  const branch = await db.branch.create({ data: { code: "COMBO", name: "Head office", city: "Test" } });
  const other = await db.branch.create({ data: { code: "OTHER", name: "Other", city: "Test" } });
  async function person(id: string, role: RoleKey, branchId: string | null = branch.id, active = true): Promise<SessionUser> {
    const r = await db.role.findUniqueOrThrow({ where: { key: role } });
    await db.user.create({ data: { id, employeeCode: id, email: `${id}@example.test`, name: id, phone: "", passwordHash: "synthetic-unused-password", roleId: r.id, branchId, active } });
    return { id, email: `${id}@example.test`, name: id, employeeCode: id, role, roleName: r.name, branchId, branchName: null, permissions: ROLE_PERMISSIONS[role], accessMode: ROLE_ACCESS[role] };
  }
  const owner = await person("owner", "OWNER"), staff = await person("combined", "TRAVEL_EXECUTIVE"), outsider = await person("outside", "TRAVEL_EXECUTIVE", other.id), noBranch = await person("unbranched", "TRAVEL_EXECUTIVE", null), inactive = await person("inactive", "TRAVEL_EXECUTIVE", branch.id, false), visa = await person("visa-only", "VISA_EXECUTIVE"), ticket = await person("ticket-only", "TICKETING_EXECUTIVE");
  const customer = await db.customer.create({ data: { code: "COMBO-C", name: "Synthetic customer", phone: "+919000000001", city: "Test", branchId: branch.id, assignedToId: owner.id } });
  for (const service of ["VISA", "FLIGHT", "HOTEL"]) {
    await eligiblePerson(db, owner, staff.id, branch.id, service);
    for (const id of [outsider.id, noBranch.id, inactive.id]) await assert.rejects(() => eligiblePerson(db, owner, id, branch.id, service), /active, permitted colleague/);
    await assert.rejects(() => eligiblePerson(db, owner, staff.id, branch.id, service, true), /active, permitted colleague/);
    await assert.rejects(() => eligiblePerson(db, owner, staff.id, branch.id, service, false, "PAYMENT"), /active, permitted colleague/);
    const journey = await db.$transaction(tx => createServiceCase(tx, { customerId: customer.id, branchId: branch.id, ownerId: owner.id, service, title: `Combined ${service}` }, owner.id));
    const work = await db.serviceWork.findUniqueOrThrow({ where: { caseId_service: { caseId: journey.id, service } } });
    const input = createWorkSchema.parse({ requestKey: randomUUID(), caseId: journey.id, serviceWorkId: work.id, title: `Prepare ${service}`, ownerId: staff.id, dueAt: new Date(Date.now() + 86400000).toISOString(), requiresReview: true, reviewerId: owner.id });
    const task = await db.$transaction(tx => createWork(tx, owner, input));
    assert.equal((await taskFor(db, staff, task.taskId)).ownerId, staff.id);
    assert.equal((await caseFor(db, staff, journey.id)).id, journey.id);
    await assert.rejects(() => taskFor(db, outsider, task.taskId), /outside/);
    await assert.rejects(() => caseFor(db, outsider, journey.id), /outside/);
    await assert.rejects(() => db.$transaction(tx => createWork(tx, staff, { ...input, requestKey: randomUUID(), ownerId: owner.id })), /delegate/);
  }
  await assert.rejects(() => eligiblePerson(db, owner, ticket.id, branch.id, "VISA"), /active, permitted colleague/);
  for (const service of ["FLIGHT", "HOTEL"]) await assert.rejects(() => eligiblePerson(db, owner, visa.id, branch.id, service), /active, permitted colleague/);
  const candidate = { canWork: true, canReview: false, services: ["VISA", "FLIGHT", "HOTEL"], branchId: branch.id as string | null, allBranches: false };
  assert.equal(assignmentUnavailable(candidate, "VISA", branch.id), null);
  assert.match(assignmentUnavailable({ ...candidate, services: ["FLIGHT"] }, "VISA", branch.id)!, /Visa access/);
  assert.match(assignmentUnavailable({ ...candidate, branchId: null }, "VISA", branch.id)!, /Set a branch/);
  assert.match(assignmentUnavailable(candidate, "VISA", other.id)!, /Different branch/);
  assert.match(assignmentUnavailable(candidate, "VISA", branch.id, true)!, /Review permission/);
  assert.equal(assignmentUnavailable({ ...candidate, allBranches: true }, "VISA", other.id), null);
  const operator = await readFile(new URL("../scripts/vps-enable-encryption.py", import.meta.url), "utf8");
  const probe = operator.match(/PROBE = r"""([\s\S]*?)"""/)?.[1];
  assert(probe, "Operator key verification program exists");
  const syntheticKey = randomBytes(32).toString("hex");
  const inspect = (key = "", verify = false) => JSON.parse(execFileSync(process.execPath, ["-e", probe!, ...(verify ? ["--", "verify"] : [])], { env: { ...process.env, DATABASE_URL: url, CRM_DATA_ENCRYPTION_KEY: key }, stdio: "pipe" }).toString());
  assert.equal(inspect().keyConfigured, false);
  assert.equal(inspect(syntheticKey, true).keyVerified, true);
  const previousKey = process.env.CRM_DATA_ENCRYPTION_KEY;
  process.env.CRM_DATA_ENCRYPTION_KEY = syntheticKey;
  try {
    await db.user.update({ where: { id: staff.id }, data: { bankAccount: "enc:" + seal("synthetic-private-bank", "crm-field:bankAccount") } });
    await db.staffMfa.create({ data: { userId: staff.id, secret: seal("synthetic-totp", "staff-mfa:" + staff.id) } });
    const id = "synthetic-import-key-probe";
    await db.dataImportBatch.create({ data: { id, actorId: owner.id, branchId: branch.id, requestKey: randomUUID(), source: "Synthetic", status: "STAGED", inputHash: "a".repeat(64), planHash: "b".repeat(64), payload: seal("{}", "import-payload:" + id), preview: seal("{}", "import-preview:" + id), expiresAt: new Date(Date.now() + 3600000) } });
    assert.equal(inspect().encryptedRecords, 4);
    assert.equal(inspect(syntheticKey, true).encryptedRecords, 4);
    assert.throws(() => inspect("", true));
    assert.throws(() => inspect(randomBytes(32).toString("hex"), true));
    await db.user.update({ where: { id: staff.id }, data: { bankAccount: "enc:" + seal("synthetic-private-bank", "wrong-context") } });
    assert.throws(() => inspect(syntheticKey, true));
  } finally { if (previousKey === undefined) delete process.env.CRM_DATA_ENCRYPTION_KEY; else process.env.CRM_DATA_ENCRYPTION_KEY = previousKey; }
  console.log("PASS actual operator probe: missing/correct/wrong keys, context binding, existing encrypted bank/MFA/import payloads and private aggregate-only diagnostics.");
  console.log("PASS combined staff: existing-database role migration, fresh setup, visa/flight/hotel assignment, assigned-case access, branch/inactive/review/finance/delegation isolation and eligibility explanations.");
} finally {
  await db.$disconnect();
  const owned = await realpath(dir);
  assert.equal(path.dirname(owned), tempRoot);
  assert(path.basename(owned).startsWith("crm-combined-staff-"));
  await rm(owned, { recursive: true, force: true });
}
