import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, jsonError } from "@/lib/guard";
import { boundedJson } from "@/lib/bounded-json";
import { changeWork, changeWorkSchema, workMutation } from "@/lib/work-engine";
import { workDetail } from "@/lib/work-read";
export const dynamic = "force-dynamic";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return Response.json(
      await workDetail(await requireSession("task:view"), (await params).id),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const u = await requireSession("task:edit"),
      id = (await params).id,
      b = changeWorkSchema.parse(await boundedJson(req));
    const result = await prisma.$transaction((tx) =>
      workMutation(tx, u, b.requestKey, { id, ...b }, () =>
        changeWork(tx, u, id, b),
      ),
    );
    return Response.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: e.issues[0]?.message ?? "Check the work action." },
        { status: 400 },
      );
    return jsonError(e);
  }
}
