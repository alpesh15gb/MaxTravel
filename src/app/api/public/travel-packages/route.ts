import { packageSummary } from "@/lib/travel-packages";
import { prisma } from "@/lib/db";
import { publishedPackage } from "@/lib/travel-package-service";
import { jsonError } from "@/lib/guard";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const rows = await prisma.travelPackage.findMany({ where: { status: "PUBLISHED", publishedJson: { not: null } }, select: { id: true, slug: true, status: true, publishedJson: true, publishedAt: true }, orderBy: { publishedAt: "desc" }, take: 251 });
    let unavailableCount = 0;
    const packages = rows.slice(0, 250).flatMap(row => {
      try { const item = publishedPackage(row); return item ? [packageSummary(item)] : []; }
      catch { unavailableCount++; console.error("Invalid published travel-package snapshot", row.id); return []; }
    });
    return Response.json({ packages, truncated: rows.length > 250, unavailableCount }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return jsonError(e); }
}
