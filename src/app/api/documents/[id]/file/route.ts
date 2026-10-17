import { requireSession, jsonError, ApiError, canTouchRecord } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { SignJWT } from "jose";

/** Fail closed: without a real secret anyone could mint file URLs for any stored path. */
function fileSecret(): Uint8Array {
  const raw = process.env.JWT_SECRET;
  if (!raw) throw new Error("JWT_SECRET is not configured; document links are disabled.");
  return new TextEncoder().encode(raw);
}

/** Issue a 60-second signed URL for a document and log the access. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession("document:view");
    const { id } = await ctx.params;
    const doc = await prisma.document.findUnique({ where: { id }, include: { customer: true } });
    if (!doc) throw new ApiError(404, "Document not found");
    if (!canTouchRecord(user, doc.customer)) throw new ApiError(403, "Document is outside your access.");
    if (!user.permissions.includes("sensitive:view") && (doc.sensitive || /passport|bank|salary|tax/i.test(doc.docType))) throw new ApiError(403, "Sensitive document access is restricted.");
    if (!doc.storagePath) throw new ApiError(404, "No file stored for this document");

    const token = await new SignJWT({ p: doc.storagePath })
      .setProtectedHeader({ alg: "HS256" })
      .setAudience("document-file")
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(fileSecret());

    await prisma.documentAccessLog.create({
      data: { documentId: id, userId: user.id, action: "SIGN_URL_ISSUED", ip: req.headers.get("x-forwarded-for") ?? undefined },
    });
    await audit(user, "SIGN_URL", "Document", id);

    return Response.json({ url: `/api/documents/stream?t=${token}`, expiresIn: 60 });
  } catch (e) {
    return jsonError(e);
  }
}
