import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma, Task } from "@prisma/client";
import type { SessionUser } from "./session";
import { ApiError, canTouchRecord } from "./guard";
import { ROLE_ACCESS, ROLE_PERMISSIONS, type RoleKey } from "./permissions";
import { caseFor } from "./service-cases";
import {
  RESULT_TYPES,
  resultsForService,
  WAITING_REASONS,
  legacyStatus,
  readWorkConfig,
  serviceSchema,
  stateOf,
} from "./work-config";

export type WorkDb = Prisma.TransactionClient;
export const canAssignWork = (u: SessionUser) =>
  u.permissions.includes("work:assign");
export const canReviewWork = (u: SessionUser) =>
  u.permissions.includes("work:review");
export const canReadService = (u: SessionUser, service: string) =>
  u.permissions.includes(service === "VISA" ? "visa:view" : "ticketing:view");
export function readableWorkType(u: SessionUser): Prisma.TaskWhereInput {
  const allowed = [
    ...(u.permissions.includes("visa:view") ? ["VISA"] : []),
    ...(u.permissions.includes("ticketing:view") ? ["FLIGHT", "HOTEL"] : []),
  ];
  return {
    AND: [
      ...(u.permissions.includes("ticketing:view")
        ? []
        : [{ bookingId: null }]),
      ...(u.permissions.includes("visa:view") ? [] : [{ visaCaseId: null }]),
      {
        OR: [
          { serviceWorkId: null },
          { serviceWork: { service: { in: allowed } } },
        ],
      },
      ...(u.permissions.includes("payment:view")
        ? []
        : [{ resultType: { not: "PAYMENT" } }]),
    ],
  };
}
export function taskScope(u: SessionUser): Prisma.TaskWhereInput {
  const allowed = [
    ...(u.permissions.includes("visa:view") ? ["VISA"] : []),
    ...(u.permissions.includes("ticketing:view") ? ["FLIGHT", "HOTEL"] : []),
  ];
  const service: Prisma.TaskWhereInput = {
    OR: [
      { serviceWorkId: null },
      { serviceWork: { service: { in: allowed } } },
    ],
  };
  const access: Prisma.TaskWhereInput =
    u.permissions.includes("work:team") && u.accessMode === "ALL"
      ? {}
      : u.permissions.includes("work:team") && u.accessMode === "BRANCH"
        ? { branchId: u.branchId ?? "__none__" }
        : {
            OR: [
              { ownerId: u.id },
              { reviewerId: u.id },
              { serviceCase: { ownerId: u.id } },
            ],
          };
  return { AND: [access, service, readableWorkType(u)] };
}
export async function taskFor(db: WorkDb, u: SessionUser, id: string) {
  const task = await db.task.findFirst({
    where: { AND: [taskScope(u), { id }] },
  });
  if (!task)
    throw new ApiError(404, "Work item not found or outside your access.");
  return task;
}
const optionalDate = z.string().datetime().nullable();
export const createWorkSchema = z
  .object({
    requestKey: z.string().uuid(),
    caseId: z.string().max(200).nullable().default(null),
    serviceWorkId: z.string().max(200).nullable().default(null),
    title: z.string().trim().min(3).max(200),
    details: z.string().trim().max(3000).default(""),
    ownerId: z.string().max(200).nullable().default(null),
    dueAt: optionalDate,
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
    requiresReview: z.boolean().default(false),
    reviewerId: z.string().max(200).nullable().default(null),
    resultType: z.enum(RESULT_TYPES).default("NOTE"),
    required: z.boolean().default(true),
    hardDeadline: z.boolean().default(false),
    bookingId: z.string().max(200).nullable().default(null),
    visaCaseId: z.string().max(200).nullable().default(null),
    prerequisiteId: z.string().max(200).nullable().default(null),
  })
  .strict();
export const changeWorkSchema = z
  .object({
    requestKey: z.string().uuid(),
    version: z.number().int().positive(),
    action: z.enum([
      "START",
      "WAIT",
      "RESUME",
      "SUBMIT",
      "COMPLETE",
      "APPROVE",
      "RETURN",
      "REOPEN",
      "CANCEL",
      "WAIVE",
      "EDIT",
      "ASSIGN",
    ]),
    note: z.string().trim().max(3000).default(""),
    ownerId: z.string().max(200).nullable().optional(),
    dueAt: optionalDate.optional(),
    nextCheckAt: optionalDate.optional(),
    waitingReason: z.enum(WAITING_REASONS).optional(),
    title: z.string().trim().min(3).max(200).optional(),
    details: z.string().trim().max(3000).optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
    reviewerId: z.string().max(200).nullable().optional(),
    requiresReview: z.boolean().optional(),
    caseId: z.string().max(200).optional(),
    serviceWorkId: z.string().max(200).optional(),
    bookingId: z.string().max(200).nullable().optional(),
    visaCaseId: z.string().max(200).nullable().optional(),
  })
  .strict();
