import { requireSession, ApiError } from "@/lib/guard";
import { boundedJson } from "@/lib/bounded-json";
import { prisma } from "@/lib/db";
import { assertPackageManager, savePackage, staffPackage } from "@/lib/travel-package-service";
import { salesRecoveryContext } from "@/lib/sales-recovery-context";
import { PACKAGE_NO_STORE, packageRecoveryError, packageWriteBody } from "@/lib/package-recovery-access";
export const dynamic = "force-dynamic";
export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
  try { const user = await requireSession("settings:manage"); assertPackageManager(user); const body = packageWriteBody(user, await boundedJson(req, 250000)); return Response.json({ package: await savePackage(prisma, user, body, (await context.params).id), recoveryContext: salesRecoveryContext(user) }, { headers: PACKAGE_NO_STORE }); }
  catch (e) { return packageRecoveryError(e); }
}

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession("settings:manage"); assertPackageManager(user);
    const row = await prisma.travelPackage.findUnique({ where: { id: (await context.params).id } });
    if (!row) throw new ApiError(404, "Package not found.");
    return Response.json({ package: staffPackage(row), recoveryContext: salesRecoveryContext(user) }, { headers: PACKAGE_NO_STORE });
  } catch (e) { return packageRecoveryError(e); }
}
