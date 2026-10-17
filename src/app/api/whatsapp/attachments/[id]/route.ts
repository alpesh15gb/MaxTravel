import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { customerFor, transactionAudit } from "@/lib/transactions";
import { readPdf } from "@/lib/whatsapp-pdf";
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession(["whatsapp:view","ticketing:view"]);
    const { id } = await context.params;
    const attachment = await prisma.whatsAppAttachment.findUnique({ where: { id } });
    if (!attachment) throw new ApiError(404, "PDF not found.");
    await customerFor(prisma, user, attachment.customerId);
    const bytes = await readPdf(attachment);
    await transactionAudit(prisma, user, "VIEW", "WhatsAppAttachment", id, "Private WhatsApp PDF downloaded");
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${attachment.filename}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" } });
  } catch (error) { return jsonError(error); }
}
