import { requireSession, jsonError, ApiError, canTouchRecord } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { optionalId, date, transactionAudit } from "@/lib/transactions";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession("task:edit");
    const { id } = await ctx.params;
    const b = await req.json();
    await prisma.$transaction(async tx => {
      const current = await tx.task.findUnique({ where: { id } });
      if (!current) throw new ApiError(404, "Task not found.");
      if (!canTouchRecord(user, current)) throw new ApiError(403, "Task is outside your access.");
      if (["DONE", "CANCELLED"].includes(current.status)) throw new ApiError(400, "Reopen the task before editing it.");
      const title = String(b.title ?? current.title).trim();
      if (!title || title.length > 200) throw new ApiError(400, "Use a task title under 200 characters.");
      const priority = String(b.priority ?? current.priority);
      if (!["LOW", "MEDIUM", "HIGH", "URGENT"].includes(priority)) throw new ApiError(400, "Choose a valid priority.");
      const ownerId = optionalId(b.ownerId) ?? current.ownerId;
      if (ownerId !== current.ownerId) {
        const owner = await tx.user.findUnique({ where: { id: ownerId } });
        if (!owner?.active || (user.accessMode === "ASSIGNED" && ownerId !== user.id) || (user.accessMode === "BRANCH" && (!user.branchId || owner.branchId !== user.branchId))) throw new ApiError(403, "Choose an active task owner within your access.");
      }
      await tx.task.update({ where: { id }, data: { title, priority, ownerId, details: b.details === undefined ? current.details : optionalId(b.details), dueAt: b.dueAt === undefined ? current.dueAt : date(b.dueAt, "Due date") } });
      await transactionAudit(tx, user, "EDIT", "Task", id, title);
    });
    return Response.json({ ok: true });
  } catch (e) { return jsonError(e); }
}
