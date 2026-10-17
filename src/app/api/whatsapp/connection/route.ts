import { requireSession, jsonError } from "@/lib/guard";
import { messagingConfig,messagingState,isCloud } from "@/lib/whatsapp-provider";
export async function GET() {
  try {
    await requireSession("whatsapp:view");
    const config = messagingConfig();
    if (!config) return Response.json({ configured: false, state: "manual" });
    try { return Response.json({ provider:isCloud()?"meta":"evolution",configured: true, instance: config.instance, state: await messagingState() }); }
    catch { return Response.json({ provider:isCloud()?"meta":"evolution",configured: true, instance: config.instance, state: "unreachable" }); }
  } catch(e) { return jsonError(e); }
}
