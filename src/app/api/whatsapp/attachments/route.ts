import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { customerFor, transactionAudit } from "@/lib/transactions";
import { prisma } from "@/lib/db";
import { cloudConfig } from "@/lib/meta-cloud";
import { boundedPdf, pdfFilename, savePdf, removePdf } from "@/lib/whatsapp-pdf";
export async function POST(req: Request) {
  try {
    const user = await requireSession("whatsapp:send");
    if (!cloudConfig()) throw new ApiError(400, "Configure Meta Cloud API before attaching PDFs.");
    const customerId = new URL(req.url).searchParams.get("customerId") || "";
    await customerFor(prisma, user, customerId);
    const recent = await prisma.whatsAppAttachment.count({ where: { createdBy: user.id, createdAt: { gt: new Date(Date.now()-3600000) } } });
    if (recent >= 30) throw new ApiError(429, "PDF upload limit reached. Try again later.");
    const bytes = await boundedPdf(req);
    let rawName: string; try { rawName = decodeURIComponent(req.headers.get("x-pdf-filename") || "travel-document.pdf"); } catch { throw new ApiError(400, "Invalid filename."); }
    const stored = await savePdf(bytes);
    try {
      const row = await prisma.$transaction(async tx => {
        await customerFor(tx, user, customerId);
        const attachment = await tx.whatsAppAttachment.create({ data: { ...stored, customerId, filename: pdfFilename(rawName), createdBy: user.id } });
        await transactionAudit(tx, user, "UPLOAD", "WhatsAppAttachment", attachment.id, "Private customer PDF prepared for WhatsApp; not sent");
        return attachment;
      });
      return Response.json({ id: row.id, filename: row.filename, size: row.size, url: `/api/whatsapp/attachments/${row.id}` }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) { await removePdf(stored.storageKey); throw error; }
  } catch (error) { return jsonError(error); }
}
