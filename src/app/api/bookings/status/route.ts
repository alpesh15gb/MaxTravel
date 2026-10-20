import { enumLabel } from "@/lib/labels";
import { inrAmount } from "@/lib/money";
import { requireSession, jsonError, ApiError, canTouchRecord } from "@/lib/guard";
import { isWithdrawnBooking, netReceived, promisedTotal, cancellationRefundAvailable } from "@/lib/receivables";
import { prisma } from "@/lib/db";
import { queueBookingConfirmation } from "@/lib/whatsapp-queue";
import { transactionAudit, money, nextReference, text } from "@/lib/transactions";

// Statuses a person may set by hand.
// REFUND_REQUESTED, REFUND_PENDING and REFUNDED are deliberately absent: a refund is a record with
// its own pipeline (api/refunds), so setting the state here created a booking that claimed money was
// on its way back with no request behind it, and nothing anywhere recorded what was owed.
const MANUAL = ["ENQUIRY", "QUOTE_SENT", "PNR_CREATED", "ON_HOLD", "PAYMENT_AWAITED", "TICKETED", "CANCELLED", "VOID"];

const REFUND_STATE_MESSAGE: Record<string, string> = {
  REFUND_REQUESTED: "Refunds are tracked on the refund itself. Raise a refund request for this booking from the Refunds desk.",
  REFUND_PENDING: "Refunds are tracked on the refund itself. Move the refund through its pipeline instead of setting the booking status.",
  REFUNDED: "Refunds record cash movement only. Use explicit cancellation with agreed supplier and agency charges to withdraw a sale.",
};

// Cancellation replaces the sale demand with explicit charges and reserves customer credit.
const WITHDRAWING = ["CANCELLED", "VOID"];

