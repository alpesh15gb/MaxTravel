import { requireSession, jsonError } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { transactionAudit } from "@/lib/transactions";
import { privatePdfFor } from "@/lib/private-pdf-access";
import { readPdf, pdfFilename } from "@/lib/private-pdf";
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession("document:view");
    const { id } = await context.params;
    const attachment = await privatePdfFor(prisma,user,id);
    const bytes = await readPdf(attachment);
    await transactionAudit(prisma, user, "VIEW", "PrivatePdfAttachment", id, "Private customer PDF downloaded");
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${pdfFilename(attachment.filename)}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" } });
  } catch (error) { return jsonError(error); }
}
