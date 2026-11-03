import {z} from "zod";
import {boundedJson} from "@/lib/bounded-json";
import {passportReadiness} from "@/lib/travel-readiness";
import { MANUAL_HOTEL_STATUSES, hotelStayProblem } from "@/lib/manual-hotel";
import { enumLabel } from "@/lib/labels";
import { inrAmount } from "@/lib/money";
import { requireSession, jsonError, ApiError, canTouchRecord } from "@/lib/guard";
import { isWithdrawnBooking, netReceived, promisedTotal, cancellationRefundAvailable } from "@/lib/receivables";
import { prisma } from "@/lib/db";
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
    const number=z.union([z.number(),z.string()]).optional();
    const body=z.object({bookingId:z.string().min(1).max(200),status:z.string().max(40),travelScope:z.enum(["DOMESTIC","INTERNATIONAL","UNSPECIFIED"]).optional(),confirmationRecorded:z.boolean().optional(),confirmationRevision:z.string().optional(),confirmationSnapshot:z.record(z.string(),z.unknown()).optional(),tickets:z.array(z.object({travellerId:z.string(),ticketNo:z.string(),originalFare:number})).max(100).optional(),cancellationSupplierCharge:number,cancellationAgencyFee:number,refundAmount:number,cancellationReason:z.string().max(2000).optional()}).parse(await boundedJson(req));
    const { bookingId, status } = body;
    if (!bookingId || typeof status !== "string") throw new ApiError(400, "Select a booking and valid status.");
    if (["REISSUE_REQUESTED", "REISSUED"].includes(status)) throw new ApiError(400, "Use the reissue request and completion workflow; reissue states cannot be set by hand.");
    if (REFUND_STATE_MESSAGE[status]) throw new ApiError(400, REFUND_STATE_MESSAGE[status]);
    if (![...MANUAL,...MANUAL_HOTEL_STATUSES].includes(status)) throw new ApiError(400, "Select a booking and valid status.");

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

      const travelScope=body.travelScope??b.travelScope;
      if(!["UNSPECIFIED","DOMESTIC","INTERNATIONAL"].includes(travelScope))throw new ApiError(400,"Choose domestic or international travel.");
      if(b.status!==status&&["CONFIRMED","TICKETED"].includes(status)){
        if(!b.travellers.length)throw new ApiError(400,"Add the booking travellers before confirmation.");
        const issues=passportReadiness(b.travellers.map(t=>t.traveller),travelScope,b.product,b.travelEndDate??b.hotelCheckOut??b.travelDate);
        if(issues.length)throw new ApiError(400,issues.join(" "));
      }
      if(!["FLIGHT","HOTEL"].includes(b.product)){
        if(!["ENQUIRY","QUOTE_SENT","PAYMENT_AWAITED","CONFIRMED","CANCELLED","VOID"].includes(status))throw new ApiError(400,"Use service confirmation for this booking.");
        if(!WITHDRAWING.includes(status)){
        if(b.status===status)return {booking:{id:b.id,status},refundNo:null};
        if(b.status==="CONFIRMED"&&status!=="CONFIRMED")throw new ApiError(409,"A confirmed service cannot return to an enquiry.");
        if(status==="CONFIRMED"&&(!b.pnr||!b.travelDate||!b.travelEndDate||!b.travellers.length||body.confirmationRecorded!==true))throw new ApiError(400,"Enter the actual supplier reference, start/end dates and travellers, then confirm supplier verification.");
        if(status==="CONFIRMED"&&body.confirmationRevision!==b.updatedAt.toISOString())throw new ApiError(409,"The booking changed. Reload and review the current supplier details.");
        const record=await tx.booking.update({where:{id:b.id},data:{status,travelScope}});await transactionAudit(tx,user,"STATUS","Booking",b.id,`${b.status} → ${status}`);return {booking:{id:record.id,status:record.status},refundNo:null};
        }
      }
      if(b.product==="HOTEL"){
        if(!MANUAL_HOTEL_STATUSES.includes(status))throw new ApiError(400,"Use hotel stay confirmation; airline ticket states do not apply to hotel bookings.");
        if(b.status==="CONFIRMED"&&!WITHDRAWING.includes(status)&&status!=="CONFIRMED")throw new ApiError(400,"A recorded hotel confirmation cannot be moved back to an enquiry. Use cancellation terms if the stay is withdrawn.");
        if(status==="CONFIRMED"){const problem=hotelStayProblem(b,true);if(problem)throw new ApiError(400,problem);const expected={hotelName:b.hotelName,pnr:b.pnr,supplierId:b.supplierId,hotelCheckIn:b.hotelCheckIn?.toISOString()??null,hotelCheckOut:b.hotelCheckOut?.toISOString()??null};if(Object.entries(expected).some(([key,value])=>body.confirmationSnapshot?.[key]!==value))throw new ApiError(409,"Stay details changed. Refresh and review the current supplier confirmation before recording it.");if(body.confirmationRecorded!==true)throw new ApiError(400,"Confirm that the supplier has already confirmed this stay. CRM does not make a hotel reservation.");}
      }else if(b.product==="FLIGHT"&&!MANUAL.includes(status))throw new ApiError(400,"Use the airline ticket workflow for flight bookings.");

      if (b.status === status) return { booking: { id: b.id, status: b.status }, refundNo: null };
      if (b.status === "REISSUED" && !WITHDRAWING.includes(status)) throw new ApiError(400, "A completed reissue cannot be moved back through booking statuses. Use the replacement booking.");
      if (b.tickets.some(t => t.status === "OK") && ["ENQUIRY", "QUOTE_SENT", "PNR_CREATED", "ON_HOLD", "PAYMENT_AWAITED"].includes(status)) throw new ApiError(400, "Issued tickets cannot be moved back to an enquiry or hold. Use cancellation or reissue.");
      if (status === "PNR_CREATED" && !b.pnr) throw new ApiError(400, "Enter the actual PNR in Edit booking before marking PNR created.");

      // A cancellation is a price adjustment, not a cash refund. Explicit allocation replaces
      // the original sale demand; refund requests reserve only the resulting customer credit.
      let refundNo: string | null = null;
      let cancellation: { cancellationSupplierCharge: number; cancellationAgencyFee: number; cancellationReason: string; cancelledAt: Date } | undefined;
      if (WITHDRAWING.includes(status)) {
        if(!b.reissueOfId&&await tx.reissue.count({where:{originalBookingId:b.id,status:{in:["REQUESTED","IN_PROGRESS"]}}}))throw new ApiError(409,"Resolve the open reschedule request before cancelling its original booking.");
        if (!user.permissions.includes("refund:manage")) throw new ApiError(403, "Cancellation financial allocation requires refund permission. Ask finance to record the agreed terms.");
        for (const key of ["cancellationSupplierCharge", "cancellationAgencyFee", "refundAmount"] as const) {
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

      const booking = await tx.booking.update({ where: { id: bookingId }, data: { status, travelScope, ...cancellation } });
      await tx.activity.create({ data: { customerId: b.customerId, actorId: user.id, type: "BOOKING", summary: `${b.bookingNo} → ${enumLabel(status)}`, link: `/ticketing/${bookingId}` } });
      await transactionAudit(tx, user, "STATUS", "Booking", bookingId, `${b.status} → ${status}${cancellation ? ` · supplier cancellation charge ${cancellation.cancellationSupplierCharge} · agency fee ${cancellation.cancellationAgencyFee} · ${cancellation.cancellationReason}` : ""}${refundNo ? ` · refund ${refundNo} requested` : ""}`);
      return { booking, refundNo };
    });
    return Response.json({ ok: true, ...result });
  } catch (e) { if(e instanceof z.ZodError)return Response.json({error:e.issues.map(i=>i.message).join(" ")},{status:400});return jsonError(e); }
}
