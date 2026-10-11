import { requireSession, jsonError } from "@/lib/guard";
import { computePulse } from "@/lib/pulse";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireSession("dashboard:view");
    const resp = await computePulse(prisma, user);
    return Response.json(resp);
  } catch (e) {
    return jsonError(e);
  }
}
