import type { PrismaClient } from "@prisma/client";
import { ApiError } from "./guard";
import { canTouchDocument } from "./record-access";
import type { SessionUser } from "./session";

export type OnFileDocument = { id: string; docNo: string; docType: string; travellerId: string | null; verificationStatus: string; status: string; expiryDate: string | null; hasFile: boolean };

/** The best file already held for this traveller that can satisfy a visa requirement. */
export function findOnFile(req: { id: string; docType: string; travellerId: string | null }, files: OnFileDocument[], today: string): OnFileDocument | null {
  const type = req.docType.trim().toLowerCase();
  const usable = files.filter(f => f.id !== req.id && f.hasFile && req.travellerId && f.travellerId === req.travellerId && f.docType.trim().toLowerCase() === type && !["REJECTED", "ARCHIVED", "REUPLOAD_REQUESTED"].includes(f.status) && !(f.expiryDate && f.expiryDate.slice(0, 10) < today));
  return usable.find(f => f.verificationStatus === "VERIFIED") ?? usable[0] ?? null;
}

/** Points a visa requirement at a file already on the record; the file is not copied. A verified file stays verified. */
export async function reuseDocument(db: PrismaClient, user: SessionUser, input: { requirementId: string; sourceId: string }) {
  if (!user.permissions.includes("document:upload")) throw new ApiError(403, "Document upload is not permitted.");
  return db.$transaction(async tx => {
    const [req, source] = await Promise.all([
      tx.document.findUnique({ where: { id: input.requirementId }, include: { customer: true } }),
      tx.document.findUnique({ where: { id: input.sourceId } }),
    ]);
    if (!req || !source || source.customerId !== req.customerId || source.travellerId !== req.travellerId || !source.storagePath) throw new ApiError(404, "That file is not available for this traveller.");
    if (!canTouchDocument(user, req)) throw new ApiError(403, "Document is outside your access.");
    if (req.storagePath) throw new ApiError(409, "This requirement already has a file.");
    const verified = source.verificationStatus === "VERIFIED";
    const updated = await tx.document.update({
      where: { id: req.id },
      data: {
        storagePath: source.storagePath, fileName: source.fileName, mimeType: source.mimeType, sizeBytes: source.sizeBytes,
        expiryDate: source.expiryDate, sensitive: source.sensitive, aadhaarMasked: source.aadhaarMasked,
        uploadedById: user.id, uploadSource: "STAFF", uploadedAt: new Date(),
        status: verified ? "ACCEPTED" : "RECEIVED", verificationStatus: verified ? "VERIFIED" : "PENDING",
        verifiedById: verified ? source.verifiedById : null, verifiedAt: verified ? source.verifiedAt : null,
        notes: `Reused from ${source.docNo}`,
      },
    });
    await tx.documentAccessLog.create({ data: { documentId: req.id, userId: user.id, action: "EDIT", detail: `reuse:${source.docNo}` } });
    await tx.auditLog.create({ data: { userId: user.id, action: "REUSE", entity: "Document", entityId: req.id, detail: `Reused ${source.docNo}` } });
    return updated;
  });
}
