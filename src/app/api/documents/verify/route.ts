import { requireSession, jsonError, ApiError, canTouchRecord } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";

export async function POST(req: Request) {
  try {
    const user = await requireSession("document:verify");
    const body = await req.json();
    const { documentId, decision, reason, notes } = body;
    if (!documentId || !["ACCEPTED", "REJECTED", "UNDER_REVIEW"].includes(decision)) {
      throw new ApiError(400, "documentId and decision (ACCEPTED|REJECTED|UNDER_REVIEW) required");
    }
    const doc = await prisma.document.findUnique({ where: { id: documentId }, include: { customer: true } });
    if (!doc) throw new ApiError(404, "Document not found");
    if (!canTouchRecord(user, doc.customer)) throw new ApiError(403, "Document is outside your access.");
    if (!doc.storagePath) throw new ApiError(400, "A document must be uploaded before review.");
    if (["ARCHIVED", "SUBMITTED"].includes(doc.status)) throw new ApiError(400, "This document is archived or already submitted.");

    const updated = await prisma.document.update({
      where: { id: documentId },
      data: {
        status: decision,
        verificationStatus: decision === "ACCEPTED" ? "VERIFIED" : decision === "REJECTED" ? "REJECTED" : "PENDING",
        verifiedById: decision === "UNDER_REVIEW" ? null : user.id,
        verifiedAt: decision === "UNDER_REVIEW" ? null : new Date(),
        rejectionReason: decision === "REJECTED" ? reason ?? "Not specified" : null,
        notes: notes ?? doc.notes,
      },
    });
    await prisma.documentAccessLog.create({ data: { documentId, userId: user.id, action: "EDIT", detail: `verify:${decision}` } });
    await audit(user, "VERIFY", "Document", documentId, decision);
    return Response.json({ ok: true, document: updated });
  } catch (e) {
    return jsonError(e);
  }
}
