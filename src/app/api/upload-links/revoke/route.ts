import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { customerFor,relatedFor, optionalId, transactionAudit } from "@/lib/transactions";

/** Revoke a customer upload link so a shared URL stops working immediately. */
export async function POST(req: Request) {
  try {
    const user = await requireSession(["customer:edit", "visa:edit", "document:upload"]);
    const b = await req.json();
    const linkId = optionalId(b.linkId);
    if (!linkId) throw new ApiError(400, "Select an upload link.");
    const link = await prisma.$transaction(async (tx) => {
      const existing = await tx.uploadLink.findUnique({ where: { id: linkId } });
      if (!existing) throw new ApiError(404, "Upload link not found.");
      if(existing.visaCaseId){if(!user.permissions.includes("visa:view"))throw new ApiError(403,"Visa access is required for this upload link.");await relatedFor(tx,user,existing.customerId,null,existing.visaCaseId);}else await customerFor(tx, user, existing.customerId);
      const revoked = await tx.uploadLink.update({ where: { id: linkId }, data: { revoked: true } });
      await transactionAudit(tx, user, "REVOKE", "UploadLink", revoked.id, "Customer upload link revoked");
      return revoked;
    });
    return Response.json({ ok: true, linkId: link.id });
  } catch (e) {
    return jsonError(e);
  }
}
