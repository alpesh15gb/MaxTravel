import { prisma } from "@/lib/db";
import { requireSession, ApiError, jsonError } from "@/lib/guard";
import { customerFor, transactionAudit } from "@/lib/transactions";
import { RULES } from "@/lib/whatsapp-queue";
import { attachInbound } from "@/lib/evolution-webhook";
export async function POST(req: Request) {
  try {
    const user = await requireSession("whatsapp:send");
    const b = await req.json();
    await prisma.$transaction(async tx => {
      if (b.customerId) {
        const customer = await customerFor(tx, user, String(b.customerId));
        if (typeof b.optIn !== "boolean") throw new ApiError(400,"Choose whether automatic messages are allowed.");
        await tx.customer.update({ where: { id: customer.id }, data: { whatsappOptIn: b.optIn } });
        if (!b.optIn) await tx.whatsAppMessage.updateMany({ where: { thread: { customerId: customer.id }, status: "QUEUED", automation: { not: null } }, data: { status: "CANCELLED", lastError: "Automatic messaging consent withdrawn." } });
        await transactionAudit(tx, user, "CONSENT", "Customer", customer.id, b.optIn ? "WhatsApp automatic messaging consent recorded by staff" : "WhatsApp automatic messaging consent withdrawn");
      } else if (b.inboundId && b.matchCustomerId) {
        if (!user.permissions.includes("settings:manage")) throw new ApiError(403,"Administrator access required.");
        await customerFor(tx, user, String(b.matchCustomerId));
        await attachInbound(tx,String(b.inboundId),String(b.matchCustomerId));
        await transactionAudit(tx,user,"MATCH","WhatsAppInbound",String(b.inboundId),`Matched to customer ${b.matchCustomerId}`);
      } else {
        if (!user.permissions.includes("settings:manage")) throw new ApiError(403,"Administrator access required.");
        if (!Array.isArray(b.rules) || b.rules.some((r: unknown)=>!RULES.includes(r as typeof RULES[number]))) throw new ApiError(400,"Choose valid automation rules.");
        await tx.settings.upsert({ where: { key: "whatsapp.automation" }, create: { key: "whatsapp.automation", value: JSON.stringify(b.rules) }, update: { value: JSON.stringify(b.rules) } });
        await tx.whatsAppMessage.updateMany({ where: { status: "QUEUED", automation: { in: RULES.filter(r=>!b.rules.includes(r)) } }, data: { status: "CANCELLED", lastError: "Automatic messaging rule disabled." } });
        await transactionAudit(tx,user,"UPDATE","WhatsAppAutomation","rules",JSON.stringify(b.rules));
      }
    });
    return Response.json({ ok: true });
  } catch(e) { return jsonError(e); }
}
