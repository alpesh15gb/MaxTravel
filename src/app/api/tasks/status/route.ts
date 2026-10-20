import { requireSession, jsonError, ApiError, canTouchRecord } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { transactionAudit } from "@/lib/transactions";
import { TASK_STATUSES, taskCompletedAt } from "@/lib/task-status";

export async function POST(req: Request) {
  try {
    const user = await requireSession("task:edit");
    const { taskId, status } = await req.json();
    if (typeof taskId !== "string" || !taskId || !TASK_STATUSES.includes(status)) {
      throw new ApiError(400, "taskId and valid status required");
    }
    const task = await prisma.$transaction(async tx => {
      const existing = await tx.task.findUnique({ where: { id: taskId } });
      if (!existing) throw new ApiError(404, "Task not found.");
      if (!canTouchRecord(user, existing)) throw new ApiError(403, "Task is outside your access.");
      if (existing.status === status) return existing;
      const updated = await tx.task.update({
        where: { id: taskId },
        data: { status, completedAt: taskCompletedAt(existing, status) },
      });
      await transactionAudit(tx, user, "STATUS", "Task", taskId, `${existing.status} → ${status}`);
      return updated;
    });
    return Response.json({ ok: true, task });
  } catch (e) {
    return jsonError(e);
  }
}