export async function POST(req: Request) {
  try {
    const user = await requireSession("ticketing:edit");
    const body = await req.json();
    const { bookingId, status } = body;
    if (!bookingId || typeof status !== "string") throw new ApiError(400, "Select a booking and valid status.");
    if (["REISSUE_REQUESTED", "REISSUED"].includes(status)) throw new ApiError(400, "Use the reissue request and completion workflow; reissue states cannot be set by hand.");
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
      if (b.gdsSource === "TRIPJACK_API") throw new ApiError(409,"Manage online booking status from the booking platform.");
      if (!canTouchRecord(user, b)) throw new ApiError(403, "Booking is outside your access.");
      if (isWithdrawnBooking(b.status) && status !== b.status) throw new ApiError(400, "A cancelled, void or refunded booking stays closed. Create a new booking or a reissue for further travel.");

      if (b.status === status) return { booking: { id: b.id, status: b.status }, refundNo: null };
      if (b.status === "REISSUED" && !WITHDRAWING.includes(status)) throw new ApiError(400, "A completed reissue cannot be moved back through booking statuses. Use the replacement booking.");
      if (b.tickets.some(t => t.status === "OK") && ["ENQUIRY", "QUOTE_SENT", "PNR_CREATED", "ON_HOLD", "PAYMENT_AWAITED"].includes(status)) throw new ApiError(400, "Issued tickets cannot be moved back to an enquiry or hold. Use cancellation or reissue.");
      if (status === "PNR_CREATED" && !b.pnr) throw new ApiError(400, "Enter the actual PNR in Edit booking before marking PNR created.");

      // A cancellation is a price adjustment, not a cash refund. Explicit allocation replaces
      // the original sale demand; refund requests reserve only the resulting customer credit.
      let refundNo: string | null = null;
      let cancellation: { cancellationSupplierCharge: number; cancellationAgencyFee: number; cancellationReason: string; cancelledAt: Date } | undefined;
      if (WITHDRAWING.includes(status)) {
        if (!user.permissions.includes("refund:manage")) throw new ApiError(403, "Cancellation financial allocation requires refund permission. Ask finance to record the agreed terms.");
        for (const key of ["cancellationSupplierCharge", "cancellationAgencyFee", "refundAmount"]) {
          if (body[key] === undefined || body[key] === null || body[key] === "") throw new ApiError(400, "Explicitly enter supplier charge, agency fee and refund amount (zero is allowed).");
        }
        const supplier = money(body.cancellationSupplierCharge, "Supplier cancellation charge");
        const agency = money(body.cancellationAgencyFee, "Agency cancellation fee");
        const charge = money(supplier + agency, "Total cancellation charge");
        const reason = text(body.cancellationReason, "Cancellation terms / reason", 2000);
        if (!reason) throw new ApiError(400, "Record the actual cancellation terms and reason.");
        const paid = b.payments.reduce((s, p) => s + p.amount, 0);
        const held = netReceived(paid, b.refunds);
        if (Math.round(promisedTotal(b.refunds) * 100) > Math.max(0, Math.round((held - charge) * 100))) throw new ApiError(409, "Existing pending refunds exceed the credit after these cancellation charges. Reconcile or reject those refund requests first.");
        const owing = cancellationRefundAvailable(charge, paid, b.refunds);
        const amount = money(body.refundAmount, "Refund amount");
        if (Math.round(amount * 100) !== Math.round(owing * 100)) throw new ApiError(400, `Refund must equal the remaining customer credit of ${inrAmount(owing)} after charges and existing refunds. Refresh and review the breakup.`);
        cancellation = { cancellationSupplierCharge: supplier, cancellationAgencyFee: agency, cancellationReason: reason, cancelledAt: new Date() };
        if (amount > 0) {
          const refund = await tx.refund.create({ data: {
            refundNo: await nextReference(tx, "RF"), customerId: b.customerId, bookingId, amount,
            reason: `Booking ${enumLabel(status)} — supplier charge ${inrAmount(supplier)}, agency fee ${inrAmount(agency)}. ${reason}`,
            status: "REQUESTED",
          } });
          refundNo = refund.refundNo;
          await transactionAudit(tx, user, "CREATE", "Refund", refund.id, `${refund.refundNo} · cancellation refund requested, not paid`);
          await tx.activity.create({ data: { customerId: b.customerId, actorId: user.id, type: "REFUND", summary: `Refund ${refundNo} raised · ${inrAmount(amount)}`, link: `/refunds?focus=${refund.id}` } });
        }
      }

      if (status === "TICKETED") {
        if (b.product === "FLIGHT" && !b.pnr) throw new ApiError(400, "Enter the actual PNR in Edit booking before recording airline-issued tickets.");
        const input = Array.isArray(body.tickets) ? body.tickets : [];
        for (const value of input) {
          const traveller = b.travellers.find(t => t.travellerId === value.travellerId);
          const ticketNo = String(value.ticketNo ?? "").trim();
          if (!traveller || !/^\d{3}-?\d{10}$/.test(ticketNo)) throw new ApiError(400, "Enter an actual 13-digit airline ticket number for each passenger.");
          const normalized = ticketNo.replace(/-/g, "");
          const existing = await tx.ticket.findFirst({ where: { ticketNo: { in: [normalized, `${normalized.slice(0, 3)}-${normalized.slice(3)}`] } } });
          if (existing && (existing.bookingId !== bookingId || existing.travellerId !== traveller.travellerId)) throw new ApiError(400, "That airline ticket number is already recorded for another passenger or booking.");
          const currentTicket = await tx.ticket.findFirst({ where: { bookingId, travellerId: traveller.travellerId, status: "OK" } });
          if (currentTicket) {
            if (currentTicket.ticketNo.replace(/-/g, "") !== normalized) throw new ApiError(400, "This passenger already has an active ticket. Use the reissue workflow to replace it.");
            continue;
          }
          await tx.ticket.create({ data: { bookingId, ticketNo, travellerId: traveller.travellerId, passenger: traveller.traveller.fullName, issueDate: new Date(), issuedBy: user.employeeCode, originalFare: money(value.originalFare ?? 0, "Ticket fare"), status: "OK" } });
        }
        const tickets = await tx.ticket.findMany({ where: { bookingId, status: "OK" } });
        if (!b.travellers.length || b.travellers.some(t => !tickets.some(ticket => ticket.travellerId === t.travellerId))) throw new ApiError(400, "Record real ticket numbers for every passenger before marking ticketed. No tickets are issued by this app.");
      }

      const booking = await tx.booking.update({ where: { id: bookingId }, data: { status, ...cancellation } });
      if (status === "TICKETED" && b.status !== status) await queueBookingConfirmation(tx, bookingId, true);
      await tx.activity.create({ data: { customerId: b.customerId, actorId: user.id, type: "BOOKING", summary: `${b.bookingNo} → ${enumLabel(status)}`, link: `/ticketing/${bookingId}` } });
      await transactionAudit(tx, user, "STATUS", "Booking", bookingId, `${b.status} → ${status}${cancellation ? ` · supplier cancellation charge ${cancellation.cancellationSupplierCharge} · agency fee ${cancellation.cancellationAgencyFee} · ${cancellation.cancellationReason}` : ""}${refundNo ? ` · refund ${refundNo} requested` : ""}`);
      return { booking, refundNo };
    });
    return Response.json({ ok: true, ...result });
  } catch (e) { return jsonError(e); }
}
