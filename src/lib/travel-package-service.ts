import { packageMediaId } from "./package-media-path";
import type { PrismaClient, TravelPackage } from "@prisma/client";
import { ApiError } from "./guard";
import { accessModeFor } from "./rbac";
import type { SessionUser } from "./session";
import { transactionAudit } from "./transactions";
import { publicPackage, slugSchema, validatePackage, type PackageDraft } from "./travel-packages";

export function assertPackageManager(user: SessionUser) {
  if (!user.permissions.includes("settings:manage") || (user.accessMode ?? accessModeFor(user.role)) !== "ALL") {
    throw new ApiError(403, "Only agency-wide settings managers can manage the public package catalogue.");
  }
}
export function staffPackage(row: TravelPackage) {
  return { id: row.id, slug: row.slug, title: row.title, status: row.status, revision: row.revision,
    publishedAt: row.publishedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString(),
    draft: JSON.parse(row.draftJson) as PackageDraft, hasUnpublishedChanges: row.publishedJson !== null && JSON.stringify(publicFields(JSON.parse(row.draftJson))) !== row.publishedJson };
}
function publicFields(draft: PackageDraft) { const { internalNotes: _private, ...fields } = draft; void _private; return fields; }
export async function savePackage(db: PrismaClient, user: SessionUser, body: Record<string, unknown>, id?: string) {
  assertPackageManager(user);
  const action = body.action ?? "SAVE";
  if (!["SAVE", "PUBLISH", "UNPUBLISH", "ARCHIVE", "RESTORE"].includes(String(action))) throw new ApiError(400, "Choose a valid package action.");
  if (!id && action !== "SAVE") throw new ApiError(400, "Save a draft before publishing.");
  if (id && (!Number.isInteger(body.revision) || Number(body.revision) < 1)) throw new ApiError(400, "A current revision is required.");
  try {
    return await db.$transaction(async tx => {
      const row = id ? await tx.travelPackage.findUnique({ where: { id } }) : null;
      if (id && !row) throw new ApiError(404, "Package not found.");
      if (row && row.revision !== body.revision) throw new ApiError(409, "This package changed in another window. Reload it before saving; your edits have not been applied.");
      let data: Record<string, unknown> = {};
      if (action === "SAVE" || action === "PUBLISH") {
        if (row?.status === "ARCHIVED") throw new ApiError(409, "Restore the archived package before editing.");
        const slug = slugSchema.safeParse(body.slug);
        if (!slug.success) throw new ApiError(400, "Slug: use 3–100 lowercase letters or numbers separated by hyphens.");
        if (row?.publishedAt && row.slug !== slug.data) throw new ApiError(409, "The public URL is locked after first publication. Create a new package for a different URL.");
        const checked = validatePackage(body.draft, action === "PUBLISH");
        if (!checked.data) throw new ApiError(400, checked.errors.join("\n"));
        const assetIds = [...new Set([checked.data.coverImageUrl, ...checked.data.gallery.map(image => image.url)].map(packageMediaId).filter((asset): asset is string => !!asset))];
        if (assetIds.length && (!row || await tx.packageMedia.count({ where: { id: { in: assetIds }, packageId: row.id } }) !== assetIds.length)) throw new ApiError(400, "Use only images uploaded to this package.");
        data = { slug: slug.data, title: checked.data.title, draftJson: JSON.stringify(checked.data) };
        if (action === "PUBLISH") Object.assign(data, { status: "PUBLISHED", publishedJson: JSON.stringify(publicFields(checked.data)), publishedAt: new Date() });
      } else if (action === "UNPUBLISH" || action === "ARCHIVE") {
        data = { status: action === "ARCHIVE" ? "ARCHIVED" : "DRAFT", publishedJson: null };
      } else if (action === "RESTORE") {
        if (row?.status !== "ARCHIVED") throw new ApiError(409, "Only archived packages can be restored.");
        data = { status: "DRAFT", publishedJson: null };
      }
      let saved: TravelPackage;
      if (row) {
        const result = await tx.travelPackage.updateMany({ where: { id: row.id, revision: Number(body.revision) }, data: { ...data, revision: { increment: 1 } } });
        if (result.count !== 1) throw new ApiError(409, "This package changed. Reload before saving.");
        saved = (await tx.travelPackage.findUnique({ where: { id: row.id } }))!;
      } else {
        saved = await tx.travelPackage.create({ data: data as { slug: string; title: string; draftJson: string } });
      }
      await transactionAudit(tx, user, String(action), "TravelPackage", saved.id, `${saved.title} · revision ${saved.revision}`);
      return staffPackage(saved);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new ApiError(409, "That public URL is already in use. Choose a different slug.");
    throw error;
  }
}
export function publishedPackage(row: Pick<TravelPackage, "id" | "slug" | "publishedAt" | "publishedJson" | "status">) {
  if (row.status !== "PUBLISHED" || !row.publishedJson || !row.publishedAt) return null;
  return publicPackage(JSON.parse(row.publishedJson), { id: row.id, slug: row.slug, publishedAt: row.publishedAt });
}
