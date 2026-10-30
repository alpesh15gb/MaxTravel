import { prisma } from "@/lib/db";
import { requirePage, scopeWhere } from "@/lib/guard";
import { can } from "@/lib/rbac";
import TasksClient from "./TasksClient";

export const dynamic = "force-dynamic";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ focus?: string; action?: string }> }) {
  const user = await requirePage("task:view");
  const { focus, action } = await searchParams;

  const where = scopeWhere(user, null, "ownerId", "creatorId");

  const include = { owner: { select: { name: true } }, customer: { select: { name: true, id: true } }, visaCase: { select: { caseNo: true, id: true } }, booking: { select: { bookingNo: true, id: true } } } as const;
  // Closed history must never crowd actionable work out of the bounded queue.
  const [openTasks, closedTasks, focusedTask] = await Promise.all([
    prisma.task.findMany({ where: { ...where, status: { in: ["OPEN", "IN_PROGRESS"] } }, include, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], take: 200 }),
    prisma.task.findMany({ where: { ...where, status: { in: ["DONE", "CANCELLED"] } }, include, orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }], take: 100 }),
    focus ? prisma.task.findFirst({ where: { AND: [where, { id: focus }] }, include }) : Promise.resolve(null),
  ]);
  const tasks = [...openTasks, ...closedTasks];
  if (focusedTask && !tasks.some(task => task.id === focusedTask.id)) tasks.push(focusedTask);

  const [owners, customers] = await Promise.all([
    prisma.user.findMany({ where: { active: true, ...(user.accessMode === "ASSIGNED" ? { id: user.id } : user.accessMode === "BRANCH" ? user.branchId ? { branchId: user.branchId } : { id: "__none__" } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.customer.findMany({ where: scopeWhere(user, null, undefined, "assignedToId"), select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <TasksClient
      initialCreate={action==="new"&&can(user.permissions,"task:create")}
      canAudit={user.permissions.includes("audit:view")}
      owners={owners} customers={customers} currentUserId={user.id} canCreate={can(user.permissions, "task:create")}
      canExport={can(user.permissions, "export:data")}
      tasks={tasks.map((t) => ({
        id: t.id, title: t.title, status: t.status, priority: t.priority, details: t.details,
        owner: t.owner.name, ownerId: t.ownerId, mine: t.ownerId === user.id,
        dueAt: t.dueAt?.toISOString() ?? null,
        customer: t.customer ? { name: t.customer.name, id: t.customer.id } : null,
        visaCase: t.visaCase ? { caseNo: t.visaCase.caseNo, id: t.visaCase.id } : null,
        booking: t.booking ? { bookingNo: t.booking.bookingNo, id: t.booking.id } : null,
      }))}
      focus={focus ?? null}
      canEdit={can(user.permissions, "task:edit")}
    />
  );
}
