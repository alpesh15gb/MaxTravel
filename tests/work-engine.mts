import assert from "node:assert/strict";
import { mkdtemp, writeFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createServiceCase, caseFor } from "../src/lib/service-cases";
import {
  createWork,
  createWorkSchema,
  changeWork,
  workMutation,
  applyWorkTemplate,
  legacyTaskStatus,
  taskFor,
} from "../src/lib/work-engine";
import {
  ROLE_PERMISSIONS,
  ROLE_ACCESS,
  type RoleKey,
} from "../src/lib/permissions";
import { DEFAULT_WORK_CONFIG } from "../src/lib/work-config";
import type { SessionUser } from "../src/lib/session";
const root = await realpath(os.tmpdir()),
  dir = await mkdtemp(path.join(root, "crm-work-test-")),
  url = `file:${path.join(dir, "fixture.db").replaceAll("\\", "/")}`;
await writeFile(path.join(dir, "fixture.db"), "");
execFileSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  {
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: "pipe",
  },
);
const db = new PrismaClient({
  datasources: { db: { url } },
  transactionOptions: { timeout: 20000 },
});
let checks = 0;
const pass = () => checks++;
try {
  const branch = await db.branch.create({
      data: { name: "Work fixture", city: "Pune", code: "WF" },
    }),
    other = await db.branch.create({
      data: { name: "Other branch", city: "Delhi", code: "WF2" },
    });
  async function person(id: string, role: RoleKey, branchId = branch.id) {
    const r = await db.role.upsert({
      where: { key: role },
      create: { key: role, name: role, desc: "Fixture" },
      update: {},
    });
    await db.user.create({
      data: {
        id,
        name: id,
        email: `${id}@work.test`,
        employeeCode: id,
        phone: "",
        passwordHash: randomBytes(32).toString("hex"),
        roleId: r.id,
        branchId,
      },
    });
    return {
      id,
      name: id,
      email: `${id}@work.test`,
      role,
      roleName: role,
      branchId,
      branchName: "Fixture",
      employeeCode: id,
      permissions: ROLE_PERMISSIONS[role],
      accessMode: ROLE_ACCESS[role],
    } satisfies SessionUser;
  }
  const owner = await person("owner", "OWNER"),
    manager = await person("manager", "BRANCH_MANAGER"),
    staff = await person("staff", "VISA_EXECUTIVE"),
    staff2 = await person("staff2", "VISA_EXECUTIVE"),
    outsider = await person("outside", "VISA_EXECUTIVE", other.id),
    readonly = await person("read", "READ_ONLY");
  const customer = await db.customer.create({
    data: {
      name: "Fixture customer",
      code: "WF-C",
      phone: "+919876500001",
      city: "Pune",
      branchId: branch.id,
      assignedToId: owner.id,
    },
  });
  const journey = await db.$transaction((tx) =>
    createServiceCase(
      tx,
      {
        customerId: customer.id,
        branchId: branch.id,
        ownerId: owner.id,
        service: "VISA",
        title: "Fixture visa journey",
      },
      owner.id,
    ),
  );
  const work = await db.serviceWork.findUniqueOrThrow({
    where: { caseId_service: { caseId: journey.id, service: "VISA" } },
  });
  assert.equal(
    await db.task.count({
      where: { sourceKey: `plan:${work.id}`, unassigned: true },
    }),
    1,
  );
  pass();
  const input = createWorkSchema.parse({
    requestKey: randomUUID(),
    caseId: journey.id,
    serviceWorkId: work.id,
    title: "Prepare application",
    ownerId: staff.id,
    dueAt: new Date(Date.now() + 3600000).toISOString(),
    requiresReview: true,
    reviewerId: manager.id,
  });
  const run = () =>
    db.$transaction((tx) =>
      workMutation(tx, owner, input.requestKey, input, () =>
        createWork(tx, owner, input),
      ),
    );
  const made = await run();
  assert.deepEqual(await run(), made);
  assert.equal(await db.task.count({ where: { id: made.taskId } }), 1);
  pass();
  await assert.rejects(
    () =>
      db.$transaction((tx) =>
        workMutation(
          tx,
          owner,
          input.requestKey,
          { ...input, title: "different" },
          () => createWork(tx, owner, input),
        ),
      ),
    /different changes/,
  );
  pass();
  await assert.rejects(
    () =>
      db.$transaction((tx) =>
        createWork(tx, staff, {
          ...input,
          requestKey: randomUUID(),
          ownerId: staff2.id,
        }),
      ),
    /delegate/,
  );
  pass();
  await assert.rejects(
    () =>
      db.$transaction((tx) =>
        createWork(tx, owner, {
          ...input,
          requestKey: randomUUID(),
          ownerId: outsider.id,
        }),
      ),
    /branch/,
  );
  pass();
  await assert.rejects(
    () =>
      db.$transaction((tx) =>
        createWork(tx, readonly, { ...input, requestKey: randomUUID() }),
      ),
    /cannot create/,
  );
  pass();
  assert.equal((await caseFor(db, staff, journey.id)).id, journey.id);
  await assert.rejects(() => taskFor(db, outsider, made.taskId), /outside/);
  pass();
  async function act(
    user: SessionUser,
    action: string,
    note = "Recorded test result",
    extra: Record<string, unknown> = {},
  ) {
    const t = await db.task.findUniqueOrThrow({ where: { id: made.taskId } });
    return db.$transaction((tx) =>
      changeWork(tx, user, t.id, {
        requestKey: randomUUID(),
        version: t.version,
        action: action as "START",
        note,
        ...extra,
      }),
    );
  }
  await act(staff, "START");
  await assert.rejects(() => act(staff, "COMPLETE"), /review/);
  pass();
  await assert.rejects(
    () =>
      db.$transaction((tx) => legacyTaskStatus(tx, staff, made.taskId, "DONE")),
    /review/,
  );
  pass();
  await assert.rejects(
    () =>
      act(staff, "WAIT", "", {
        waitingReason: "CUSTOMER",
        nextCheckAt: new Date().toISOString(),
      }),
    /follow-up/,
  );
  pass();
  await act(staff, "WAIT", "Awaiting a customer answer", {
    waitingReason: "CUSTOMER",
    nextCheckAt: new Date(Date.now() + 600000).toISOString(),
  });
  assert.equal(
    (await db.task.findUniqueOrThrow({ where: { id: made.taskId } })).workState,
    "WAITING",
  );
  pass();
  await act(staff, "RESUME");
  await act(staff, "SUBMIT");
  await assert.rejects(() => act(staff, "APPROVE"), /reviewer/);
  pass();
  await act(manager, "RETURN", "Correct the missing details");
  await act(staff, "SUBMIT", "Corrected application prepared");
  await act(manager, "APPROVE");
  assert.equal(
    (await db.task.findUniqueOrThrow({ where: { id: made.taskId } })).status,
    "DONE",
  );
  pass();
  const completion = await db.workEvent.findFirstOrThrow({
    where: { taskId: made.taskId, kind: "APPROVE" },
  });
  assert.equal(completion.assigneeId, staff.id);
  pass();
  await act(manager, "REOPEN", "Customer requested correction");
  await act(manager, "ASSIGN", "Reassigned for follow-up", {
    ownerId: staff2.id,
  });
  assert.equal(
    (await db.workEvent.findUniqueOrThrow({ where: { id: completion.id } }))
      .assigneeId,
    staff.id,
  );
  pass();
  const before = await db.task.findUniqueOrThrow({
    where: { id: made.taskId },
  });
  await act(manager, "EDIT", "Customer asked for later deadline", {
    dueAt: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(
    (
      await db.task.findUniqueOrThrow({ where: { id: made.taskId } })
    ).originalDueAt?.toISOString(),
    before.originalDueAt?.toISOString(),
  );
  pass();
  await assert.rejects(
    () =>
      db.$transaction((tx) =>
        changeWork(tx, manager, made.taskId, {
          requestKey: randomUUID(),
          version: before.version,
          action: "START",
          note: "",
        }),
      ),
    /changed/,
  );
  pass();
  await assert.rejects(
    () => act(staff, "START"),
    /not found|outside|assignee/i,
  );
  pass();
  const dependent = await db.$transaction((tx) =>
    createWork(tx, owner, {
      ...input,
      requestKey: randomUUID(),
      title: "Dependent work",
      requiresReview: false,
      reviewerId: null,
      prerequisiteId: made.taskId,
    }),
  );
  const dep = await db.task.findUniqueOrThrow({
    where: { id: dependent.taskId },
  });
  await assert.rejects(
    () =>
      db.$transaction((tx) =>
        changeWork(tx, staff, dep.id, {
          requestKey: randomUUID(),
          version: dep.version,
          action: "START",
          note: "",
        }),
      ),
    /prerequisite/,
  );
  pass();
  const plan = {
    requestKey: randomUUID(),
    caseId: journey.id,
    service: "VISA" as const,
    configVersion: 1,
    steps: DEFAULT_WORK_CONFIG.templates[0].steps.map((s) => ({
      key: s.key,
      ownerId: staff.id,
      reviewerId: s.requiresReview ? manager.id : null,
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    })),
  };
  const first = await db.$transaction((tx) =>
    applyWorkTemplate(tx, owner, plan),
  );
  assert.equal(first.created, 5);
  const again = await db.$transaction((tx) =>
    applyWorkTemplate(tx, owner, { ...plan, requestKey: randomUUID() }),
  );
  assert.equal(again.created, 0);
  pass();
  const submit = await db.task.findUniqueOrThrow({
    where: { sourceKey: `template:${work.id}:submit` },
  });
  const predecessor = await db.task.findUniqueOrThrow({
    where: { sourceKey: `template:${work.id}:prepare` },
  });
  await db.task.update({
    where: { id: predecessor.id },
    data: { status: "DONE", workState: "DONE" },
  });
  await assert.rejects(
    () =>
      db.$transaction((tx) =>
        changeWork(tx, staff, submit.id, {
          requestKey: randomUUID(),
          version: submit.version,
          action: "COMPLETE",
          note: "Submitted",
        }),
      ),
    /actual visa/,
  );
  pass();
  const hotelPlan = {
    ...plan,
    requestKey: randomUUID(),
    service: "HOTEL" as const,
    steps: DEFAULT_WORK_CONFIG.templates[2].steps.map((s) => ({
      key: s.key,
      ownerId: null,
      reviewerId: null,
      dueAt: null,
    })),
  };
  await db.$transaction((tx) => applyWorkTemplate(tx, owner, hotelPlan));
  assert.equal(
    await db.serviceWork.count({ where: { caseId: journey.id } }),
    2,
  );
  pass();
  assert.equal(
    (await db.$queryRawUnsafe<unknown[]>("PRAGMA foreign_key_check")).length,
    0,
  );
  pass();
  execFileSync(
    process.execPath,
    [
      "--import",
      "./scripts/standalone-server.mjs",
      "--import",
      "tsx",
      "tests/work-report-fixture.mts",
      url,
    ],
    {
      env: { ...process.env, DATABASE_URL: url, WA_PROVIDER: "" },
      stdio: "inherit",
    },
  );
  console.log(
    `PASS work engine: ${checks} ownership, branch, review, retry, dependency, template, outcome, history and migration-integrity checks.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await db.$disconnect();
  const resolved = await realpath(dir);
  if (
    path.dirname(resolved) !== root ||
    !path.basename(resolved).startsWith("crm-work-test-")
  )
    throw Error("Unexpected fixture path");
  await rm(resolved, { recursive: true, force: true });
}
