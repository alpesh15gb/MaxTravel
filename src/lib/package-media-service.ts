import { randomUUID } from "node:crypto";
import type { PrismaClient, PackageMedia } from "@prisma/client";
import { packageContentSchema } from "./travel-packages";
import { ApiError } from "./guard";
import type { SessionUser } from "./session";
import { assertPackageManager } from "./travel-package-service";
import { transactionAudit } from "./transactions";
import { packageMediaUrl, PACKAGE_MEDIA_ID } from "./package-media-path";
import { MAX_PACKAGE_MEDIA, MAX_PACKAGE_MEDIA_BYTES, normalizePackageImage, writePackageImage, removeFailedPackageImage, readPackageImage } from "./package-media-storage";
export function staffMedia(asset: PackageMedia) {
  return { id: asset.id, url: packageMediaUrl(asset.id), previewUrl: `/api/travel-packages/${asset.packageId}/media/${asset.id}`, width: asset.width, height: asset.height, byteSize: asset.byteSize, createdAt: asset.createdAt.toISOString() };
}
export async function uploadPackageMedia(db: PrismaClient, user: SessionUser, packageId: string, bytes: Buffer, mime: string) {
  assertPackageManager(user);
  const owner = await db.travelPackage.findUnique({ where: { id: packageId } });
  if (!owner) throw new ApiError(404, "Package not found.");
  if (owner.status === "ARCHIVED") throw new ApiError(409, "Restore this package before uploading images.");
  const image = await normalizePackageImage(bytes, mime), id = randomUUID();
  await writePackageImage(id, image.bytes);
  try {
    const asset = await db.$transaction(async tx => {
      // Acquire SQLite's write lock before calculating quotas; concurrent uploads cannot both pass an old count.
      const locked = await tx.travelPackage.updateMany({ where: { id: packageId, status: { not: "ARCHIVED" } }, data: { updatedAt: new Date() } });
      if (locked.count !== 1) throw new ApiError(409, "Package is no longer available for image uploads.");
      const used = await tx.packageMedia.aggregate({ where: { packageId }, _count: true, _sum: { byteSize: true } });
      if (used._count >= MAX_PACKAGE_MEDIA || (used._sum.byteSize ?? 0) + image.bytes.length > MAX_PACKAGE_MEDIA_BYTES) throw new ApiError(409, "This package has reached its image storage limit (24 images / 48 MiB). Existing images remain available.");
      const saved = await tx.packageMedia.create({ data: { id, packageId, storageName: `${id}.webp`, mimeType: "image/webp", byteSize: image.bytes.length, width: image.width, height: image.height, sha256: image.sha256 } });
      await transactionAudit(tx, user, "UPLOAD_MEDIA", "TravelPackage", packageId, `Package image ${id} (${image.width}×${image.height})`);
      return saved;
    });
    return staffMedia(asset);
  } catch (error) { await removeFailedPackageImage(id); throw error; }
}
export async function publishedMedia(db: PrismaClient, id: string) {
  if (!PACKAGE_MEDIA_ID.test(id)) throw new ApiError(404, "Image not found.");
  const asset = await db.packageMedia.findUnique({ where: { id }, include: { package: { select: { status: true, publishedJson: true } } } });
  if (!asset || asset.package.status !== "PUBLISHED" || !asset.package.publishedJson) throw new ApiError(404, "Image not found.");
  let referenced = false;
  try {
    const snapshot = packageContentSchema.parse(JSON.parse(asset.package.publishedJson)), url = packageMediaUrl(id);
    referenced = snapshot.coverImageUrl === url || (Array.isArray(snapshot.gallery) && snapshot.gallery.some((image: { url?: unknown }) => image?.url === url));
  } catch { /* Invalid snapshots never grant public access. */ }
  if (!referenced) throw new ApiError(404, "Image not found.");
  return asset;
}
export async function mediaResponse(asset: PackageMedia) {
  let bytes: Buffer;
  try { bytes = await readPackageImage(asset); }
  catch { throw new ApiError(404, "Image not found."); }
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/webp", "Content-Length": String(bytes.length), "Content-Disposition": `inline; filename="package-${asset.id}.webp"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" } });
}
