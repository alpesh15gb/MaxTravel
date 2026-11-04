import { jsonError, requireSession } from "@/lib/guard";
import { CASE_READ } from "@/lib/service-cases";
import { readTrip } from "@/lib/trips-read";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession([...CASE_READ]), { id } = await params;
    return Response.json(await readTrip(user, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) { return jsonError(e); }
}
