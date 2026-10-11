import { requireSession, jsonError } from "@/lib/guard";
import { evolutionConfig, evolutionState } from "@/lib/evolution";
export async function GET() {
  try {
    await requireSession("whatsapp:view");
    const config = evolutionConfig();
    if (!config) return Response.json({ configured: false, state: "manual" });
    try { return Response.json({ configured: true, instance: config.instance, state: await evolutionState() }); }
    catch { return Response.json({ configured: true, instance: config.instance, state: "unreachable" }); }
  } catch(e) { return jsonError(e); }
}
