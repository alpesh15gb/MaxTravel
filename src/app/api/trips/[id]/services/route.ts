import { z } from "zod";
import { prisma } from "@/lib/db";
import { jsonError, requireSession } from "@/lib/guard";
import { boundedJson } from "@/lib/bounded-json";
import { CASE_READ } from "@/lib/service-cases";
import { addTripService } from "@/lib/trip-services";

const input = z.object({ service: z.enum(["VISA", "QUOTE"]) }).strict();
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession([...CASE_READ]), { id } = await params;
    const { service } = input.parse(await boundedJson(req));
    return Response.json(await addTripService(prisma, user, id, service), { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ error: "Choose a service to add." }, { status: 400 });
    return jsonError(e);
  }
}
