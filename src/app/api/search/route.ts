import { requireSession, jsonError } from "@/lib/guard";
import { universalSearch } from "@/lib/search";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireSession("search:use");
    const q = new URL(req.url).searchParams.get("q") ?? "";
    const resp = await universalSearch(prisma, q, user);
    return Response.json(resp);
  } catch (e) {
    return jsonError(e);
  }
}
