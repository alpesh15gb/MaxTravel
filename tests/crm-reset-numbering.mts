import assert from "node:assert/strict";
import { mkdtemp, realpath, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { nextReference } from "../src/lib/transactions";
import { createServiceCase } from "../src/lib/service-cases";
import { seal, unseal } from "../src/lib/staff-security";
const parent = await realpath(tmpdir());
const directory = await mkdtemp(path.join(parent, "crm-number-reset-"));
const database = path.join(directory, "fixture.db");
const url = `file:${database.replaceAll("\\", "/")}`;
const db = new PrismaClient({ datasources: { db: { url } } });
const previousKey = process.env.CRM_DATA_ENCRYPTION_KEY;
process.env.CRM_DATA_ENCRYPTION_KEY = randomBytes(32).toString("hex");
try {
  await writeFile(database, "");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  const year = new Date().getFullYear();
  const branch = await db.branch.create({ data: { code: "RESET", name: "Synthetic head office", city: "Test" } });
  const role = await db.role.create({ data: { key: "OWNER", name: "Owner", desc: "Synthetic" } });
  const cipher = "enc:" + seal("synthetic-bank-value", "crm-field:bankAccount");
  const owner = await db.user.create({ data: { name: "Synthetic owner", email: "owner@fresh-slate.test", employeeCode: `EMP-${year}-0007`, phone: "", passwordHash: "synthetic-unchanged-hash", bankAccount: cipher, roleId: role.id, branchId: branch.id } });
  const config = JSON.stringify({ referencePrefix: "MX", defaultOwnerId: owner.id, followUpDays: 2, requireResolvedWorkToClose: true });
  await db.settings.create({ data: { key: "case.configuration", value: config } });
  for (const prefix of ["CASE", "C", "VC", "BK", "INV", "CN", "RCP", "RF", "DOC"]) await db.settings.upsert({ where: { key: "counter." + prefix }, create: { key: "counter." + prefix, value: "41" }, update: { value: "41" } });
  await db.settings.create({ data: { key: "counter.case", value: "90" } });
  await db.settings.create({ data: { key: "counter.EMP", value: "7" } });
  await db.settings.create({ data: { key: "counter.FUTURE", value: "99" } });
  await db.settings.create({ data: { key: "smtp.configuration", value: "synthetic-private-config" } });
  const oldCustomer = await db.customer.create({ data: { code: `C-${year}-0041`, name: "Old synthetic client", phone: "+919000000001", city: "Test", assignedToId: owner.id, branchId: branch.id } });
  const oldCase = await db.$transaction(tx => createServiceCase(tx, { customerId: oldCustomer.id, branchId: branch.id, ownerId: owner.id, service: "VISA", title: "Old synthetic case" }, owner.id));
  assert.equal(oldCase.caseNo, `MX-${year}-0042`);
  await db.auditLog.create({ data: { userId: owner.id, action: "SYNTHETIC", entity: "Fixture" } });
  await db.$disconnect();
  const python = `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('reset',sys.argv[1])
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
r=m.clean_candidate(sys.argv[2],sys.argv[3],clear_audit=True,reset_numbering=True)
print(json.dumps({'businessNumberingReset':r['businessNumberingReset']}))`;
  const reset = path.resolve("scripts/vps-reset-crm.py");
  const result = JSON.parse(execFileSync(process.platform === "win32" ? "python" : "python3", ["-B", "-c", python, reset, database, owner.email], { stdio: "pipe" }).toString());
  assert.equal(result.businessNumberingReset, true);
  await db.$connect();
  assert.equal(await db.customer.count(), 0);
  assert.equal(await db.serviceCase.count(), 0);
  assert.equal(await db.auditLog.count(), 1);
  const retained = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
  assert.equal(retained.employeeCode, owner.employeeCode);
  assert.equal(retained.passwordHash, owner.passwordHash);
  assert.equal(retained.bankAccount, cipher);
  assert.equal(unseal(retained.bankAccount!.slice(4), "crm-field:bankAccount"), "synthetic-bank-value");
  assert.equal((await db.settings.findUniqueOrThrow({ where: { key: "case.configuration" } })).value, config);
  assert.equal((await db.settings.findUniqueOrThrow({ where: { key: "counter.FUTURE" } })).value, "99");
  const firstCustomer = await db.$transaction(async tx => tx.customer.create({ data: { code: await nextReference(tx,"C"), name: "Fresh synthetic client", phone: "+919000000002", city: "Test", assignedToId: owner.id, branchId: branch.id } }));
  assert.equal(firstCustomer.code, `C-${year}-0001`);
  const firstCase = await db.$transaction(tx => createServiceCase(tx, { customerId: firstCustomer.id, branchId: branch.id, ownerId: owner.id, service: "VISA", title: "Fresh case" }, owner.id));
  assert.equal(firstCase.caseNo, `MX-${year}-0001`);
  for (const prefix of ["VC", "BK", "INV", "CN", "RCP", "RF", "DOC"]) {
    assert.equal(await db.$transaction(tx => nextReference(tx,prefix)), `${prefix}-${year}-0001`);
    assert.equal(await db.$transaction(tx => nextReference(tx,prefix)), `${prefix}-${year}-0002`);
  }
  assert.equal(await db.$transaction(tx => nextReference(tx,"EMP")), `EMP-${year}-0008`);
  console.log("PASS actual CRM reset numbering: all nine business references restart at 0001; custom case prefix, staff numbering/login, encrypted fields, settings and unknown counters are preserved.");
} finally {
  await db.$disconnect();
  if (previousKey === undefined) delete process.env.CRM_DATA_ENCRYPTION_KEY; else process.env.CRM_DATA_ENCRYPTION_KEY = previousKey;
  const owned = await realpath(directory);
  assert.equal(path.dirname(owned), parent);
  assert(path.basename(owned).startsWith("crm-number-reset-"));
  await rm(owned, { recursive: true, force: true });
}
