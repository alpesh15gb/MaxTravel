import type { Prisma } from "@prisma/client";
import type { SessionUser } from "./session";
import { prisma } from "./db";
import { ApiError } from "./guard";
import { agencyDay, stateOf } from "./work-config";
import { taskScope, readableWorkType } from "./work-engine";

export async function workReport(u: SessionUser, q: URLSearchParams) {
  const day = agencyDay(),
    start = q.get("from") ?? day.start.toISOString(),
    end = q.get("to") ?? day.end.toISOString(),
    from = new Date(start),
    to = new Date(end);
  if (
    !Number.isFinite(from.getTime()) ||
    !Number.isFinite(to.getTime()) ||
    from >= to ||
    to.getTime() - from.getTime() > 366 * 86400000
  )
    throw new ApiError(
      400,
      "Choose a valid reporting period of up to 366 days. The end time is exclusive.",
    );
  const scope: Prisma.TaskWhereInput = {
    AND: [
      taskScope(u),
      ...(u.permissions.includes("work:report")
        ? []
        : [{ ownerId: u.id, unassigned: false }]),
      ...(q.get("service")
        ? [{ serviceWork: { service: q.get("service")! } }]
        : []),
    ],
  };
  const owner = q.get("owner") ?? "";
  if (owner && !u.permissions.includes("work:report") && owner !== u.id)
    throw new ApiError(403, "You can report on your own work only.");
  const [tasks, events] = await Promise.all([
    prisma.task.findMany({
      where: scope,
      include: {
        owner: { select: { name: true, active: true } },
        serviceCase: { select: { caseNo: true } },
        serviceWork: { select: { service: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.workEvent.findMany({
      where: {
        ...(u.permissions.includes("work:report")
          ? { task: scope }
          : {
              assigneeId: u.id,
              task: {
                AND: [
                  readableWorkType(u),
                  ...(q.get("service")
                    ? [{ serviceWork: { service: q.get("service")! } }]
                    : []),
                ],
              },
            }),
        at: { gte: from, lt: to },
        ...(owner ? { assigneeId: owner } : {}),
      },
      include: {
        task: {
          select: {
            id: true,
            title: true,
            serviceCase: { select: { caseNo: true } },
            serviceWork: { select: { service: true } },
          },
        },
      },
      orderBy: [{ at: "desc" }, { id: "desc" }],
    }),
  ]);
  for (const task of tasks)
    if (["OPEN", "IN_PROGRESS"].includes(task.status) && !task.owner.active)
      task.unassigned = true;
  const current = tasks.filter(
      (t) => !owner || (!t.unassigned && t.ownerId === owner),
    ),
    open = current.filter((t) => !["DONE", "CANCELLED"].includes(stateOf(t))),
    completed = events.filter(
      (e) => ["COMPLETE", "APPROVE"].includes(e.kind) && e.toState === "DONE",
    ),
    due = current.filter((t) => t.dueAt && t.dueAt >= from && t.dueAt < to),
    now = new Date();
  const people = new Map<
    string,
    {
      id: string;
      name: string;
      open: number;
      overdue: number;
      waiting: number;
      review: number;
      completions: number;
      onTime: number;
      timedCompletions: number;
      returns: number;
    }
  >();
  const person = (id: string, name: string) => {
    if (!people.has(id))
      people.set(id, {
        id,
        name,
        open: 0,
        overdue: 0,
        waiting: 0,
        review: 0,
        completions: 0,
        onTime: 0,
        timedCompletions: 0,
        returns: 0,
      });
    return people.get(id)!;
  };
  for (const t of open) {
    const p = person(
      t.unassigned ? "unassigned" : t.ownerId,
      t.unassigned ? "Unassigned" : t.owner.name,
    );
    p.open++;
    if (t.dueAt && t.dueAt < now) p.overdue++;
    if (stateOf(t) === "WAITING") p.waiting++;
    if (stateOf(t) === "REVIEW") p.review++;
  }
  for (const e of events) {
    if (!e.assigneeId) continue;
    const p = person(e.assigneeId, e.assigneeName ?? "Former colleague");
    if (e.kind === "RETURN") p.returns++;
    if (["COMPLETE", "APPROVE"].includes(e.kind) && e.toState === "DONE") {
      p.completions++;
      if (e.originalDueAt) {
        p.timedCompletions++;
        if (e.at <= e.originalDueAt) p.onTime++;
      }
    }
  }
  const cohort = Object.fromEntries(
    ["TODO", "IN_PROGRESS", "WAITING", "REVIEW", "DONE", "CANCELLED"].map(
      (state) => [state, due.filter((t) => stateOf(t) === state).length],
    ),
  );
  const visibleTaskIds = new Set(tasks.map((t) => t.id));
  return {
    ownerFilter: owner,
    serviceFilter: q.get("service") ?? "",
    canTeam: u.permissions.includes("work:report"),
    services: ["VISA", "FLIGHT", "HOTEL"].filter((s) =>
      u.permissions.includes(s === "VISA" ? "visa:view" : "ticketing:view"),
    ),
    ownerOptions: [
      ...new Map(
        tasks.map((t) => [t.ownerId, { id: t.ownerId, name: t.owner.name }]),
      ).values(),
    ].sort((a, b) => a.name.localeCompare(b.name)),
    scope: u.permissions.includes("work:report")
      ? u.accessMode === "ALL"
        ? "Agency"
        : "Your branch"
      : "Your work",
    from: from.toISOString(),
    to: to.toISOString(),
    checkedAt: now.toISOString(),
    basis:
      "Service filters follow the current task service. Current backlog at refresh time; completion events during the selected period; due-date cohort uses current deadlines. Timeliness uses each completion's original deadline. Reopened tasks may have multiple completion events.",
    summary: {
      open: open.length,
      unassigned: open.filter((t) => t.unassigned).length,
      overdue: open.filter((t) => t.dueAt && t.dueAt < now).length,
      completedEvents: completed.length,
      distinctCompletedTasks: new Set(completed.map((e) => e.taskId)).size,
      legacyOpen: open.filter((t) => !t.workflowTracked).length,
      due: due.length,
    },
    cohort,
    people: [...people.values()].sort(
      (a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name),
    ),
    events: events.map((e) => ({
      id: e.id,
      taskId: e.taskId,
      canOpen: visibleTaskIds.has(e.taskId),
      title: e.taskTitle || e.task.title,
      caseNo: e.caseNo ?? "Internal / legacy",
      service: e.task.serviceWork?.service ?? "General",
      kind: e.kind,
      at: e.at.toISOString(),
      actor: e.actorName,
      assignee: e.assigneeName ?? "Unassigned",
      dueAt: e.dueAt?.toISOString() ?? null,
      originalDueAt: e.originalDueAt?.toISOString() ?? null,
      detail: e.detail,
    })),
    backlog: open.map((t) => ({
      id: t.id,
      title: t.title,
      caseNo: t.serviceCase?.caseNo ?? "Internal / legacy",
      assignee: t.unassigned ? "Unassigned" : t.owner.name,
      state: stateOf(t),
      dueAt: t.dueAt?.toISOString() ?? null,
      waitingReason: t.waitingReason,
      nextCheckAt: t.nextCheckAt?.toISOString() ?? null,
    })),
    coverage: {
      tracked: current.filter((t) => t.workflowTracked).length,
      legacy: current.filter((t) => !t.workflowTracked).length,
    },
    canExport: u.permissions.includes("export:data"),
  };
}
export type WorkReport = Awaited<ReturnType<typeof workReport>>;
