import { prisma } from "@/lib/db";
import { publishedPackage } from "@/lib/travel-package-service";
import { jsonError } from "@/lib/guard";
import { slugSchema } from "@/lib/travel-packages";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const slug = slugSchema.safeParse((await context.params).slug);
    const row = slug.success ? await prisma.travelPackage.findFirst({ where: { slug: slug.data, status: "PUBLISHED" }, select: { id: true, slug: true, status: true, publishedJson: true, publishedAt: true } }) : null;
    const item = row && publishedPackage(row);
    return item ? Response.json({ package: item }, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Package not found." }, { status: 404 });
  } catch (e) { return jsonError(e); }
}
