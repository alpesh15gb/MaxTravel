// Invoked by work-engine.mts with its disposable database, never with the CRM database.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { realpath } from "node:fs/promises";
import { prisma } from "../src/lib/db";
import { readWork, templatePreview } from "../src/lib/work-read";
import { workReport } from "../src/lib/work-reports";
import { scheduleWork } from "../src/lib/work-system";
import { DEFAULT_WORK_CONFIG } from "../src/lib/work-config";
import {
  ROLE_ACCESS,
  ROLE_PERMISSIONS,
  type RoleKey,
} from "../src/lib/permissions";
import type { SessionUser } from "../src/lib/session";

const url = process.env.DATABASE_URL ?? "";
assert.equal(
  url,
  process.argv[2],
  "A parent must explicitly provide its fixture database",
);
const fixturePath = await realpath(url.slice(5)),
  tempRoot = await realpath(os.tmpdir());
assert(
  path.dirname(path.dirname(fixturePath)) === tempRoot &&
    path.basename(path.dirname(fixturePath)).startsWith("crm-work-test-"),
  "Only a disposable workflow fixture may be used",
);
async function session(id: string): Promise<SessionUser> {
  const u = await prisma.user.findUniqueOrThrow({
      where: { id },
      include: { role: true },
    }),
    role = u.role.key as RoleKey;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role,
    roleName: role,
    branchId: u.branchId,
    branchName: "Fixture",
    permissions: ROLE_PERMISSIONS[role],
    accessMode: ROLE_ACCESS[role],
  };
}
try {
  const owner = await session("owner"),
    staff = await session("staff");
  const hr = {
    ...owner,
    id: "hr-scope-check",
    role: "HR" as const,
    permissions: ROLE_PERMISSIONS.HR,
  };
  assert.equal(
    (await readWork(hr, new URLSearchParams({ view: "all" }))).total,
    0,
    "Employee administration does not grant team task visibility",
  );
  const defaultCase = await prisma.serviceCase.findFirstOrThrow({
      where: { ownerId: owner.id, closedAt: null, service: "VISA" },
    }),
    cfgDefaults = structuredClone(DEFAULT_WORK_CONFIG);
  cfgDefaults.templates[0].steps[0].defaultOwnerId = staff.id;
  cfgDefaults.templates[0].steps[0].defaultReviewerId = "CASE_COORDINATOR";
  cfgDefaults.templates[0].steps[0].dueAfterHours = 24;
  await prisma.settings.upsert({
    where: { key: "work.configuration" },
    create: { key: "work.configuration", value: JSON.stringify(cfgDefaults) },
    update: { value: JSON.stringify(cfgDefaults) },
  });
  const defaultsPreview = await templatePreview(owner, defaultCase.id, "VISA");
  assert.equal(defaultsPreview.steps[0].defaultOwnerId, staff.id);
  assert.equal(defaultsPreview.steps[0].defaultReviewerId, owner.id);
  assert(
    Math.abs(
      new Date(defaultsPreview.steps[0].defaultDueAt!).getTime() -
        Date.now() -
        86400000,
    ) < 5000,
    "Template due targets resolve to a real preview deadline",
  );
  cfgDefaults.templates[0].steps[0].defaultOwnerId = "outside";
  await prisma.settings.update({
    where: { key: "work.configuration" },
    data: { value: JSON.stringify(cfgDefaults) },
  });
  const ineligiblePreview = await templatePreview(
    owner,
    defaultCase.id,
    "VISA",
  );
  assert.equal(ineligiblePreview.steps[0].defaultOwnerId, null);
  assert(
    ineligiblePreview.steps[0].warnings.length,
    "An ineligible cross-branch default requires explicit reassignment",
  );
  await prisma.settings.update({
    where: { key: "work.configuration" },
    data: { value: JSON.stringify(DEFAULT_WORK_CONFIG) },
  });
  const history = await workReport(staff, new URLSearchParams());
  assert(
    history.events.some((e) => e.kind === "APPROVE" && !e.canOpen),
    "Staff retains their completion history after reassignment without access to current work",
  );
  assert(
    history.events
      .filter((e) => e.kind === "APPROVE")
      .every((e) => e.assignee === "staff"),
  );
  await assert.rejects(
    () => workReport(staff, new URLSearchParams({ owner: "staff2" })),
    /own work only/,
  );
  const caseRow = await prisma.serviceCase.findFirstOrThrow();
  const needle = await prisma.task.create({
    data: {
      title: "Unique filtered overdue task",
      ownerId: owner.id,
      customerId: caseRow.customerId,
      serviceCaseId: caseRow.id,
      branchId: caseRow.branchId,
      dueAt: new Date(Date.now() - 100000),
      originalDueAt: new Date(Date.now() - 100000),
      workflowTracked: true,
    },
  });
  const filtered = await readWork(
    owner,
    new URLSearchParams({ q: "Unique filtered overdue task", view: "overdue" }),
  );
  assert.equal(filtered.total, 1);
  assert.equal(filtered.stats.overdue, 1);
  assert.equal(filtered.rows[0].id, needle.id);
  const report = await workReport(owner, new URLSearchParams());
  for (const [state, count] of Object.entries(report.cohort)) {
    const drill = await readWork(
      owner,
      new URLSearchParams({
        view: "records",
        state,
        dueFrom: report.from,
        dueTo: report.to,
      }),
    );
    assert.equal(drill.total, count, `Exact due cohort drilldown for ${state}`);
  }
  const inactive = await prisma.user.findUniqueOrThrow({
    where: { id: "outside" },
  });
  await prisma.user.update({
    where: { id: inactive.id },
    data: { active: false },
  });
  const orphan = await prisma.task.create({
    data: {
      title: "Inactive assignee handover",
      ownerId: inactive.id,
      branchId: inactive.branchId,
      workflowTracked: true,
    },
  });
  const unassigned = await readWork(
    owner,
    new URLSearchParams({
      view: "unassigned",
      q: "Inactive assignee handover",
    }),
  );
  assert.equal(unassigned.total, 1);
  assert.equal(unassigned.rows[0].unassigned, true);
  assert.equal(unassigned.rows[0].id, orphan.id);
  const now = new Date();
  await prisma.task.createMany({
    data: Array.from({ length: 105 }, (_, i) => ({
      id: `batch-${String(i).padStart(3, "0")}`,
      title: `Batch hard deadline ${i}`,
      ownerId: owner.id,
      branchId: owner.branchId,
      hardDeadline: true,
      dueAt: new Date(now.getTime() - 1000),
      updatedAt: new Date("2000-01-01T00:00:00Z"),
      workflowTracked: true,
    })),
  });
  await scheduleWork(now);
  await scheduleWork(now);
  await scheduleWork(now);
  assert.equal(
    await prisma.notification.count({
      where: { link: { contains: "/work?task=batch-" } },
    }),
    105,
    "Bounded reminder batches advance and do not duplicate daily notices",
  );
  const booking = await prisma.booking.create({
    data: {
      bookingNo: "BK-PAID-EXCEPTION",
      customerId: caseRow.customerId,
      ownerId: owner.id,
      branchId: owner.branchId,
      gdsSource: "TRIPJACK_API",
      status: "ENQUIRY",
    },
  });
  await prisma.payment.create({
    data: {
      receiptNo: "RCPT-EXCEPTION",
      customerId: caseRow.customerId,
      bookingId: booking.id,
      amount: 100,
      receivedById: owner.id,
    },
  });
  await scheduleWork(now);
  await scheduleWork(now);
  assert.equal(
    await prisma.task.count({
      where: { sourceKey: `paid-booking-review:${booking.id}` },
    }),
    1,
  );
  assert.equal(
    (await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }))
      .status,
    "ENQUIRY",
    "A reconciliation alert cannot mutate supplier state",
  );
  assert.equal(
    await prisma.payment.count({ where: { bookingId: booking.id } }),
    1,
    "A reconciliation alert cannot duplicate or refund a receipt",
  );
  await prisma.settings.upsert({
    where: { key: "work.configuration" },
    create: {
      key: "work.configuration",
      value: JSON.stringify({
        ...DEFAULT_WORK_CONFIG,
        businessHoursEnabled: true,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        openHour: 0,
        closeHour: 24,
      }),
    },
    update: {
      value: JSON.stringify({
        ...DEFAULT_WORK_CONFIG,
        businessHoursEnabled: true,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        openHour: 0,
        closeHour: 24,
      }),
    },
  });
  const waiting = await prisma.task.create({
    data: {
      title: "Waiting with a future agreed follow-up",
      ownerId: owner.id,
      status: "IN_PROGRESS",
      workState: "WAITING",
      nextCheckAt: new Date(now.getTime() + 86400000),
      dueAt: new Date(now.getTime() + 7 * 86400000),
      updatedAt: new Date("2000-01-01T00:00:00Z"),
      workflowTracked: true,
    },
  });
  for (let i = 0; i < 3; i++) await scheduleWork(now);
  assert.equal(
    await prisma.notification.count({
      where: { link: `/work?task=${waiting.id}` },
    }),
    0,
    "An agreed future waiting check is not a stale-work alert",
  );
  console.log(
    "PASS work reporting and automation: historical attribution/privacy, exact filtered counts/drilldowns, inactive handover, 105-item reminder pagination/deduplication, paid-booking reconciliation and waiting calendar.",
  );
} finally {
  await prisma.$disconnect();
}
