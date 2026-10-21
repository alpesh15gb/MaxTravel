import { jsonError } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { publishedMedia, mediaResponse } from "@/lib/package-media-service";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(_req: Request, context: { params: Promise<{ mediaId: string }> }) {
  try { return await mediaResponse(await publishedMedia(prisma, (await context.params).mediaId)); }
  catch (e) { const response = jsonError(e); response.headers.set("Cache-Control", "no-store"); return response; }
}
