import { financialRequestKey, financialRequestHash, replayFinancialRequest, rememberFinancialRequest, financialConflict } from "@/lib/financial-idempotency";
import { boundedJson } from "@/lib/bounded-json";
import { inrAmount } from "@/lib/money";
import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { queuePaymentAcknowledgement } from "@/lib/whatsapp-queue";
import { customerFor, relatedFor, optionalId, nextReference, money, transactionAudit } from "@/lib/transactions";
import { bookingCharge, hasCancellationAllocation, isWithdrawnBooking, netOfRefundTotal } from "@/lib/receivables";

export async function POST(req: Request) {
  try {
    const user = await requireSession("payment:record");
    const b = await boundedJson(req);
    const requestKey = financialRequestKey(b.requestKey);
    const customerId = optionalId(b.customerId);
    if (!customerId) throw new ApiError(400, "Select a customer.");
    const amount = money(b.amount, "Payment amount", true);
    const mode = String(b.mode ?? "UPI");
    if (!["UPI", "NEFT", "CASH", "CARD", "CHEQUE"].includes(mode)) throw new ApiError(400, "Select a valid payment mode.");
    const response = await prisma.$transaction(async tx => {
      await customerFor(tx, user, customerId);
      const invoiceId = optionalId(b.invoiceId);
      const invoice = invoiceId ? await tx.invoice.findUnique({ where: { id: invoiceId } }) : null;
      if (invoiceId && !invoice) throw new ApiError(404, "Invoice not found.");
      if (invoice && invoice.customerId !== customerId) throw new ApiError(400, "Invoice belongs to a different customer.");

      let bookingId = optionalId(b.bookingId); let visaCaseId = optionalId(b.visaCaseId);
      if (invoice) {
        if ((bookingId && bookingId !== invoice.bookingId) || (visaCaseId && visaCaseId !== invoice.visaCaseId)) throw new ApiError(400, "Payment allocation must match the invoice's linked work.");
        bookingId = invoice.bookingId; visaCaseId = invoice.visaCaseId;

      }
      const { booking, visaCase } = await relatedFor(tx, user, customerId, bookingId, visaCaseId);
      const requestHash = financialRequestHash({ customerId, amount, mode, invoiceId, bookingId, visaCaseId, note: optionalId(b.note) });
      const replay = await replayFinancialRequest(tx, user.id, "PAYMENT_CREATE", requestKey, requestHash);
      if (replay) return replay;
      if (invoice?.status === "CREDITED") throw new ApiError(409, "This invoice has been credited in full and cannot receive another payment.");
      if (invoice && Math.round(amount * 100) > Math.round((invoice.amount - invoice.amountPaid) * 100)) throw new ApiError(400, "Payment exceeds the invoice balance.");
      if (booking?.gdsSource === "TRIPJACK_API") throw new ApiError(409,"Online booking money is managed by the booking platform.");
      if (invoice && booking && isWithdrawnBooking(booking.status)) throw new ApiError(409, "This invoice describes withdrawn travel. Reconcile it separately and collect any explicit cancellation charges directly against the booking.");
      // A withdrawn booking is closed and is not a receivable, so it must not absorb new receipts.
      if (booking && isWithdrawnBooking(booking.status) && !hasCancellationAllocation(booking)) throw new ApiError(400, "This booking is cancelled, void or refunded. Allocate the money to open work, or record it as a customer advance.");

      // The work this receipt settles, and the ceiling it may not pass.
      const bookingFilter = booking ? { bookingId: booking.id } : null;
      const workWhere: { bookingId: string } | { visaCaseId: string } | null =
        bookingFilter ?? (visaCase ? { visaCaseId: visaCase.id } : null);
      const ceiling = booking ? bookingCharge(booking) : visaCase ? visaCase.sellingPrice : 0;
      // Money already returned to the customer cannot be collected again.
      const receivedNow = async () => {
        if (!workWhere) return 0;
        const paid = await tx.payment.aggregate({ where: workWhere, _sum: { amount: true } });
        const back = bookingFilter
          ? await tx.refund.aggregate({ where: { bookingId: bookingFilter.bookingId, status: "PAID" }, _sum: { amount: true } })
          : { _sum: { amount: 0 } };
        return netOfRefundTotal(paid._sum.amount ?? 0, back._sum.amount ?? 0);
      };
      const received = workWhere ? await receivedNow() : null;
      if (workWhere && received !== null && Math.round(amount * 100) > Math.round((ceiling - received) * 100)) throw new ApiError(400, "Payment exceeds the linked work balance.");

      const record = await tx.payment.create({ data: { receiptNo: await nextReference(tx, "RCP"), customerId, amount, mode, bookingId, visaCaseId, invoiceId, receivedById: user.id, note: optionalId(b.note) } });

      // That check and this write are two separate statements, so two people entering receipts at the
      // same moment could both pass it and together take the work over its balance. Re-reading inside
      // the transaction is not what closes that window — the throw is: it rolls the whole transaction
      // back, so an overrun is never committed. SQLite also refuses the second writer outright rather
      // than letting whichever ran last quietly win.
      if (workWhere) {
        const total = await receivedNow();
        if (Math.round(total * 100) > Math.round(ceiling * 100)) {
          throw new ApiError(409, "Another payment landed against this work a moment ago, which would take it over its balance. Nothing was saved — check the current balance and try again.");
        }
      }
      if (invoice) {
        const paid = (Math.round(invoice.amountPaid * 100) + Math.round(amount * 100)) / 100;
        const changed = await tx.invoice.updateMany({ where: { id: invoice.id, status: invoice.status, amountPaid: invoice.amountPaid }, data: { amountPaid: paid, status: Math.round(paid * 100) === Math.round(invoice.amount * 100) ? "PAID" : "PARTIAL" } });
        if (changed.count !== 1) throw new ApiError(409, "The invoice changed while this receipt was being saved. Refresh and check the current balance.");
      }
      if (visaCase) {
        const paid = await tx.payment.aggregate({ where: { visaCaseId: visaCase.id }, _sum: { amount: true } });
        await tx.visaCase.update({ where: { id: visaCase.id }, data: { amountReceived: Math.round((paid._sum.amount ?? 0) * 100) / 100 } });
      }
      await tx.activity.create({ data: { customerId, actorId: user.id, type: "PAYMENT", summary: `Payment ${inrAmount(amount)} recorded (${mode}) — ${record.receiptNo}`, link: `/customers/${customerId}?tab=payments` } });
      await transactionAudit(tx, user, "RECORD", "Payment", record.id, `${record.receiptNo} ₹${amount}`);
      await queuePaymentAcknowledgement(tx, record.id);
      const response = { ok: true, receiptNo: record.receiptNo, payment: requestKey ? { id: record.id, receiptNo: record.receiptNo, amount: record.amount, mode: record.mode, customerId, bookingId, visaCaseId, invoiceId } : record };
      await rememberFinancialRequest(tx, user.id, "PAYMENT_CREATE", requestKey, requestHash, response);
      return response;
    });
    return Response.json(response);
  } catch (e) { return jsonError(financialConflict(e)); }
}
