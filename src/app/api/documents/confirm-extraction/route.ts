import { requireSession, jsonError, ApiError, assertCan, canTouchRecord } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";

/**
 * An employee explicitly confirms (optionally correcting) extracted values.
 * Only after this call may values be written to the traveller record.
 */
export async function POST(req: Request) {
  try {
    const user = await requireSession("document:verify");
    assertCan(user, "traveller:edit");
    assertCan(user, "sensitive:view");
    const body = await req.json();
    const { documentId, confirmed } = body;
    if (!documentId || typeof confirmed !== "object") {
      throw new ApiError(400, "documentId and confirmed object required");
    }
    const doc = await prisma.document.findUnique({ where: { id: documentId }, include: { traveller: true, customer: true } });
    if (!doc) throw new ApiError(404, "Document not found");
    if (!canTouchRecord(user, doc.customer)) throw new ApiError(403, "Document is outside your access.");
    if (!doc.extracted || Object.keys(JSON.parse(doc.extracted)).length === 0) throw new ApiError(400, "No extraction is available. Enter verified passport details manually in the traveller profile.");

    // Write confirmed values onto the traveller (critical fields only via this path)
    if (doc.travellerId && doc.traveller) {
      const t = confirmed;
      await prisma.traveller.update({
        where: { id: doc.travellerId },
        data: {
          fullName: t.fullName ?? doc.traveller.fullName,
          passportNumber: t.passportNumber ?? doc.traveller.passportNumber,
          dateOfBirth: t.dateOfBirth ? new Date(t.dateOfBirth) : doc.traveller.dateOfBirth,
          nationality: t.nationality ?? doc.traveller.nationality,
          gender: t.gender ?? doc.traveller.gender,
          passportIssueDate: t.issueDate ? new Date(t.issueDate) : doc.traveller.passportIssueDate,
          passportExpiry: t.expiryDate ? new Date(t.expiryDate) : doc.traveller.passportExpiry,
          passportPlace: t.placeOfIssue ?? doc.traveller.passportPlace,
        },
      });
    }

    await prisma.document.update({
      where: { id: documentId },
      data: { extractedConfirmedById: user.id, extractedConfirmedAt: new Date() },
    });
    await prisma.documentAccessLog.create({ data: { documentId, userId: user.id, action: "EDIT", detail: "extraction confirmed" } });
    await audit(user, "CONFIRM_EXTRACTION", "Document", documentId);
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
