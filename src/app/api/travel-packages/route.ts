import { requireSession, ApiError } from "@/lib/guard";
import { boundedJson } from "@/lib/bounded-json";
import { prisma } from "@/lib/db";
import { assertPackageManager, savePackage, staffPackage } from "@/lib/travel-package-service";
import { salesRecoveryContext } from "@/lib/sales-recovery-context";
import { PACKAGE_NO_STORE, packageRecoveryError, packageWriteBody } from "@/lib/package-recovery-access";
import { slugSchema } from "@/lib/travel-packages";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const user = await requireSession("settings:manage"); assertPackageManager(user);
    const recoveryContext = salesRecoveryContext(user);
    const params = new URL(req.url).searchParams;
    if (params.has("draftSlug")) {
      const slug = slugSchema.safeParse(params.get("draftSlug"));
      if (!slug.success) throw new ApiError(400, "Choose a valid package slug.");
      const row = await prisma.travelPackage.findUnique({ where: { slug: slug.data } });
      return Response.json({ package: row ? staffPackage(row) : null, recoveryContext }, { headers: PACKAGE_NO_STORE });
    }
    const rows = await prisma.travelPackage.findMany({ orderBy: { updatedAt: "desc" }, take: 251 });
    return Response.json({ packages: rows.slice(0, 250).map(row => { const { draft, ...meta } = staffPackage(row); return { ...meta, destination: draft.destination, durationDays: draft.durationDays }; }), truncated: rows.length > 250, recoveryContext }, { headers: PACKAGE_NO_STORE });
  } catch (e) { return packageRecoveryError(e); }
}
export async function POST(req: Request) {
  try { const user = await requireSession("settings:manage"); assertPackageManager(user); const body = packageWriteBody(user, await boundedJson(req, 250000)); return Response.json({ package: await savePackage(prisma, user, body), recoveryContext: salesRecoveryContext(user) }, { status: 201, headers: PACKAGE_NO_STORE }); }
  catch (e) { return packageRecoveryError(e); }
}
