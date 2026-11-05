import {isClosedCase} from "./case-constants";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { SessionUser } from "./session";
import { ApiError, scopeWhere } from "./guard";
import { caseFor, serviceCaseScope } from "./service-cases";
import { ROLE_ACCESS, ROLE_PERMISSIONS, type RoleKey } from "./permissions";
import { agencyDay, readWorkConfig, stateOf } from "./work-config";
import {
  canAssignWork,
  canReadService,
  taskScope,
  eligiblePerson,
} from "./work-engine";

export const workViews = [
  "all",
  "records",
  "mine",
  "today",
  "unassigned",
  "overdue",
  "review",
  "waiting",
  "done",
  "critical",
  "legacy",
] as const;
export function workFilter(
  params: URLSearchParams,
  u: SessionUser,
): Prisma.TaskWhereInput {
  const now = new Date(),
    day = agencyDay(now),
    view =
      params.get("view") ??
      (u.permissions.includes("work:team") ? "all" : "mine");
  if (!workViews.some((v) => v === view))
    throw new ApiError(400, "Choose a valid work view.");
  const active = { status: { in: ["OPEN", "IN_PROGRESS"] } },
    and: Prisma.TaskWhereInput[] = [taskScope(u)];
  const filters: Record<string, Prisma.TaskWhereInput> = {
    all: active,
    records: {},
    mine: { ...active, ownerId: u.id, unassigned: false },
    today: { ...active, dueAt: { lt: day.end } },
    unassigned: {
      ...active,
      OR: [{ unassigned: true }, { owner: { active: false } }],
    },
    overdue: { ...active, dueAt: { lt: now } },
    review: {
      ...active,
      workState: "REVIEW",
      ...(u.permissions.includes("work:team") ? {} : { reviewerId: u.id }),
    },
    waiting: { ...active, workState: "WAITING" },
    done: { status: "DONE" },
    critical: {
      ...active,
      OR: [
        { priority: "URGENT" },
        {
          hardDeadline: true,
          dueAt: { lt: new Date(now.getTime() + 86400000) },
        },
      ],
    },
    legacy: {
      customerId: { not: null },
      serviceCaseId: null,
      workflowTracked: false,
    },
  };
  and.push(filters[view]);
  const q = params.get("q")?.trim().slice(0, 120);
  if (q)
    and.push({
      OR: [
        { title: { contains: q } },
        { serviceCase: { caseNo: { contains: q } } },
        { customer: { name: { contains: q } } },
        { owner: { name: { contains: q } } },
      ],
    });
  if (params.get("case")) and.push({ serviceCaseId: params.get("case")! });
  if (params.get("service"))
    and.push({ serviceWork: { service: params.get("service")! } });
  if (params.get("owner"))
    and.push({ ownerId: params.get("owner")!, unassigned: false });
  if (params.get("state")) {
    const state = params.get("state")!,
      legacy =
        state === "TODO"
          ? "OPEN"
          : state === "DONE"
            ? "DONE"
            : state === "CANCELLED"
              ? "CANCELLED"
              : state === "IN_PROGRESS"
                ? "IN_PROGRESS"
                : null;
    and.push({
      OR: [
        { workflowTracked: true, workState: state },
        ...(legacy ? [{ workflowTracked: false, status: legacy }] : []),
      ],
    });
  }
  if (params.get("dueFrom") || params.get("dueTo")) {
    const from = params.get("dueFrom")
        ? new Date(params.get("dueFrom")!)
        : null,
      to = params.get("dueTo") ? new Date(params.get("dueTo")!) : null;
    if (
      (from && !Number.isFinite(from.getTime())) ||
      (to && !Number.isFinite(to.getTime()))
    )
      throw new ApiError(400, "Choose valid deadline dates.");
    and.push({
      dueAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) },
    });
  }
  return { AND: and };
}
const rowInclude = {
  owner: { select: { id: true, name: true, active: true } },
  customer: { select: { id: true, name: true } },
  serviceCase: {
    select: { id: true, caseNo: true, title: true, ownerId: true },
  },
  serviceWork: { select: { id: true, service: true, title: true } },
  prerequisite: {
    select: {
      id: true,
      title: true,
      status: true,
      workState: true,
      workflowTracked: true,
      waived: true,
    },
  },
  events: {
    orderBy: [{ at: "desc" as const }, { id: "desc" as const }],
    take: 1,
  },
} satisfies Prisma.TaskInclude;
function serializeTask(
  t: Prisma.TaskGetPayload<{ include: typeof rowInclude }>,
) {
  return {
    id: t.id,
    branchId: t.branchId,
    title: t.title,
    details: t.details,
    state: stateOf(t),
    priority: t.priority,
    owner: t.owner,
    unassigned:
      t.unassigned ||
      (["OPEN", "IN_PROGRESS"].includes(t.status) && !t.owner.active),
    customer: t.customer,
    case: t.serviceCase,
    serviceWork: t.serviceWork,
    dueAt: t.dueAt?.toISOString() ?? null,
    originalDueAt: t.originalDueAt?.toISOString() ?? null,
    nextCheckAt: t.nextCheckAt?.toISOString() ?? null,
    waitingReason: t.waitingReason,
    outcome: t.outcome,
    requiresReview: t.requiresReview,
    reviewerId: t.reviewerId,
    required: t.required,
    waived: t.waived,
    hardDeadline: t.hardDeadline,
    resultType: t.resultType,
    version: t.version,
    workflowTracked: t.workflowTracked,
    sourceKey: t.sourceKey,
    bookingId: t.bookingId,
    visaCaseId: t.visaCaseId,
    completedAt: t.completedAt?.toISOString() ?? null,
    prerequisite: t.prerequisite
      ? {
          id: t.prerequisite.id,
          title: t.prerequisite.title,
          done: stateOf(t.prerequisite) === "DONE" || t.prerequisite.waived,
        }
      : null,
    lastUpdate: t.events[0]?.at.toISOString() ?? t.updatedAt.toISOString(),
  };
}
export type WorkRow = ReturnType<typeof serializeTask>;
export async function readWork(u: SessionUser, params: URLSearchParams) {
  const summaryParams = new URLSearchParams(params);
  summaryParams.set("view", "records");
  const where = workFilter(params, u),
    page = Math.max(
      1,
      Math.min(100000, Math.trunc(Number(params.get("page"))) || 1),
    ),
    size = 30,
    scope = workFilter(summaryParams, u),
    active: Prisma.TaskWhereInput = {
      AND: [scope, { status: { in: ["OPEN", "IN_PROGRESS"] } }],
    },
    now = new Date(),
    day = agencyDay();
  const [
    rows,
    total,
    unassigned,
    overdue,
    review,
    critical,
    waiting,
    doneToday,
    people,
    cases,
  ] = await Promise.all([
    prisma.task.findMany({
      where,
      include: rowInclude,
      orderBy: [
        { dueAt: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
        { id: "asc" },
      ],
      skip: (page - 1) * size,
      take: size,
    }),
    prisma.task.count({ where }),
    prisma.task.count({
      where: {
        AND: [
          active,
          { OR: [{ unassigned: true }, { owner: { active: false } }] },
        ],
      },
    }),
    prisma.task.count({ where: { AND: [active, { dueAt: { lt: now } }] } }),
    prisma.task.count({
      where: {
        AND: [
          active,
          {
            workState: "REVIEW",
            ...(u.permissions.includes("work:team")
              ? {}
              : { reviewerId: u.id }),
          },
        ],
      },
    }),
    prisma.task.count({
      where: {
        AND: [
          active,
          {
            OR: [
              { priority: "URGENT" },
              {
                hardDeadline: true,
                dueAt: { lt: new Date(now.getTime() + 86400000) },
              },
            ],
          },
        ],
      },
    }),
    prisma.task.count({ where: { AND: [active, { workState: "WAITING" }] } }),
    prisma.workEvent.count({
      where: {
        task: scope,
        kind: { in: ["COMPLETE", "APPROVE"] },
        toState: "DONE",
        at: { gte: day.start, lt: day.end },
      },
    }),
    canAssignWork(u) || u.permissions.includes("work:review")
      ? prisma.user.findMany({
          where: {
            active: true,
            ...(u.accessMode === "ALL"
              ? {}
              : {
                  OR: [
                    { branchId: u.branchId ?? "__none__" },
                    {
                      role: {
                        key: {
                          in: Object.entries(ROLE_ACCESS)
                            .filter(([, access]) => access === "ALL")
                            .map(([role]) => role),
                        },
                      },
                    },
                  ],
                }),
          },
          select: { id: true, name: true, branchId: true, role: { select: { key: true, name: true } } },
          orderBy: { name: "asc" },
        })
      : [],
    prisma.serviceCase.findMany({
      where: { AND: [serviceCaseScope(u), { closedAt: null,status:{notIn:["COMPLETED","CANCELLED"]} }] },
      select: {
        id: true,
        caseNo: true,
        title: true,
        customerId: true,
        branchId: true,
        closedAt: true,
        status: true,
        serviceWork: {
          select: {
            id: true,
            service: true,
            title: true,
            templateVersion: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
  ]);
  if (params.get("case") && !cases.some((c) => c.id === params.get("case"))) {
    const c = await prisma.serviceCase.findFirst({
      where: { AND: [serviceCaseScope(u), { id: params.get("case")! }] },
      select: {
        id: true,
        caseNo: true,
        title: true,
        customerId: true,
        branchId: true,
        closedAt: true,
        status: true,
        serviceWork: {
          select: {
            id: true,
            service: true,
            title: true,
            templateVersion: true,
          },
        },
      },
    });
    if (c) cases.push(c);
  }
  return {
    rows: rows.map(serializeTask),
    total,
    page,
    pageSize: size,
    stats: { unassigned, overdue, review, critical, waiting, doneToday },
    people: people.map((p) => ({
      id: p.id,
      name: p.name,
      roleName: p.role.name,
      branchId: p.branchId,
      allBranches: ROLE_ACCESS[p.role.key as RoleKey] === "ALL",
      services: [
        ...((ROLE_PERMISSIONS[p.role.key as RoleKey] ?? []).includes(
          "visa:view",
        )
          ? ["VISA"]
          : []),
        ...((ROLE_PERMISSIONS[p.role.key as RoleKey] ?? []).includes(
          "ticketing:view",
        )
          ? ["FLIGHT", "HOTEL"]
          : []),
      ],
      canWork: (ROLE_PERMISSIONS[p.role.key as RoleKey] ?? []).includes(
        "task:edit",
      ),
      canReview: (ROLE_PERMISSIONS[p.role.key as RoleKey] ?? []).includes(
        "work:review",
      ),
    })),
    caseClosed: isClosedCase(cases.find((c) => c.id === params.get("case"))),
    cases: cases
      .map((c) => ({
        ...c,
        serviceWork: c.serviceWork.filter((w) => canReadService(u, w.service)),
      }))
      .filter((c) => !isClosedCase(c) && c.serviceWork.length > 0),
    services: ["VISA", "FLIGHT", "HOTEL"].filter((s) => canReadService(u, s)),
    permissions: {
      finance: u.permissions.includes("payment:view"),
      configure: u.permissions.includes("settings:manage"),
      assign: canAssignWork(u),
      review: u.permissions.includes("work:review"),
      create: u.permissions.includes("task:create"),
      edit: u.permissions.includes("task:edit"),
      team: u.permissions.includes("work:team"),
      report: u.permissions.includes("work:report"),
      export: u.permissions.includes("export:data"),
    },
    userId: u.id,
    branchId: u.branchId,
    scope: params.get("case")
      ? "This trip"
      : !u.permissions.includes("work:team")
        ? "Your assigned work"
        : u.accessMode === "ALL"
          ? "Agency"
          : u.accessMode === "BRANCH"
            ? "Your branch"
            : "Your assigned work",
    checkedAt: now.toISOString(),
  };
}
export type WorkData = Awaited<ReturnType<typeof readWork>>;
export async function workDetail(u: SessionUser, id: string) {
  const t = await prisma.task.findFirst({
    where: { AND: [taskScope(u), { id }] },
    include: rowInclude,
  });
  if (!t) throw new ApiError(404, "Work not found.");
  const [events, bookings, visas, config] = await Promise.all([
    prisma.workEvent.findMany({
      where: { taskId: id },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      take: 100,
    }),
    t.serviceCaseId && u.permissions.includes("ticketing:view")
      ? prisma.booking.findMany({
          where: {
            AND: [
              { serviceCaseId: t.serviceCaseId },
              scopeWhere(u, null, "ownerId"),
            ],
          },
          select: { id: true, bookingNo: true, status: true, product: true },
        })
      : [],
    t.serviceCaseId && u.permissions.includes("visa:view")
      ? prisma.visaCase.findMany({
          where: {
            AND: [
              { serviceCaseId: t.serviceCaseId },
              scopeWhere(u, null, "ownerId"),
            ],
          },
          select: {
            id: true,
            caseNo: true,
            submissionDate: true,
            visaOutcome: true,
          },
        })
      : [],
    prisma.settings.findUnique({ where: { key: "work.configuration" } }),
  ]);
  return {
    task: serializeTask(t),
    events: events.map((e) => ({
      ...e,
      at: e.at.toISOString(),
      dueAt: e.dueAt?.toISOString() ?? null,
      originalDueAt: e.originalDueAt?.toISOString() ?? null,
    })),
    sources: {
      bookings: bookings.filter(
        (b) =>
          !t.serviceWork ||
          t.serviceWork.service ===
            (b.product === "HOTEL" ? "HOTEL" : "FLIGHT"),
      ),
      visas: visas.map((v) => ({
        ...v,
        submissionDate: v.submissionDate?.toISOString() ?? null,
      })),
    },
    config: readWorkConfig(config?.value),
  };
}
export type WorkDetail = Awaited<ReturnType<typeof workDetail>>;
export async function templatePreview(
  u: SessionUser,
  caseId: string,
  service: string,
) {
  const c = await caseFor(prisma, u, caseId);
  if (!canAssignWork(u) || !canReadService(u, service))
    throw new ApiError(403, "Service planning is outside your role.");
  const config = readWorkConfig(
    (await prisma.settings.findUnique({ where: { key: "work.configuration" } }))
      ?.value,
  );
  const t = config.templates.find((t) => t.service === service);
  if (!t) throw new ApiError(400, "Choose a supported service.");
  const existing = await prisma.task.findMany({
    where: { serviceCaseId: c.id, serviceWork: { service } },
    select: { sourceKey: true },
  });
  return {
    version: config.version,
    service,
    caseId: c.id,
    steps: await Promise.all(
      t.steps.map(async (s) => {
        const warnings: string[] = [];
        let defaultOwnerId =
            s.defaultOwnerId === "CASE_COORDINATOR"
              ? c.ownerId
              : s.defaultOwnerId,
          defaultReviewerId =
            s.defaultReviewerId === "CASE_COORDINATOR"
              ? c.ownerId
              : s.defaultReviewerId;
        if (defaultOwnerId)
          try {
            await eligiblePerson(
              prisma,
              u,
              defaultOwnerId,
              c.branchId,
              service,
              false,
              s.resultType,
            );
          } catch {
            defaultOwnerId = null;
            warnings.push(
              "The default assignee is unavailable for this case; choose a colleague.",
            );
          }
        if (defaultReviewerId)
          try {
            await eligiblePerson(
              prisma,
              u,
              defaultReviewerId,
              c.branchId,
              service,
              true,
              s.resultType,
            );
          } catch {
            defaultReviewerId = null;
            warnings.push(
              "The default reviewer is unavailable for this case; choose a reviewer.",
            );
          }
        if (defaultOwnerId && defaultOwnerId === defaultReviewerId) {
          defaultReviewerId = null;
          warnings.push("Choose a reviewer different from this assignee.");
        }
        return {
          ...s,
          defaultOwnerId,
          defaultReviewerId,
          defaultDueAt: s.dueAfterHours
            ? new Date(Date.now() + s.dueAfterHours * 3600000).toISOString()
            : null,
          warnings,
          alreadyExists: existing.some((e) =>
            e.sourceKey?.endsWith(":" + s.key),
          ),
        };
      }),
    ),
  };
}
