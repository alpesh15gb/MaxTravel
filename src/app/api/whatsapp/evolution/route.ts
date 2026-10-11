import { evolutionConfig, bearerMatches } from "@/lib/evolution";
import { handleEvolutionEvent } from "@/lib/evolution-webhook";
export async function POST(req: Request) {
  if (!bearerMatches(req, process.env.WA_WEBHOOK_SECRET)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const config = evolutionConfig();
  if (!config) return Response.json({ error: "Evolution is not configured." }, { status: 503 });
  try {
    // Bound streamed requests too, rather than trusting Content-Length.
    const reader = req.body?.getReader();
    if (!reader) return Response.json({ error: "Missing body." }, { status: 400 });
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) { const part = await reader.read(); if (part.done) break; length += part.value.byteLength;
      if (length > 262144) { await reader.cancel(); return Response.json({ error: "Webhook too large." }, { status: 413 }); } chunks.push(part.value); }
    const b = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (b.instance !== config.instance) return Response.json({ error: "Instance does not match." }, { status: 403 });
    const event = String(b.event ?? "").replace(/_/g,".").toLowerCase();
    if (!["messages.upsert", "messages.update"].includes(event)) return Response.json({ ok: true, ignored: true });
    return Response.json({ ok: true, ...await handleEvolutionEvent(event, b.data) });
  } catch {
    // No payloads or API keys in error logs. A 500 lets Evolution retry transient DB failures.
    return Response.json({ error: "Webhook could not be processed." }, { status: 500 });
  }
}
