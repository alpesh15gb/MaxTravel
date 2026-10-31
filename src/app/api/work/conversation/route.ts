import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  requireSession,
  jsonError,
  ApiError,
  canTouchRecord,
} from "@/lib/guard";
import { caseFor } from "@/lib/service-cases";
import { boundedJson } from "@/lib/bounded-json";
const pick = {
  id: true,
  body: true,
  direction: true,
  at: true,
  status: true,
} as const;
export async function GET(req: Request) {
  try {
    const u = await requireSession("whatsapp:view"),
      q = new URL(req.url).searchParams,
      c = await caseFor(prisma, u, q.get("case") ?? ""),
      customer = await prisma.customer.findUniqueOrThrow({
        where: { id: c.customerId },
      });
    const [links, available] = await Promise.all([
      prisma.caseMessage.findMany({
        where: { caseId: c.id },
        include: { message: { select: pick } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      canTouchRecord(u, customer)
        ? prisma.whatsAppMessage.findMany({
            where: {
              thread: { customerId: customer.id },
              ...(q.get("q")
                ? { body: { contains: q.get("q")!.slice(0, 120) } }
                : {}),
            },
            select: pick,
            orderBy: { at: "desc" },
            take: 30,
          })
        : [],
    ]);
    return Response.json(
      {
        links: links.map((l) => ({
          ...l.message,
          at: l.message.at.toISOString(),
        })),
        available: available.map((m) => ({ ...m, at: m.at.toISOString() })),
        canLink:
          canTouchRecord(u, customer) && u.permissions.includes("task:edit"),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
export async function POST(req: Request) {
  try {
    const u = await requireSession("whatsapp:view");
    if (!u.permissions.includes("task:edit"))
      throw new ApiError(403, "Your role cannot link communications.");
    const b = z
      .object({ caseId: z.string().max(200), messageId: z.string().max(200) })
      .strict()
      .parse(await boundedJson(req));
    await prisma.$transaction(async (tx) => {
      const c = await caseFor(tx, u, b.caseId),
        customer = await tx.customer.findUniqueOrThrow({
          where: { id: c.customerId },
        });
      if (!canTouchRecord(u, customer))
        throw new ApiError(
          403,
          "Customer conversation access is required to link another message.",
        );
      const message = await tx.whatsAppMessage.findFirst({
        where: { id: b.messageId, thread: { customerId: c.customerId } },
      });
      if (!message)
        throw new ApiError(
          404,
          "Message does not belong to this case's customer.",
        );
      const existing = await tx.caseMessage.findUnique({
        where: { caseId_messageId: b },
      });
      if (existing) return;
      await tx.caseMessage.create({ data: { ...b, linkedById: u.id } });
      await tx.serviceCaseEvent.create({
        data: {
          caseId: c.id,
          actorId: u.id,
          kind: "COMMUNICATION",
          summary: "Customer message explicitly linked to this case",
          permission: "whatsapp:view",
        },
      });
    });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: "Choose a case and customer message." },
        { status: 400 },
      );
    return jsonError(e);
  }
}
