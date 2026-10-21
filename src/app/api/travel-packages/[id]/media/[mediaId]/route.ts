import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { assertPackageManager } from "@/lib/travel-package-service";
import { mediaResponse } from "@/lib/package-media-service";
import { PACKAGE_MEDIA_ID } from "@/lib/package-media-path";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(_req: Request, context: { params: Promise<{ id: string; mediaId: string }> }) {
  try {
    assertPackageManager(await requireSession("settings:manage"));
    const { id, mediaId } = await context.params;
    if (!PACKAGE_MEDIA_ID.test(mediaId)) throw new ApiError(404, "Image not found.");
    const asset = await prisma.packageMedia.findFirst({ where: { id: mediaId, packageId: id } });
    if (!asset) throw new ApiError(404, "Image not found.");
    return await mediaResponse(asset);
  } catch (e) { return jsonError(e); }
}
