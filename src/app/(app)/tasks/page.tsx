import { prisma } from "@/lib/db";
import { requirePage, scopeWhere } from "@/lib/guard";
import { can } from "@/lib/rbac";
import TasksClient from "./TasksClient";

export const dynamic = "force-dynamic";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const user = await requirePage("task:view");
  const { focus } = await searchParams;

  const where: Record<string, unknown> = {};
  if (user.accessMode === "BRANCH") where.branchId = user.branchId;
  if (user.accessMode === "ASSIGNED") where.OR = [{ ownerId: user.id }, { creatorId: user.id }];

  const tasks = await prisma.task.findMany({
    where,
    include: { owner: { select: { name: true } }, customer: { select: { name: true, id: true } }, visaCase: { select: { caseNo: true, id: true } }, booking: { select: { bookingNo: true, id: true } } },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  const [owners, customers] = await Promise.all([
    prisma.user.findMany({ where: { active: true, ...(user.accessMode === "ASSIGNED" ? { id: user.id } : user.accessMode === "BRANCH" ? { branchId: user.branchId } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.customer.findMany({ where: scopeWhere(user, null, undefined, "assignedToId"), select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <TasksClient
      owners={owners} customers={customers} currentUserId={user.id} canCreate={can(user.permissions, "task:create")}
      canExport={can(user.permissions, "export:data")}
      tasks={tasks.map((t) => ({
        id: t.id, title: t.title, status: t.status, priority: t.priority, details: t.details,
        owner: t.owner.name, mine: t.ownerId === user.id,
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
