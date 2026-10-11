import { requireSession, jsonError, ApiError, canTouchRecord } from "@/lib/guard";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const user = await requireSession("task:edit");
    const { taskId, status } = await req.json();
    if (!taskId || !["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"].includes(status)) {
      throw new ApiError(400, "taskId and valid status required");
    }
    const existing = await prisma.task.findUnique({ where: { id: taskId } });
    if (!existing) throw new ApiError(404, "Task not found.");
    if (!canTouchRecord(user, existing)) throw new ApiError(403, "Task is outside your access.");
    const task = await prisma.task.update({
      where: { id: taskId },
      data: { status, completedAt: status === "DONE" ? new Date() : null },
    });
    return Response.json({ ok: true, task });
  } catch (e) {
    return jsonError(e);
  }
}
