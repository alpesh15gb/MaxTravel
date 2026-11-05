import { z } from "zod";
import { prisma } from "@/lib/db";
import { jsonError, requireSession } from "@/lib/guard";
import { boundedJson } from "@/lib/bounded-json";
import { reuseDocument } from "@/lib/document-reuse";

const input = z.object({ requirementId: z.string().min(1).max(200), sourceId: z.string().min(1).max(200) }).strict();
export async function POST(req: Request) {
  try {
    const user = await requireSession("document:upload");
    const body = input.parse(await boundedJson(req));
    const row = await reuseDocument(prisma, user, body);
    return Response.json({ ok: true, status: row.status });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ error: "Choose the requirement and the file to reuse." }, { status: 400 });
    return jsonError(e);
  }
}
