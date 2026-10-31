import { requireSession, jsonError } from "@/lib/guard";
import { messagingConfig,messagingState,isCloud } from "@/lib/whatsapp-provider";
import { prisma } from "@/lib/db";
import { metaInboundHealthKey, readMetaInboundHealth } from "@/lib/meta-inbound";
export async function GET() {
  try {
    const user = await requireSession("whatsapp:view");
    const config = messagingConfig();
    if (!config) return Response.json({ configured: false, state: "manual" });
    const inbound = isCloud() && "phoneId" in config && user.permissions.includes("settings:manage")
      ? readMetaInboundHealth((await prisma.settings.findUnique({ where: { key: metaInboundHealthKey(config.phoneId) } }))?.value)
      : null;
    try { return Response.json({ provider:isCloud()?"meta":"evolution",configured: true, instance: config.instance, state: await messagingState(), inbound }); }
    catch { return Response.json({ provider:isCloud()?"meta":"evolution",configured: true, instance: config.instance, state: "unreachable", inbound }); }
  } catch(e) { return jsonError(e); }
}
