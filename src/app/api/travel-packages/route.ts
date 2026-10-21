import { requireSession, jsonError } from "@/lib/guard";
import { boundedJson } from "@/lib/bounded-json";
import { prisma } from "@/lib/db";
import { assertPackageManager, savePackage, staffPackage } from "@/lib/travel-package-service";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    assertPackageManager(await requireSession("settings:manage"));
    const rows = await prisma.travelPackage.findMany({ orderBy: { updatedAt: "desc" }, take: 251 });
    return Response.json({ packages: rows.slice(0, 250).map(row => { const { draft, ...meta } = staffPackage(row); return { ...meta, destination: draft.destination, durationDays: draft.durationDays }; }), truncated: rows.length > 250 });
  } catch (e) { return jsonError(e); }
}
export async function POST(req: Request) {
  try { const user = await requireSession("settings:manage"); assertPackageManager(user); return Response.json({ package: await savePackage(prisma, user, await boundedJson(req, 250000)) }, { status: 201 }); }
  catch (e) { return jsonError(e); }
}
