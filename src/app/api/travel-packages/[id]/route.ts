import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { boundedJson } from "@/lib/bounded-json";
import { prisma } from "@/lib/db";
import { assertPackageManager, savePackage, staffPackage } from "@/lib/travel-package-service";
export const dynamic = "force-dynamic";
export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  try { const user = await requireSession("settings:manage"); assertPackageManager(user); return Response.json({ package: await savePackage(prisma, user, await boundedJson(req, 250000), (await context.params).id) }); }
  catch (e) { return jsonError(e); }
}

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertPackageManager(await requireSession("settings:manage"));
    const row = await prisma.travelPackage.findUnique({ where: { id: (await context.params).id } });
    if (!row) throw new ApiError(404, "Package not found.");
    return Response.json({ package: staffPackage(row) });
  } catch (e) { return jsonError(e); }
}
