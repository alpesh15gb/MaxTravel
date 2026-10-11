import { requireSession, jsonError } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { QUICK_REPLY_DEFAULTS } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSession("whatsapp:view");
    const stored = await prisma.quickReply.findMany({ orderBy: { title: "asc" } });
    const byKey = new Map(stored.map((t) => [t.key, { key: t.key, title: t.title, body: t.body }]));
    // Built-in copy is always offered; a stored row with the same key overrides it.
    for (const d of QUICK_REPLY_DEFAULTS) if (!byKey.has(d.key)) byKey.set(d.key, d);
    const templates = Array.from(byKey.values()).sort((a, b) => a.title.localeCompare(b.title));
    return Response.json({ templates });
  } catch (e) {
    return jsonError(e);
  }
}
