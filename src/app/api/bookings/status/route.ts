import { enumLabel } from "@/lib/labels";
import { inrAmount } from "@/lib/money";
import { requireSession, jsonError, ApiError, canTouchRecord } from "@/lib/guard";
import { isWithdrawnBooking, netReceived, unencumberedBalance } from "@/lib/receivables";
import { prisma } from "@/lib/db";
import { queueBookingConfirmation } from "@/lib/whatsapp-queue";
import { transactionAudit, money, nextReference } from "@/lib/transactions";

// Statuses a person may set by hand.
// REFUND_REQUESTED, REFUND_PENDING and REFUNDED are deliberately absent: a refund is a record with
// its own pipeline (api/refunds), so setting the state here created a booking that claimed money was
// on its way back with no request behind it, and nothing anywhere recorded what was owed.
const MANUAL = ["ENQUIRY", "QUOTE_SENT", "PNR_CREATED", "ON_HOLD", "PAYMENT_AWAITED", "TICKETED", "CANCELLED", "VOID", "REISSUE_REQUESTED", "REISSUED"];

const REFUND_STATE_MESSAGE: Record<string, string> = {
  REFUND_REQUESTED: "Refunds are tracked on the refund itself. Raise a refund request for this booking from the Refunds desk.",
  REFUND_PENDING: "Refunds are tracked on the refund itself. Move the refund through its pipeline instead of setting the booking status.",
  REFUNDED: "Refunded is set automatically when a completed refund returns every recorded rupee — request and complete a refund instead.",
};

// Cancelling or voiding a sale takes it out of receivables. Any customer money still sitting on it at
// that moment is no longer tracked anywhere, so it has to become a refund record as part of the same
// transaction — otherwise cancelling quietly wrote off a real liability.
const WITHDRAWING = ["CANCELLED", "VOID"];

export async function POST(req: Request) {
  try {
    const user = await requireSession("ticketing:edit");
    const body = await req.json();
    const { bookingId, status } = body;
    if (!bookingId || typeof status !== "string") throw new ApiError(400, "Select a booking and valid status.");
    if (REFUND_STATE_MESSAGE[status]) throw new ApiError(400, REFUND_STATE_MESSAGE[status]);
    if (!MANUAL.includes(status)) throw new ApiError(400, "Select a booking and valid status.");

    const result = await prisma.$transaction(async tx => {
      const b = await tx.booking.findUnique({
        where: { id: bookingId },
        include: {
          tickets: true,
          travellers: { include: { traveller: true } },
          payments: { select: { amount: true } },
          refunds: { select: { amount: true, status: true } },
        },
      });
      if (!b) throw new ApiError(404, "Booking not found.");
      if (!canTouchRecord(user, b)) throw new ApiError(403, "Booking is outside your access.");
      if (isWithdrawnBooking(b.status) && status !== b.status) throw new ApiError(400, "A cancelled, void or refunded booking stays closed. Create a new booking or a reissue for further travel.");

      // Raise the refund this cancellation owes before the booking stops being a receivable.
      let refundNo: string | null = null;
      if (WITHDRAWING.includes(status)) {
        const paid = b.payments.reduce((s, p) => s + p.amount, 0);
        const held = netReceived(paid, b.refunds);
        // Excludes refunds already promised back, so the same rupee is never promised twice.
        const owing = unencumberedBalance(paid, b.refunds);
        if (owing > 0) {
          // Writing off money the customer gave us is a refund decision. A ticketing-only role has no
          // refund:manage and must hand this to finance rather than quietly keep the cash.
          if (!user.permissions.includes("refund:manage")) {
            throw new ApiError(403, `This booking still holds ${inrAmount(held)} of customer money. Cancelling it raises a refund for ${inrAmount(owing)}, which needs refund permission — ask your manager to cancel it.`);
          }
          const amount = money(body.refundAmount, "Refund amount", true);
          if (amount > owing) throw new ApiError(400, `Refund amount exceeds the ${inrAmount(owing)} this booking still owes once existing refunds are counted.`);
          const refund = await tx.refund.create({
            data: {
              refundNo: await nextReference(tx, "RF"), customerId: b.customerId, bookingId, amount,
              reason: `Booking ${enumLabel(status)} — ${inrAmount(amount)} to be returned to the customer`,
              status: "REQUESTED",
            },
          });
          refundNo = refund.refundNo;
          await tx.activity.create({
            data: { customerId: b.customerId, actorId: user.id, type: "REFUND", summary: `Refund ${refundNo} raised · ${inrAmount(amount)}`, link: `/refunds?focus=${refund.id}` },
          });
        }
      }

      if (status === "TICKETED") {
        const input = Array.isArray(body.tickets) ? body.tickets : [];
        for (const value of input) {
          const traveller = b.travellers.find(t => t.travellerId === value.travellerId);
          const ticketNo = String(value.ticketNo ?? "").trim();
          if (!traveller || !/^\d{3}-?\d{10}$/.test(ticketNo)) throw new ApiError(400, "Enter an actual 13-digit airline ticket number for each passenger.");
          if (b.tickets.some(t => t.travellerId === traveller.travellerId && t.status === "OK")) continue;
          await tx.ticket.create({ data: { bookingId, ticketNo, travellerId: traveller.travellerId, passenger: traveller.traveller.fullName, issueDate: new Date(), issuedBy: user.employeeCode, originalFare: money(value.originalFare ?? 0, "Ticket fare"), status: "OK" } });
        }
        const tickets = await tx.ticket.findMany({ where: { bookingId, status: "OK" } });
        if (!b.travellers.length || b.travellers.some(t => !tickets.some(ticket => ticket.travellerId === t.travellerId))) throw new ApiError(400, "Record real ticket numbers for every passenger before marking ticketed. No tickets are issued by this app.");
      }

      const booking = await tx.booking.update({ where: { id: bookingId }, data: { status } });
      if (status === "TICKETED" && b.status !== status) await queueBookingConfirmation(tx, bookingId, true);
      await tx.activity.create({ data: { customerId: b.customerId, actorId: user.id, type: "BOOKING", summary: `${b.bookingNo} → ${enumLabel(status)}`, link: `/ticketing/${bookingId}` } });
      await transactionAudit(tx, user, "STATUS", "Booking", bookingId, refundNo ? `${status} · refund ${refundNo} raised` : status);
      return { booking, refundNo };
    });
    return Response.json({ ok: true, ...result });
  } catch (e) { return jsonError(e); }
}
