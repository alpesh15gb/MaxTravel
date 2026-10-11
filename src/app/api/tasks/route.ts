import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { customerFor, relatedFor, optionalId, date, transactionAudit } from "@/lib/transactions";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await requireSession("task:create");
    const b = await req.json();
    const title: string = b.title?.trim();
    if (!title) throw new ApiError(400, "title required");
    if (title.length > 200 || !["LOW", "MEDIUM", "HIGH", "URGENT"].includes(b.priority ?? "MEDIUM")) throw new ApiError(400, "Use a title under 200 characters and a valid priority.");
    const task = await prisma.$transaction(async tx => {
      const ownerId = optionalId(b.ownerId) ?? user.id;
      const owner = await tx.user.findUnique({ where: { id: ownerId } });
      if (!owner?.active || (user.accessMode === "ASSIGNED" && ownerId !== user.id) || (user.accessMode === "BRANCH" && owner.branchId !== user.branchId)) throw new ApiError(403, "Select an active task owner within your access.");
      let customerId = optionalId(b.customerId);
      const bookingId = optionalId(b.bookingId), visaCaseId = optionalId(b.visaCaseId);
      if (!customerId && bookingId) customerId = (await tx.booking.findUnique({ where: { id: bookingId } }))?.customerId ?? null;
      if (!customerId && visaCaseId) customerId = (await tx.visaCase.findUnique({ where: { id: visaCaseId } }))?.customerId ?? null;
      if ((bookingId || visaCaseId) && !customerId) throw new ApiError(404, "Related work not found.");
      const customer = customerId ? await customerFor(tx, user, customerId) : null;
      if (customerId) await relatedFor(tx, user, customerId, bookingId, visaCaseId);
      const record = await tx.task.create({ data: { title, details: optionalId(b.details), priority: b.priority ?? "MEDIUM", dueAt: date(b.dueAt, "Due date"), ownerId, creatorId: user.id, customerId, bookingId, visaCaseId, branchId: customer?.branchId ?? owner.branchId } });
      await transactionAudit(tx, user, "CREATE", "Task", record.id, title);
      return record;
    });
    return Response.json({ ok: true, task });
  } catch (e) {
    return jsonError(e);
  }
}

export async function GET(req: Request) {
  try {
    const user = await requireSession("task:view");
    const sp = new URL(req.url).searchParams;
    const where: Record<string, unknown> = {};
    if (user.accessMode === "BRANCH") where.branchId = user.branchId;
    if (user.accessMode === "ASSIGNED") where.OR = [{ ownerId: user.id }, { creatorId: user.id }];
    if (sp.get("status")) where.status = sp.get("status");
    const tasks = await prisma.task.findMany({
      where, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      include: { owner: { select: { name: true } }, customer: { select: { name: true, code: true } } },
      take: 200,
    });
    return Response.json({ tasks });
  } catch (e) {
    return jsonError(e);
  }
}
