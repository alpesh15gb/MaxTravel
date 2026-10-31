import { notifyWork } from "./work-engine";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { isMetaUnavailableBody } from "./meta-inbound";
import { readWorkConfig, agencyDay } from "./work-config";
import {
  ROLE_PERMISSIONS,
  ROLE_ACCESS,
  type RoleKey,
  type Permission,
} from "./permissions";
type Db = Prisma.TransactionClient;
async function accountablePerson(
  tx: Db,
  candidates: (string | null | undefined)[],
  branchId: string | null,
  permission: Permission,
) {
  const people = await tx.user.findMany({
    where: {
      active: true,
      OR: [
        { id: { in: candidates.filter((id): id is string => !!id) } },
        {
          role: {
            key: {
              in: ["OWNER", "SUPER_ADMIN", "BRANCH_MANAGER", "OPERATIONS"],
            },
          },
          OR: [
            { branchId },
            { role: { key: { in: ["OWNER", "SUPER_ADMIN"] } } },
          ],
        },
      ],
    },
    include: { role: true },
  });
  const eligible = people.filter((p) => {
    const perms = ROLE_PERMISSIONS[p.role.key as RoleKey] ?? [];
    return (
      perms.includes("task:edit") &&
      perms.includes(permission) &&
      (p.branchId === branchId || ROLE_ACCESS[p.role.key as RoleKey] === "ALL")
    );
  });
  return (
    candidates.map((id) => eligible.find((p) => p.id === id)).find(Boolean) ??
    eligible.find((p) =>
      (ROLE_PERMISSIONS[p.role.key as RoleKey] ?? []).includes("work:assign"),
    ) ??
    null
  );
}
export async function inboundWorkException(tx: Db, inboundId: string) {
  const message = await tx.whatsAppInbound.findUnique({
    where: { id: inboundId },
  });
  if (!message?.matched || !isMetaUnavailableBody(message.body)) return;
  const filed = await tx.whatsAppMessage.findUnique({
    where: { providerKey: message.providerKey },
    include: { thread: { include: { customer: true } } },
  });
  if (!filed) return;
  const customer = filed.thread.customer,
    cases = await tx.serviceCase.findMany({
      where: { customerId: customer.id, closedAt: null },
      take: 2,
    });
  const journey = cases.length === 1 ? cases[0] : null,
    person = await accountablePerson(
      tx,
      [journey?.ownerId, customer.assignedToId],
      customer.branchId,
      "whatsapp:view",
    ),
    ownerId = person?.id;
  if (!ownerId) return;
  const config = readWorkConfig(
      (await tx.settings.findUnique({ where: { key: "work.configuration" } }))
        ?.value,
    ),
    due = new Date(Date.now() + config.responseHours * 3600000);
  const sourceKey = `inbound-review:${message.providerKey}`;
  if (await tx.task.findUnique({ where: { sourceKey } })) return;
  const task = await tx.task.create({
    data: {
      sourceKey,
      title: "Review unavailable customer message",
      details:
        "Meta did not supply readable content. Check the permitted customer inbox, contact the customer through an available channel and record the follow-up. This task does not recover the missing text.",
      customerId: customer.id,
      serviceCaseId: journey?.id,
      branchId: customer.branchId,
      ownerId,
      unassigned: false,
      dueAt: due,
      originalDueAt: new Date(Date.now() + 3600000),
      assignedAt: new Date(),
      priority: "HIGH",
      workflowTracked: true,
    },
  });
  await tx.workEvent.create({
    data: {
      taskId: task.id,
      actorName: "System",
      kind: "CREATED",
      toState: "TODO",
      assigneeId: ownerId,
      assigneeName: person?.name,
      taskTitle: task.title,
      caseNo: journey?.caseNo,
      detail:
        "Unavailable inbound content needs a human follow-up. Customer/case association was unambiguous.",
    },
  });
  await tx.notification.create({
    data: {
      userId: ownerId,
      title: "Customer message needs review",
      body: journey
        ? journey.caseNo
        : "Open the customer inbox and identify the relevant case.",
      link: `/work?task=${task.id}`,
      severity: "WARNING",
    },
  });
  if (journey)
    await tx.caseMessage.upsert({
      where: { caseId_messageId: { caseId: journey.id, messageId: filed.id } },
      create: { caseId: journey.id, messageId: filed.id, linkedById: "SYSTEM" },
      update: {},
    });
}

