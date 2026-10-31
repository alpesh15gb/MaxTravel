import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, jsonError } from "@/lib/guard";
import { boundedJson } from "@/lib/bounded-json";
import {
  applyWorkTemplate,
  applyTemplateSchema,
  workMutation,
} from "@/lib/work-engine";
import { templatePreview } from "@/lib/work-read";
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    return Response.json(
      await templatePreview(
        await requireSession("work:assign"),
        q.get("case") ?? "",
        q.get("service") ?? "",
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return jsonError(e);
  }
}
export async function POST(req: Request) {
  try {
    const u = await requireSession("work:assign"),
      b = applyTemplateSchema.parse(await boundedJson(req));
    const result = await prisma.$transaction(
      (tx) =>
        workMutation(tx, u, b.requestKey, b, () => applyWorkTemplate(tx, u, b)),
      { timeout: 20000 },
    );
    return Response.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: e.issues[0]?.message ?? "Check the service plan." },
        { status: 400 },
      );
    return jsonError(e);
  }
}
