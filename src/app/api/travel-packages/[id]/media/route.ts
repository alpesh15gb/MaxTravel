import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { assertPackageManager } from "@/lib/travel-package-service";
import { staffMedia, uploadPackageMedia } from "@/lib/package-media-service";
import { boundedMediaForm } from "@/lib/package-media-storage";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, context: Context) {
  try {
    assertPackageManager(await requireSession("settings:manage"));
    const { id } = await context.params;
    if (!await prisma.travelPackage.findUnique({ where: { id }, select: { id: true } })) throw new ApiError(404, "Package not found.");
    return Response.json({ images: (await prisma.packageMedia.findMany({ where: { packageId: id }, orderBy: { createdAt: "desc" }, take: 24 })).map(staffMedia) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return jsonError(e); }
}
export async function POST(req: Request, context: Context) {
  try {
    const user = await requireSession("settings:manage"); assertPackageManager(user);
    const form = await boundedMediaForm(req), file = form.get("file");
    if (!(file instanceof File) || form.getAll("file").length !== 1 || [...form.keys()].some(key => key !== "file")) throw new ApiError(400, "Choose exactly one image.");
    return Response.json({ image: await uploadPackageMedia(prisma, user, (await context.params).id, Buffer.from(await file.arrayBuffer()), file.type) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) { return jsonError(e); }
}
