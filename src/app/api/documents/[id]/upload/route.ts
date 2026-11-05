import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, jsonError, requireSession } from "@/lib/guard";
import { canTouchDocument } from "@/lib/record-access";
import { masterMultipart, uploadMasterDocument } from "@/lib/master-upload";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession("document:upload");
    const { id } = await ctx.params;
    const document = await prisma.document.findUnique({ where: { id }, include: { customer: true } });
    if (!document || !canTouchDocument(user, document)) throw new ApiError(404, "Document is outside your access.");
    const result = await uploadMasterDocument(prisma, user, document.customerId, await masterMultipart(req), id);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: error.issues.map(i => i.message).slice(0, 3).join(" ") }, { status: 400 });
    return jsonError(error);
  }
}
