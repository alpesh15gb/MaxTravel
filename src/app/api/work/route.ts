import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, jsonError } from "@/lib/guard";
import { boundedJson } from "@/lib/bounded-json";
import { createWork, createWorkSchema, workMutation } from "@/lib/work-engine";
import { readWork } from "@/lib/work-read";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    return Response.json(
      await readWork(
        await requireSession("task:view"),
        new URL(req.url).searchParams,
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
export async function POST(req: Request) {
  try {
    const u = await requireSession("task:create"),
      b = createWorkSchema.parse(await boundedJson(req));
    const result = await prisma.$transaction((tx) =>
      workMutation(tx, u, b.requestKey, b, () => createWork(tx, u, b)),
    );
    return Response.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: e.issues[0]?.message ?? "Check the work details." },
        { status: 400 },
      );
    return jsonError(e);
  }
}
