import { requireSession, jsonError, ApiError, canTouchRecord } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";

export async function POST(req: Request) {
  try {
    const user = await requireSession("ticketing:edit");
    const { bookingId, hours } = await req.json();
    if (!bookingId || !hours) throw new ApiError(400, "bookingId and hours required");
    const b = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!b) throw new ApiError(404, "Booking not found");
    if (!canTouchRecord(user, b)) throw new ApiError(403, "Booking is outside your access.");
    if (!Number.isFinite(Number(hours)) || Number(hours) <= 0 || Number(hours) > 720) throw new ApiError(400, "Extension must be 1–720 hours.");
    const newDeadline = new Date(Math.max(Date.now(), b.ticketingDeadline?.getTime() ?? Date.now()) + Number(hours) * 3600000);
    await prisma.booking.update({ where: { id: bookingId }, data: { ticketingDeadline: newDeadline } });
    await audit(user, "EXTEND_DEADLINE", "Booking", bookingId, `+${hours}h → ${newDeadline.toISOString()}`);
    return Response.json({ ok: true, ticketingDeadline: newDeadline });
  } catch (e) {
    return jsonError(e);
  }
}