export type CreateWork = z.infer<typeof createWorkSchema>;
export type ChangeWork = z.infer<typeof changeWorkSchema>;

export async function workMutation<T>(
  tx: WorkDb,
  u: SessionUser,
  key: string,
  body: unknown,
  run: () => Promise<T>,
): Promise<T> {
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const prior = await tx.workMutation.findUnique({
    where: { actorId_requestKey: { actorId: u.id, requestKey: key } },
  });
  if (prior) {
    if (prior.bodyHash !== hash)
      throw new ApiError(
        409,
        "This retry reference belongs to different changes.",
      );
    return JSON.parse(prior.response) as T;
  }
  const result = await run();
  await tx.workMutation.create({
    data: {
      actorId: u.id,
      requestKey: key,
      bodyHash: hash,
      response: JSON.stringify(result),
    },
  });
  return result;
}
export async function eligiblePerson(
  tx: WorkDb,
  u: SessionUser,
  id: string,
  branchId: string | null,
  service?: string,
  review = false,
  resultType = "NOTE",
) {
  const person = await tx.user.findUnique({
    where: { id },
    include: { role: true },
  });
  const role = person?.role.key as RoleKey,
    permissions = ROLE_PERMISSIONS[role] ?? [];
  if (
    (resultType === "PAYMENT" && !permissions.includes("payment:view")) ||
    !person?.active ||
    (branchId && ROLE_ACCESS[role] !== "ALL" && person.branchId !== branchId) ||
    !permissions.includes(review ? "work:review" : "task:edit") ||
    (service &&
      !permissions.includes(
        service === "VISA" ? "visa:view" : "ticketing:view",
      ))
  )
    throw new ApiError(
      400,
      "Choose an active, permitted colleague for this branch and service.",
    );
  if (id !== u.id && !canAssignWork(u) && !review)
    throw new ApiError(403, "Your role cannot delegate another person's work.");
  return person;
}
export async function recordWorkEvent(
  tx: WorkDb,
  u: Pick<SessionUser, "id" | "name"> | null,
  task: Task,
  kind: string,
  detail: string,
  fromState?: string,
) {
  const owner = task.unassigned
    ? null
    : await tx.user.findUnique({
        where: { id: task.ownerId },
        select: { name: true },
      });
  const sourceReferences = await Promise.all([
    task.bookingId
      ? tx.booking.findUnique({
          where: { id: task.bookingId },
          select: { bookingNo: true },
        })
      : null,
    task.visaCaseId
      ? tx.visaCase.findUnique({
          where: { id: task.visaCaseId },
          select: { caseNo: true },
        })
      : null,
  ]);
  const sourceLabel = sourceReferences
    .map((r) => r && ("bookingNo" in r ? r.bookingNo : r.caseNo))
    .filter(Boolean)
    .join(" / ");
  const caseReference = task.serviceCaseId
    ? (
        await tx.serviceCase.findUnique({
          where: { id: task.serviceCaseId },
          select: { caseNo: true },
        })
      )?.caseNo
    : null;
  await tx.workEvent.create({
    data: {
      taskTitle: task.title,
      caseNo: caseReference,
      taskId: task.id,
      actorId: u?.id,
      actorName: u?.name ?? "System",
      kind,
      fromState,
      toState: stateOf(task),
      assigneeId: task.unassigned ? null : task.ownerId,
      assigneeName: owner?.name,
      dueAt: task.dueAt,
      originalDueAt: task.originalDueAt,
      detail: (sourceLabel
        ? "Linked record: " + sourceLabel + "\n" + detail
        : detail
      ).slice(0, 4000),
    },
  });
  if (u)
    await tx.auditLog.create({
      data: {
        userId: u.id,
        action: kind,
        entity: "Task",
        entityId: task.id,
        detail: "Work transition recorded with version " + task.version,
      },
    });
  const service = task.serviceWorkId
    ? (
        await tx.serviceWork.findUnique({
          where: { id: task.serviceWorkId },
          select: { service: true },
        })
      )?.service
    : null;
  const eventPermission =
    task.resultType === "PAYMENT"
      ? "payment:view"
      : service === "VISA" || task.visaCaseId
        ? "visa:view"
        : service || task.bookingId
          ? "ticketing:view"
          : "task:view";
  if (task.serviceCaseId)
    await tx.serviceCaseEvent.create({
      data: {
        caseId: task.serviceCaseId,
        actorId: u?.id,
        kind: "WORK",
        summary: `${kind.replaceAll("_", " ")} · ${task.title}`,
        permission: eventPermission,
        href: `/work?task=${task.id}`,
      },
    });
}
export async function notifyWork(
  tx: WorkDb,
  task: Task,
  userId: string | null | undefined,
  title: string,
  severity = "INFO",
) {
  if (!userId) return;
  const person = await tx.user.findUnique({
    where: { id: userId },
    include: { role: true },
  });
  if (!person?.active) return;
  const role = person.role.key as RoleKey,
    permissions = ROLE_PERMISSIONS[role] ?? [];
  if (!permissions.includes("task:view")) return;
  const recipient: SessionUser = {
    id: person.id,
    name: person.name,
    email: person.email,
    role,
    roleName: person.role.name,
    branchId: person.branchId,
    branchName: null,
    employeeCode: person.employeeCode,
    permissions,
    accessMode: ROLE_ACCESS[role],
  };
  if (
    !(await tx.task.count({
      where: { AND: [taskScope(recipient), { id: task.id }] },
    }))
  )
    return;
  await tx.notification.create({
    data: {
      userId,
      title,
      body: task.title,
      link: `/work?task=${task.id}`,
      severity,
    },
  });
}
async function validateSources(
  tx: WorkDb,
  caseId: string | null,
  customerId: string | null,
  bookingId: string | null,
  visaCaseId: string | null,
  service?: string,
  u?: SessionUser,
) {
  if (bookingId && visaCaseId)
    throw new ApiError(400, "Link one service record to a work item.");
  if (bookingId) {
    const b = await tx.booking.findUnique({
      where: { id: bookingId },
    });
    if (
      u &&
      b &&
      (!u.permissions.includes("ticketing:view") || !canTouchRecord(u, b))
    )
      throw new ApiError(403, "The source booking is outside your access.");
    if (
      !b ||
      b.customerId !== customerId ||
      b.serviceCaseId !== caseId ||
      (service && service !== (b.product === "HOTEL" ? "HOTEL" : "FLIGHT"))
    )
      throw new ApiError(
        400,
        "The booking must belong to this case and service.",
      );
  }
  if (visaCaseId) {
    const v = await tx.visaCase.findUnique({
      where: { id: visaCaseId },
    });
    if (
      u &&
      v &&
      (!u.permissions.includes("visa:view") || !canTouchRecord(u, v))
    )
      throw new ApiError(
        403,
        "The source visa application is outside your access.",
      );
    if (
      !v ||
      v.customerId !== customerId ||
      v.serviceCaseId !== caseId ||
      (service && service !== "VISA")
    )
      throw new ApiError(
        400,
        "The visa application must belong to this case and service.",
      );
  }
}
export async function createWork(
  tx: WorkDb,
  u: SessionUser,
  input: CreateWork,
) {
  if (!u.permissions.includes("task:create"))
    throw new ApiError(403, "Your role cannot create work.");
  const journey = input.caseId ? await caseFor(tx, u, input.caseId) : null;
  if (journey?.closedAt)
    throw new ApiError(409, "Reopen the case before adding work.");
  const work = input.serviceWorkId
    ? await tx.serviceWork.findUnique({ where: { id: input.serviceWorkId } })
    : null;
  if (input.serviceWorkId && (!work || work.caseId !== journey?.id))
    throw new ApiError(400, "Choose a service in this case.");
  if (journey && !work)
    throw new ApiError(400, "Choose the service work for this customer case.");
  if (!resultsForService(work?.service).includes(input.resultType))
    throw new ApiError(
      400,
      "Choose a result supported by this service, or use a note for internal work.",
    );
  if (input.resultType === "PAYMENT" && !u.permissions.includes("payment:view"))
    throw new ApiError(
      403,
      "Finance access is required to oversee a receipt result.",
    );
  if (work && !canReadService(u, work.service))
    throw new ApiError(403, "This service is outside your role.");
  if (!input.ownerId && !canAssignWork(u)) input = { ...input, ownerId: u.id };
  const ownerId = input.ownerId ?? journey?.ownerId ?? u.id,
    branchId = journey?.branchId ?? u.branchId;
  if (input.ownerId)
    await eligiblePerson(
      tx,
      u,
      ownerId,
      branchId,
      work?.service,
      false,
      input.resultType,
    );
  if (!input.ownerId && !canAssignWork(u))
    throw new ApiError(403, "Only a work manager can leave work unassigned.");
  if (input.ownerId && !input.dueAt)
    throw new ApiError(400, "Assigned work needs a due time.");
  if (input.requiresReview) {
    if (!input.reviewerId || input.reviewerId === input.ownerId)
      throw new ApiError(400, "Choose a separate reviewer.");
    await eligiblePerson(
      tx,
      u,
      input.reviewerId,
      branchId,
      work?.service,
      true,
      input.resultType,
    );
  }
  if (input.prerequisiteId) {
    const prior = await taskFor(tx, u, input.prerequisiteId);
    if (!journey || prior.serviceCaseId !== journey.id)
      throw new ApiError(400, "The prerequisite must be in the same case.");
  }
  await validateSources(
    tx,
    journey?.id ?? null,
    journey?.customerId ?? null,
    input.bookingId,
    input.visaCaseId,
    work?.service,
    u,
  );
  const task = await tx.task.create({
    data: {
      title: input.title,
      details: input.details,
      ownerId,
      creatorId: u.id,
      branchId,
      customerId: journey?.customerId,
      serviceCaseId: journey?.id,
      serviceWorkId: work?.id,
      priority: input.priority,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      originalDueAt: input.dueAt ? new Date(input.dueAt) : null,
      unassigned: !input.ownerId,
      assignedAt: input.ownerId ? new Date() : null,
      requiresReview: input.requiresReview,
      reviewerId: input.reviewerId,
      resultType: input.resultType,
      required: input.required,
      hardDeadline: input.hardDeadline,
      bookingId: input.bookingId,
      visaCaseId: input.visaCaseId,
      prerequisiteId: input.prerequisiteId,
      workflowTracked: true,
    },
  });
  await recordWorkEvent(
    tx,
    u,
    task,
    "CREATED",
    input.ownerId
      ? "Work assigned with a due time."
      : "Waiting for a manager to assign work.",
  );
  if (input.ownerId !== u.id)
    await notifyWork(tx, task, input.ownerId, "New work assigned");
  return { taskId: task.id };
}
async function checkResult(tx: WorkDb, task: Task) {
  if (task.resultType === "NOTE") return;
  const where = task.serviceCaseId
    ? { serviceCaseId: task.serviceCaseId }
    : task.bookingId || task.visaCaseId
      ? {}
      : { id: "__none__" };
  const work = task.serviceWorkId
    ? await tx.serviceWork.findUnique({ where: { id: task.serviceWorkId } })
    : null;
  if (["BOOKING", "BOOKING_RESOLUTION"].includes(task.resultType)) {
    const sources = await tx.booking.findMany({
      where: {
        ...where,
        ...(task.bookingId ? { id: task.bookingId } : {}),
        ...(work
          ? { product: work.service === "HOTEL" ? "HOTEL" : { not: "HOTEL" } }
          : {}),
      },
      select: { status: true },
    });
    const allowed =
      task.resultType === "BOOKING_RESOLUTION"
        ? ["TICKETED", "CONFIRMED", "REISSUED", "CANCELLED", "VOID", "REFUNDED"]
        : work?.service === "HOTEL"
          ? ["CONFIRMED"]
          : ["TICKETED", "REISSUED"];
    if (!sources.length || sources.some((b) => !allowed.includes(b.status)))
      throw new ApiError(
        409,
        "Record every linked supplier outcome first. An unlinked case-level step covers all records of this service; task completion cannot confirm a booking.",
      );
  } else if (["VISA_SUBMISSION", "VISA_OUTCOME"].includes(task.resultType)) {
    const sources = await tx.visaCase.findMany({
      where: { ...where, ...(task.visaCaseId ? { id: task.visaCaseId } : {}) },
      select: { submissionDate: true, visaOutcome: true },
    });
    if (
      !sources.length ||
      sources.some((v) =>
        task.resultType === "VISA_SUBMISSION"
          ? !v.submissionDate
          : !v.visaOutcome,
      )
    )
      throw new ApiError(
        409,
        "Record the actual visa submission or authority outcome in every linked application first.",
      );
  } else if (task.resultType === "DOCUMENTS") {
    const docs = await tx.document.findMany({
      where: {
        visaCase: {
          ...where,
          ...(task.visaCaseId ? { id: task.visaCaseId } : {}),
        },
      },
      select: { verificationStatus: true, status: true },
    });
    if (
      !docs.length ||
      docs.some(
        (d) => d.verificationStatus !== "VERIFIED" && d.status !== "WAIVED",
      )
    )
      throw new ApiError(
        409,
        "Verify or explicitly waive the required documents in the document workflow first.",
      );
  } else if (task.resultType === "QUOTE") {
    if (
      !(await tx.salesLead.count({
        where: {
          serviceCaseId: task.serviceCaseId ?? "__none__",
          ...(work ? { product: work.service } : {}),
          quotes: { some: {} },
        },
      }))
    )
      throw new ApiError(409, "Prepare a quotation on this case first.");
  } else if (task.resultType === "PAYMENT") {
    if (!uPayment(task))
      throw new ApiError(
        409,
        "Link a booking or visa application before recording this payment outcome.",
      );
    const wherePay = task.bookingId
      ? { bookingId: task.bookingId }
      : { visaCaseId: task.visaCaseId! };
    if (
      !(await tx.payment.count({ where: { ...wherePay, amount: { gt: 0 } } }))
    )
      throw new ApiError(
        409,
        "Record an actual receipt before completing this payment step.",
      );
  }
}
const uPayment = (t: Task) => Boolean(t.bookingId || t.visaCaseId);
export async function changeWork(
  tx: WorkDb,
  u: SessionUser,
  id: string,
  input: ChangeWork,
) {
  if (!u.permissions.includes("task:edit"))
    throw new ApiError(403, "Your role cannot change work.");
  const task = await taskFor(tx, u, id),
    state = stateOf(task),
    manager = canAssignWork(u),
    mine = task.ownerId === u.id && !task.unassigned;
  if (task.version !== input.version)
    throw new ApiError(
      409,
      "This work changed. Refresh before saving; your draft is preserved.",
    );
  const review = ["APPROVE", "RETURN"].includes(input.action);
  if (review) {
    if (
      !canReviewWork(u) ||
      task.ownerId === u.id ||
      (task.reviewerId !== u.id && !manager)
    )
      throw new ApiError(
        403,
        "A permitted, separate reviewer must record this decision.",
      );
  } else if (!mine && !manager)
    throw new ApiError(
      403,
      "Only the assignee or a permitted work manager can change this item.",
    );
  const patch: Prisma.TaskUpdateInput = {
    workflowTracked: true,
    updatedAt: new Date(),
    version: { increment: 1 },
  };
  let next = state;
  if (["ASSIGN", "EDIT"].includes(input.action)) {
    if (["DONE", "CANCELLED"].includes(state))
      throw new ApiError(409, "Reopen the work item before editing.");
    const work = task.serviceWorkId
      ? await tx.serviceWork.findUnique({ where: { id: task.serviceWorkId } })
      : null;
    if (input.action === "ASSIGN" || input.ownerId !== undefined) {
      if (!manager)
        throw new ApiError(
          403,
          "Work assignment requires delegation permission.",
        );
      const owner = input.ownerId ?? null;
      if (owner) {
        await eligiblePerson(
          tx,
          u,
          owner,
          task.branchId,
          work?.service,
          false,
          task.resultType,
        );
        if (!(input.dueAt ?? task.dueAt?.toISOString()))
          throw new ApiError(400, "Assigned work needs a due time.");
      }
      patch.owner = {
        connect: {
          id:
            owner ??
            (task.serviceCaseId
              ? (
                  await tx.serviceCase.findUniqueOrThrow({
                    where: { id: task.serviceCaseId },
                  })
                ).ownerId
              : u.id),
        },
      };
      patch.unassigned = !owner;
      patch.assignedAt = owner ? new Date() : null;
      if (state === "REVIEW")
        throw new ApiError(409, "Return submitted work before reassigning it.");
    }
    if (input.requiresReview !== undefined || input.reviewerId !== undefined) {
      if (!manager)
        throw new ApiError(
          403,
          "Only a work manager can change the review policy.",
        );
      const required = input.requiresReview ?? task.requiresReview,
        reviewer =
          input.reviewerId === undefined ? task.reviewerId : input.reviewerId;
      if (required) {
        if (!reviewer || reviewer === (input.ownerId ?? task.ownerId))
          throw new ApiError(400, "Choose a separate reviewer.");
        await eligiblePerson(
          tx,
          u,
          reviewer,
          task.branchId,
          work?.service,
          true,
          task.resultType,
        );
      }
      patch.requiresReview = required;
      patch.reviewerId = reviewer;
    }
    if (input.dueAt !== undefined) {
      if (!manager && input.dueAt !== task.dueAt?.toISOString())
        throw new ApiError(403, "Ask a work manager to revise the deadline.");
      if (!input.note.trim())
        throw new ApiError(400, "Explain the deadline change.");
      if (input.dueAt === null && !task.unassigned)
        throw new ApiError(400, "Assigned work needs a due time.");
      patch.dueAt = input.dueAt ? new Date(input.dueAt) : null;
      if (!task.originalDueAt && input.dueAt)
        patch.originalDueAt = new Date(input.dueAt);
    }
    let sourceCaseId = task.serviceCaseId,
      sourceService = work?.service;
    if (input.caseId || input.serviceWorkId) {
      if (!manager || task.serviceCaseId)
        throw new ApiError(
          403,
          "Only an unlinked legacy item can be reconciled by a manager.",
        );
      const c = await caseFor(tx, u, input.caseId ?? "");
      if (c.closedAt)
        throw new ApiError(
          409,
          "Reopen the case before linking additional work.",
        );
      sourceCaseId = c.id;
      if (c.customerId !== task.customerId)
        throw new ApiError(400, "Choose a case for this customer.");
      const w = await tx.serviceWork.findFirst({
        where: { id: input.serviceWorkId ?? "", caseId: c.id },
      });
      if (!w || !canReadService(u, w.service))
        throw new ApiError(400, "Choose a permitted service in that case.");
      await eligiblePerson(
        tx,
        u,
        input.ownerId ?? task.ownerId,
        c.branchId,
        w.service,
        false,
        task.resultType,
      );
      const reviewer = input.reviewerId ?? task.reviewerId;
      if ((input.requiresReview ?? task.requiresReview) && reviewer)
        await eligiblePerson(
          tx,
          u,
          reviewer,
          c.branchId,
          w.service,
          true,
          task.resultType,
        );
      sourceService = w.service;
      patch.serviceCase = { connect: { id: c.id } };
      patch.serviceWork = { connect: { id: w.id } };
    }
    const bookingId =
        input.bookingId === undefined ? task.bookingId : input.bookingId,
      visaCaseId =
        input.visaCaseId === undefined ? task.visaCaseId : input.visaCaseId;
    if (
      input.caseId ||
      input.serviceWorkId ||
      input.bookingId !== undefined ||
      input.visaCaseId !== undefined
    ) {
      await validateSources(
        tx,
        sourceCaseId,
        task.customerId,
        bookingId,
        visaCaseId,
        sourceService,
        u,
      );
      patch.booking = bookingId
        ? { connect: { id: bookingId } }
        : { disconnect: true };
      patch.visaCase = visaCaseId
        ? { connect: { id: visaCaseId } }
        : { disconnect: true };
    }
    if (input.title) patch.title = input.title;
    if (input.details !== undefined) patch.details = input.details;
    if (input.priority) patch.priority = input.priority;
  } else {
    const allowed: Record<string, string[]> = {
      START: ["TODO"],
      RESUME: ["WAITING"],
      WAIT: ["TODO", "IN_PROGRESS"],
      SUBMIT: ["TODO", "IN_PROGRESS"],
      COMPLETE: ["TODO", "IN_PROGRESS"],
      APPROVE: ["REVIEW"],
      RETURN: ["REVIEW"],
      REOPEN: ["DONE", "CANCELLED"],
      CANCEL: ["TODO", "IN_PROGRESS", "WAITING", "REVIEW"],
      WAIVE: ["TODO", "IN_PROGRESS", "WAITING", "CANCELLED"],
    };
    if (!allowed[input.action]?.includes(state))
      throw new ApiError(
        409,
        "That action is not available in the current state.",
      );
    if (task.unassigned && !["CANCEL", "WAIVE"].includes(input.action))
      throw new ApiError(409, "Assign this work before starting it.");
    if (
      ["START", "RESUME", "COMPLETE", "SUBMIT"].includes(input.action) &&
      task.prerequisiteId
    ) {
      const p = await tx.task.findUniqueOrThrow({
        where: { id: task.prerequisiteId },
      });
      if (stateOf(p) !== "DONE" && !p.waived)
        throw new ApiError(
          409,
          "Complete or explicitly waive the prerequisite first.",
        );
    }
    if (["COMPLETE", "SUBMIT", "APPROVE"].includes(input.action)) {
      if (input.action === "COMPLETE" && task.requiresReview)
        throw new ApiError(
          409,
          "Submit this work for review instead of completing it directly.",
        );
      if (input.action !== "APPROVE" && !input.note.trim())
        throw new ApiError(400, "Record the completed result.");
      await checkResult(tx, task);
      next =
        task.requiresReview && input.action !== "APPROVE" ? "REVIEW" : "DONE";
      patch.outcome = input.action === "APPROVE" ? task.outcome : input.note;
      patch.submittedAt = new Date();
      if (next === "DONE") {
        patch.completedAt = new Date();
        patch.reviewedAt = input.action === "APPROVE" ? new Date() : null;
      }
      if (next === "REVIEW" && !task.reviewerId)
        throw new ApiError(409, "A work manager must choose a reviewer first.");
    }
    if (["START", "RESUME", "RETURN", "REOPEN"].includes(input.action)) {
      next = "IN_PROGRESS";
      patch.startedAt = task.startedAt ?? new Date();
      patch.waitingReason = null;
      patch.nextCheckAt = null;
      if (["RETURN", "REOPEN"].includes(input.action)) {
        if (!input.note.trim())
          throw new ApiError(
            400,
            "Explain why work is being returned or reopened.",
          );
        if (input.action === "REOPEN" && !manager)
          throw new ApiError(403, "Ask a manager to reopen completed work.");
        patch.completedAt = null;
        patch.reviewedAt = null;
        patch.waived = false;
      }
    }
    if (input.action === "WAIT") {
      if (
        !input.note.trim() ||
        !input.waitingReason ||
        !input.nextCheckAt ||
        new Date(input.nextCheckAt).getTime() <= Date.now()
      )
        throw new ApiError(
          400,
          "Choose a waiting reason, explain the blocker and set a future follow-up time.",
        );
      next = "WAITING";
      patch.waitingReason = input.waitingReason;
      patch.nextCheckAt = new Date(input.nextCheckAt);
    }
    if (["CANCEL", "WAIVE"].includes(input.action)) {
      if (!manager || !input.note.trim())
        throw new ApiError(
          403,
          "A work manager must record the reason for cancelling or waiving work.",
        );
      next = "CANCELLED";
      patch.waived = input.action === "WAIVE";
      patch.completedAt = null;
    }
    patch.workState = next;
    patch.status = legacyStatus(next);
  }
  const updated = await tx.task.update({ where: { id: task.id }, data: patch });
  if (updated.requiresReview && updated.ownerId === updated.reviewerId)
    throw new ApiError(400, "Assignee and reviewer must be different people.");
  await recordWorkEvent(
    tx,
    u,
    updated,
    input.action,
    input.note || "Work details updated.",
    state,
  );
  if (
    ["ASSIGN", "EDIT"].includes(input.action) &&
    (updated.ownerId !== task.ownerId || task.unassigned) &&
    !updated.unassigned
  )
    await notifyWork(tx, updated, updated.ownerId, "Work assigned to you");
  if (next === "REVIEW" && state !== "REVIEW")
    await notifyWork(
      tx,
      updated,
      updated.reviewerId,
      "Work awaiting your review",
    );
  if (input.action === "RETURN")
    await notifyWork(
      tx,
      updated,
      updated.ownerId,
      "Work returned with feedback",
    );
  if (next === "DONE" && state !== "DONE") {
    const coordinator = updated.serviceCaseId
      ? (
          await tx.serviceCase.findUnique({
            where: { id: updated.serviceCaseId },
            select: { ownerId: true },
          })
        )?.ownerId
      : null;
    for (const person of new Set(
      [coordinator, updated.ownerId].filter(
        (x): x is string => !!x && x !== u.id,
      ),
    ))
      await notifyWork(tx, updated, person, "Case work completed");
  }
  return {
    taskId: updated.id,
    version: updated.version,
    state: stateOf(updated),
  };
}

