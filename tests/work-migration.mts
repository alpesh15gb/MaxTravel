import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  cp,
  writeFile,
  readFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

await mkdir("tests/.runtime", { recursive: true });
const dir = await mkdtemp(path.resolve("tests/.runtime/work-migration-"));
const url = `file:${path.join(dir, "fixture.db").replaceAll("\\", "/")}`;
const latest = "20261031100000_case_workflow";
await writeFile(path.join(dir, "fixture.db"), "");
await writeFile(
  path.join(dir, "schema.prisma"),
  await readFile("prisma/schema.prisma"),
);
await mkdir(path.join(dir, "migrations"));
for (const name of await readdir("prisma/migrations")) {
  if (name !== latest)
    await cp(
      path.join("prisma/migrations", name),
      path.join(dir, "migrations", name),
      { recursive: true },
    );
}
const env = { ...process.env, DATABASE_URL: url };
const migrate = () =>
  execFileSync(
    process.execPath,
    [
      "node_modules/prisma/build/index.js",
      "migrate",
      "deploy",
      "--schema",
      path.join(dir, "schema.prisma"),
    ],
    { env, stdio: "pipe" },
  );
migrate();
const drift = (schema: string) =>
  execFileSync(
    process.execPath,
    [
      "node_modules/prisma/build/index.js",
      "migrate",
      "diff",
      "--from-url",
      url,
      "--to-schema-datamodel",
      schema,
    ],
    { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
const db = new PrismaClient({ datasources: { db: { url } } });
try {
  await db.$executeRaw`INSERT INTO Role(id,key,name,desc) VALUES('role','OWNER','Owner','Fixture')`;
  await db.$executeRaw`INSERT INTO Branch(id,name,code,city) VALUES('branch','Fixture','FIX','Pune')`;
  await db.$executeRaw`INSERT INTO User(id,employeeCode,name,email,phone,passwordHash,roleId,branchId) VALUES('staff','EMP-FIX','Fixture','staff@work-migration.test','','not-a-login','role','branch')`;
  await db.$executeRaw`INSERT INTO Customer(id,code,name,phone,city,branchId,assignedToId) VALUES('client','C-FIX','Fixture','','Pune','branch','staff')`;
  for (const [id, service] of [
    ["case-flight", "FLIGHT"],
    ["case-empty", "VISA"],
  ]) {
    await db.$executeRawUnsafe(
      `INSERT INTO ServiceCase(id,caseNo,customerId,branchId,ownerId,service,title,updatedAt) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
      id,
      `CASE-${id}`,
      "client",
      "branch",
      "staff",
      service,
      `Fixture ${service}`,
    );
  }
  await db.$executeRaw`INSERT INTO Booking(id,bookingNo,customerId,ownerId,branchId,serviceCaseId,sellingPrice,updatedAt) VALUES('booking','BK-KEEP','client','staff','branch','case-flight',12345,CURRENT_TIMESTAMP)`;
  await db.$executeRaw`INSERT INTO Task(id,title,status,ownerId,customerId,bookingId,branchId,dueAt,completedAt) VALUES('old-done','Already finished','DONE','staff','client','booking','branch','2026-10-01T10:00:00.000Z','2026-10-01T09:00:00.000Z')`;
  await db.$executeRaw`INSERT INTO Task(id,title,status,ownerId,customerId,branchId) VALUES('old-unfiled','Call customer','OPEN','staff','client','branch')`;
  await db.$disconnect();
  await cp(
    path.join("prisma/migrations", latest),
    path.join(dir, "migrations", latest),
    { recursive: true },
  );
  migrate();
  const done = await db.task.findUniqueOrThrow({
    where: { id: "old-done" },
    include: { events: true },
  });
  assert.equal(done.serviceCaseId, "case-flight");
  assert.equal(done.workState, "DONE");
  assert.equal(done.workflowTracked, false);
  assert.equal(done.originalDueAt?.toISOString(), done.dueAt?.toISOString());
  assert.equal(done.events.length, 1);
  assert.equal(done.events[0].kind, "BASELINE");
  assert.equal(
    await db.workEvent.count({
      where: { kind: { in: ["COMPLETE", "APPROVE"] } },
    }),
    0,
    "Do not fabricate historical completion/review events",
  );
  assert.equal(
    (await db.task.findUniqueOrThrow({ where: { id: "old-unfiled" } }))
      .serviceCaseId,
    null,
    "Ambiguous customer follow-ups stay in reconciliation",
  );
  assert.equal(
    await db.task.count({
      where: { serviceCaseId: "case-empty", unassigned: true },
    }),
    1,
  );
  assert.equal(await db.serviceWork.count(), 2);
  assert.equal(
    (await db.booking.findUniqueOrThrow({ where: { id: "booking" } }))
      .sellingPrice,
    12345,
  );
  assert.equal(await db.serviceCase.count(), 2);
  assert.deepEqual(await db.$queryRawUnsafe("PRAGMA foreign_key_check"), []);
  const count = await db.task.count();
  migrate();
  assert.equal(
    await db.task.count(),
    count,
    "Repeat deployment must not duplicate planning tasks",
  );
  assert.doesNotMatch(
    drift("prisma/schema.prisma"),
    /ServiceWork|WorkEvent|WorkMutation|CaseMessage|`Task`/,
    "Workflow models must match their migrations",
  );
  console.log(
    "PASS workflow migration: existing identities/money, honest historical baseline, unfiled reconciliation, planning work, repeat deployment, foreign keys and workflow schema parity.",
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Migration rehearsal failed",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
