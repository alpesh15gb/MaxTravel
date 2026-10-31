import { requireSession, jsonError } from "@/lib/guard";
import { computePulse } from "@/lib/pulse";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/guard";
import { findSection } from "@/lib/workspace-sections";
import { overviewFor, sectionPermissions } from "@/lib/workspace-overview";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("section");
    const section = id ? findSection(id) : undefined;
    if (id && !section) throw new ApiError(400,"Choose a valid workspace section.");
    const user = await requireSession(section ? sectionPermissions(section.id) : "dashboard:view");
    const resp = await computePulse(prisma, user);
    return Response.json(section ? overviewFor(resp,section.id,user) : resp,{headers:{"Cache-Control":"private, no-store"}});
  } catch (e) {
    return jsonError(e);
  }
}
