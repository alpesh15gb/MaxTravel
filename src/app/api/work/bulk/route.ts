import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession, jsonError } from "@/lib/guard";
import { boundedJson } from "@/lib/bounded-json";
import { changeWork, workMutation } from "@/lib/work-engine";
const schema = z
  .object({
    items: z
      .array(
        z.object({
          id: z.string(),
          version: z.number().int().positive(),
          requestKey: z.string().uuid(),
        }),
      )
      .min(1)
      .max(30),
    ownerId: z.string().nullable(),
    dueAt: z.string().datetime().nullable(),
    note: z.string().trim().min(3).max(1000),
  })
  .strict();
export async function POST(req: Request) {
  try {
    const u = await requireSession("work:assign"),
      b = schema.parse(await boundedJson(req)),
      results = [];
    for (const item of b.items) {
      try {
        const input = {
          ...item,
          ownerId: b.ownerId,
          dueAt: b.dueAt,
          note: b.note,
          action: "ASSIGN" as const,
        };
        await prisma.$transaction((tx) =>
          workMutation(tx, u, item.requestKey, input, () =>
            changeWork(tx, u, item.id, input),
          ),
        );
        results.push({ id: item.id, ok: true });
      } catch (e) {
        results.push({
          id: item.id,
          ok: false,
          error: e instanceof Error ? e.message : "Assignment failed.",
        });
      }
    }
    return Response.json({ results });
  } catch (e) {
    if (e instanceof z.ZodError)
      return Response.json(
        { error: "Select up to 30 work items, an owner, deadline and reason." },
        { status: 400 },
      );
    return jsonError(e);
  }
}
