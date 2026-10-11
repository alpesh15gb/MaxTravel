import { requireSession, jsonError } from "@/lib/guard";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const user = await requireSession();
    const notifications = await prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" }, take: 30,
    });
    return Response.json({ notifications });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST() {
  try {
    const user = await requireSession();
    await prisma.notification.updateMany({ where: { userId: user.id, read: false }, data: { read: true } });
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
