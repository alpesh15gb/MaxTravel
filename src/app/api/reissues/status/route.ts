import { requireSession, jsonError, ApiError, canTouchRecord } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { transactionAudit } from "@/lib/transactions";
import { isWithdrawnBooking } from "@/lib/receivables";

export async function POST(req: Request) {
  try {
    const user = await requireSession("reissue:manage");
    const { reissueId, status } = await req.json();
    const reissue = await prisma.$transaction(async tx => {
      const r = await tx.reissue.findUnique({
        where: { id: String(reissueId ?? "") },
        include: { originalBooking: true, originalTicket: true, reissuedBooking: { include: { tickets: true, travellers: true, payments: true } } },
      });
      if (!r) throw new ApiError(404, "Reissue not found.");
      if (r.originalBooking.gdsSource === "TRIPJACK_API") throw new ApiError(409, "Online booking changes must be handled by the booking platform.");
      if (!canTouchRecord(user, r.originalBooking)) throw new ApiError(403, "Reissue is outside your access.");
      // A retry after a lost response must not duplicate audit history or rewrite booking states.
      if (r.status === status) return { id: r.id, status: r.status };
      if (!["REQUESTED", "IN_PROGRESS"].includes(r.status) || !["IN_PROGRESS", "DONE", "REJECTED"].includes(status)) throw new ApiError(400, "Reissue is already closed or the transition is invalid.");
      const replacement = r.reissuedBooking;
      if (status !== "REJECTED" && (isWithdrawnBooking(r.originalBooking.status) || !replacement || isWithdrawnBooking(replacement.status))) {
        throw new ApiError(409, "A linked booking is closed. This reissue cannot proceed or reopen it; review cancellation/refunds and reject the request instead.");
      }
      if (status === "DONE") {
        if (r.originalTicket.status !== "OK") throw new ApiError(409, "The original ticket is no longer active. Review its cancellation or previous reissue.");
        if (!replacement || !replacement.travellers.length || replacement.travellers.some(t => !replacement.tickets.some(ticket => ticket.travellerId === t.travellerId && ticket.status === "OK"))) {
          throw new ApiError(400, "Record actual replacement ticket numbers on the new booking before completing the reissue.");
        }
      }
      if (status === "REJECTED" && replacement && !isWithdrawnBooking(replacement.status) && (replacement.payments.length || replacement.tickets.length)) {
        throw new ApiError(409, "The replacement booking has receipts or issued tickets. Cancel it from its booking workspace and handle the refund decision first, then reject this reissue. No money or tickets have been changed.");
      }
      const updated = await tx.reissue.update({ where: { id: r.id }, data: { status } });
      if (status === "DONE") {
        await tx.ticket.update({ where: { id: r.originalTicketId }, data: { status: "REISSUED" } });
        const otherPending = await tx.reissue.count({ where: { originalBookingId: r.originalBookingId, status: { in: ["REQUESTED", "IN_PROGRESS"] } } });
        await tx.booking.update({ where: { id: r.originalBookingId }, data: { status: otherPending ? "REISSUE_REQUESTED" : "REISSUED" } });
        await tx.booking.update({ where: { id: replacement!.id }, data: { status: "REISSUED" } });
      }
      if (status === "REJECTED") {
        if (replacement && !isWithdrawnBooking(replacement.status)) await tx.booking.update({ where: { id: replacement.id }, data: { status: "CANCELLED" } });
        if (r.originalBooking.status === "REISSUE_REQUESTED") {
          const siblings = await tx.reissue.findMany({ where: { originalBookingId: r.originalBookingId }, select: { status: true } });
          const originalStatus = siblings.some(s => ["REQUESTED", "IN_PROGRESS"].includes(s.status)) ? "REISSUE_REQUESTED" : siblings.some(s => s.status === "DONE") ? "REISSUED" : "TICKETED";
          await tx.booking.update({ where: { id: r.originalBookingId }, data: { status: originalStatus } });
        }
      }
      await transactionAudit(tx, user, "STATUS", "Reissue", r.id, `${r.status} → ${status}`);
      return updated;
    });
    return Response.json({ ok: true, reissue });
  } catch (e) { return jsonError(e); }
}
