import { jsonError, requireSession } from "@/lib/guard";
import { CASE_READ } from "@/lib/service-cases";
import { readTrips } from "@/lib/trips-read";
import { TRIP_STAGES, type TripStage } from "@/lib/trip-stage";

const STAGES = new Set<string>([...TRIP_STAGES, "CANCELLED", "ACTIVE"]);
export async function GET(req: Request) {
  try {
    const user = await requireSession([...CASE_READ]), sp = new URL(req.url).searchParams, stage = sp.get("stage") ?? "";
    const data = await readTrips(user, {
      stage: STAGES.has(stage) ? (stage as TripStage | "ACTIVE") : undefined,
      search: sp.get("q")?.slice(0, 120) || undefined,
      mine: sp.get("mine") === "1",
      customerId: sp.get("customer") || undefined,
      page: Number(sp.get("page")) || 1,
    });
    return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return jsonError(e); }
}