export const applyTemplateSchema = z
  .object({
    requestKey: z.string().uuid(),
    caseId: z.string().min(1),
    service: serviceSchema,
    configVersion: z.number().int().positive(),
    bookingId: z.string().max(200).nullable().optional(),
    visaCaseId: z.string().max(200).nullable().optional(),
    steps: z
      .array(
        z.object({
          key: z.string().max(40),
          ownerId: z.string().max(200).nullable(),
          reviewerId: z.string().max(200).nullable(),
          dueAt: optionalDate,
        }),
      )
      .max(20),
  })
  .strict();
export async function applyWorkTemplate(
  tx: WorkDb,
  u: SessionUser,
  input: z.infer<typeof applyTemplateSchema>,
) {
  if (!canAssignWork(u))
    throw new ApiError(403, "Work delegation permission is required.");
  const c = await caseFor(tx, u, input.caseId);
  if (c.closedAt || !canReadService(u, input.service))
    throw new ApiError(409, "Choose a permitted open case service.");
  const config = readWorkConfig(
    (await tx.settings.findUnique({ where: { key: "work.configuration" } }))
      ?.value,
  );
  if (config.version !== input.configVersion)
    throw new ApiError(
      409,
      "The template changed. Preview its current version before applying.",
    );
  const template = config.templates.find((t) => t.service === input.service)!;
  if (
    input.steps.length !== template.steps.length ||
    new Set(input.steps.map((s) => s.key)).size !== template.steps.length ||
    template.steps.some((s) => !input.steps.some((x) => x.key === s.key))
  )
    throw new ApiError(400, "Preview every template step before applying.");
  const work = await tx.serviceWork.upsert({
    where: { caseId_service: { caseId: c.id, service: input.service } },
    create: {
      caseId: c.id,
      service: input.service,
      title: `${input.service} · ${c.title}`,
    },
    update: {},
  });
  const ids = new Map<string, string>();
  let created = 0;
  for (const step of template.steps) {
    const sourceKey = `template:${work.id}:${step.key}`,
      existing = await tx.task.findUnique({ where: { sourceKey } });
    if (existing) {
      ids.set(step.key, existing.id);
      continue;
    }
    const row = input.steps.find((s) => s.key === step.key)!;
    const result = await createWork(tx, u, {
      requestKey: input.requestKey,
      caseId: c.id,
      serviceWorkId: work.id,
      title: step.title,
      details: step.instructions,
      ownerId: row.ownerId,
      dueAt: row.dueAt,
      priority: "MEDIUM",
      requiresReview: step.requiresReview,
      reviewerId: row.reviewerId,
      resultType: step.resultType,
      required: step.required,
      hardDeadline: false,
      bookingId: input.bookingId ?? null,
      visaCaseId: input.visaCaseId ?? null,
      prerequisiteId: step.prerequisite
        ? (ids.get(step.prerequisite) ?? null)
        : null,
    });
    await tx.task.update({ where: { id: result.taskId }, data: { sourceKey } });
    ids.set(step.key, result.taskId);
    created++;
  }
  await tx.serviceWork.update({
    where: { id: work.id },
    data: { templateVersion: config.version },
  });
  const planning = await tx.task.findUnique({
    where: { sourceKey: `plan:${work.id}` },
  });
  if (planning && stateOf(planning) !== "DONE") {
    const done = await tx.task.update({
      where: { id: planning.id },
      data: {
        status: "DONE",
        workState: "DONE",
        outcome: `Applied template version ${config.version}`,
        completedAt: new Date(),
        unassigned: false,
        ownerId: u.id,
        workflowTracked: true,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    await recordWorkEvent(
      tx,
      u,
      done,
      "COMPLETE",
      `Applied service template version ${config.version}`,
    );
  }
  return { serviceWorkId: work.id, created };
}

export async function legacyTaskStatus(
  tx: WorkDb,
  u: SessionUser,
  id: string,
  status: string,
) {
  const task = await taskFor(tx, u, id);
  const state = stateOf(task);
  if (task.status === status) return task;
  const action =
    status === "DONE"
      ? "COMPLETE"
      : status === "CANCELLED"
        ? "CANCEL"
        : state === "DONE" || state === "CANCELLED"
          ? "REOPEN"
          : state === "WAITING"
            ? "RESUME"
            : "START";
  await changeWork(tx, u, id, {
    requestKey: crypto.randomUUID(),
    version: task.version,
    action,
    note: task.workflowTracked ? "" : "Legacy task status update.",
  });
  return tx.task.findUniqueOrThrow({ where: { id } });
}