export async function scheduleWork(now = new Date()) {
  const config = readWorkConfig(
      (
        await prisma.settings.findUnique({
          where: { key: "work.configuration" },
        })
      )?.value,
    ),
    shifted = new Date(now.getTime() + 19800000),
    dayKey = shifted.toISOString().slice(0, 10),
    hour = shifted.getUTCHours();
  const office =
    config.businessHoursEnabled &&
    config.weekdays.includes(shifted.getUTCDay()) &&
    !config.holidays.includes(dayKey) &&
    hour >= config.openHour &&
    hour < config.closeHour;
  const markerDay = String(agencyDay(now).start.getTime());
  const ids = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT t."id" FROM "Task" t WHERE t."status" IN ('OPEN','IN_PROGRESS') AND ( (t."hardDeadline"=true AND t."dueAt"<${new Date(now.getTime() + 86400000)}) ${office ? Prisma.sql`OR t."dueAt"<${now} OR t."nextCheckAt"<=${now} OR (t."updatedAt"<${new Date(now.getTime() - config.staleDays * 86400000)} AND t."workState"<>'WAITING')` : Prisma.empty}) AND NOT EXISTS (SELECT 1 FROM "Settings" s WHERE s."key"='work.notice.'||t."id"||'.'||t."version"||'.'||${markerDay}) ORDER BY t."hardDeadline" DESC,t."dueAt" ASC,t."updatedAt" ASC,t."id" ASC LIMIT 100`,
  );
  const jobs = await prisma.task.findMany({
    where: { id: { in: ids.map((r) => r.id) } },
  });
  for (const selected of jobs)
    await prisma.$transaction(async (tx) => {
      const task = await tx.task.findUnique({ where: { id: selected.id } });
      if (
        !task ||
        task.version !== selected.version ||
        !["OPEN", "IN_PROGRESS"].includes(task.status)
      )
        return;
      const marker = `work.notice.${task.id}.${task.version}.${agencyDay(now).start.getTime()}`;
      if (await tx.settings.findUnique({ where: { key: marker } })) return;
      await tx.settings.create({
        data: { key: marker, value: now.toISOString() },
      });
      const c = task.serviceCaseId
        ? await tx.serviceCase.findUnique({
            where: { id: task.serviceCaseId },
            select: { ownerId: true },
          })
        : null;
      const service = task.serviceWorkId
        ? (
            await tx.serviceWork.findUnique({
              where: { id: task.serviceWorkId },
              select: { service: true },
            })
          )?.service
        : null;
      const permission: Permission =
        task.resultType === "PAYMENT"
          ? "payment:view"
          : task.bookingId || service === "FLIGHT" || service === "HOTEL"
            ? "ticketing:view"
            : task.visaCaseId || service === "VISA"
              ? "visa:view"
              : "task:view";
      const responsible = await accountablePerson(
        tx,
        [task.unassigned ? c?.ownerId : task.ownerId, c?.ownerId],
        task.branchId,
        permission,
      );
      const recipients = [
        ...new Set(
          [
            responsible?.id,
            ...config.escalationUserIds,
            task.workState === "REVIEW" ? task.reviewerId : null,
            c?.ownerId,
          ].filter((x): x is string => !!x),
        ),
      ];
      for (const userId of recipients)
        await notifyWork(
          tx,
          task,
          userId,
          task.unassigned
            ? "Work still needs an assignee"
            : task.nextCheckAt && task.nextCheckAt <= now
              ? "Waiting work needs a follow-up"
              : "Work deadline / progress needs attention",
          task.hardDeadline ? "URGENT" : "WARNING",
        );
    });
  // Own paid-but-unconfirmed exceptions without changing supplier or payment state.
  const bookings = await prisma.booking.findMany({
    where: {
      gdsSource: "TRIPJACK_API",
      tasks: { none: { sourceKey: { startsWith: "paid-booking-review:" } } },
      status: {
        notIn: [
          "TICKETED",
          "CONFIRMED",
          "REISSUED",
          "CANCELLED",
          "VOID",
          "REFUNDED",
        ],
      },
      payments: { some: { amount: { gt: 0 } } },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  for (const b of bookings)
    await prisma.$transaction(async (tx) => {
      const sourceKey = `paid-booking-review:${b.id}`;
      if (await tx.task.findUnique({ where: { sourceKey } })) return;
      const active = await accountablePerson(
        tx,
        [b.ownerId],
        b.branchId,
        "ticketing:view",
      );
      const serviceWork = b.serviceCaseId
        ? await tx.serviceWork.findUnique({
            where: {
              caseId_service: {
                caseId: b.serviceCaseId,
                service: b.product === "HOTEL" ? "HOTEL" : "FLIGHT",
              },
            },
          })
        : null;
      const task = await tx.task.create({
        data: {
          sourceKey,
          title: "Reconcile paid booking without supplier confirmation",
          details:
            "A receipt exists but the supplier record is unresolved. Review the source booking and payment/provider evidence; do not issue or refund twice.",
          ownerId: active?.id ?? b.ownerId,
          serviceWorkId: serviceWork?.id,
          unassigned: !active?.active,
          customerId: b.customerId,
          branchId: b.branchId,
          serviceCaseId: b.serviceCaseId,
          bookingId: b.id,
          dueAt: now,
          originalDueAt: now,
          hardDeadline: true,
          priority: "URGENT",
          workflowTracked: true,
          resultType: "BOOKING_RESOLUTION",
        },
      });
      await tx.workEvent.create({
        data: {
          taskId: task.id,
          actorName: "System",
          kind: "CREATED",
          toState: "TODO",
          assigneeId: active?.id,
          assigneeName: active?.name,
          taskTitle: task.title,
          caseNo: b.serviceCaseId
            ? (
                await tx.serviceCase.findUnique({
                  where: { id: b.serviceCaseId },
                  select: { caseNo: true },
                })
              )?.caseNo
            : null,
          detail: "Actual receipt exists; supplier booking is not resolved.",
        },
      });
      if (active?.active)
        await tx.notification.create({
          data: {
            userId: active.id,
            title: "Paid booking needs reconciliation",
            body: b.bookingNo,
            link: `/work?task=${task.id}`,
            severity: "URGENT",
          },
        });
    });
  // Resume bounded legacy-message reconciliation after the last examined inbound ID.
  const cursorKey = "work.inbound.cursor",
    cursor = (await prisma.settings.findUnique({ where: { key: cursorKey } }))
      ?.value;
  const messages = await prisma.whatsAppInbound.findMany({
    where: {
      ...(cursor ? { id: { gt: cursor } } : {}),
      at: { gte: new Date(now.getTime() - 7 * 86400000) },
    },
    orderBy: { id: "asc" },
    take: 50,
  });
  for (const m of messages)
    await prisma.$transaction((tx) => inboundWorkException(tx, m.id));
  if (messages.length)
    await prisma.settings.upsert({
      where: { key: cursorKey },
      create: { key: cursorKey, value: messages[messages.length - 1].id },
      update: { value: messages[messages.length - 1].id },
    });
  await prisma.settings.deleteMany({
    where: {
      key: { startsWith: "work.notice." },
      value: { lt: new Date(now.getTime() - 30 * 86400000).toISOString() },
    },
  });
  return { reminders: jobs.length, bookingExceptionsChecked: bookings.length };
}
