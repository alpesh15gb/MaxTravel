import { inrAmount } from "@/lib/money";
import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { customerFor, relatedFor, optionalId, nextReference, money, transactionAudit } from "@/lib/transactions";
import { isWithdrawnBooking, netOfRefundTotal } from "@/lib/receivables";

export async function POST(req: Request) {
  try {
    const user = await requireSession("payment:record");
    const b = await req.json();
    const customerId = optionalId(b.customerId);
    if (!customerId) throw new ApiError(400, "Select a customer.");
    const amount = money(b.amount, "Payment amount", true);
    const mode = String(b.mode ?? "UPI");
    if (!["UPI", "NEFT", "CASH", "CARD", "CHEQUE"].includes(mode)) throw new ApiError(400, "Select a valid payment mode.");
    const payment = await prisma.$transaction(async tx => {
      await customerFor(tx, user, customerId);
      const invoiceId = optionalId(b.invoiceId);
      const invoice = invoiceId ? await tx.invoice.findUnique({ where: { id: invoiceId } }) : null;
      if (invoiceId && !invoice) throw new ApiError(404, "Invoice not found.");
      if (invoice && invoice.customerId !== customerId) throw new ApiError(400, "Invoice belongs to a different customer.");
      let bookingId = optionalId(b.bookingId); let visaCaseId = optionalId(b.visaCaseId);
      if (invoice) {
        if ((bookingId && bookingId !== invoice.bookingId) || (visaCaseId && visaCaseId !== invoice.visaCaseId)) throw new ApiError(400, "Payment allocation must match the invoice's linked work.");
        bookingId = invoice.bookingId; visaCaseId = invoice.visaCaseId;
        if (Math.round(amount * 100) > Math.round((invoice.amount - invoice.amountPaid) * 100)) throw new ApiError(400, "Payment exceeds the invoice balance.");
      }
      const { booking, visaCase } = await relatedFor(tx, user, customerId, bookingId, visaCaseId);
      // A withdrawn booking is closed and is not a receivable, so it must not absorb new receipts.
      if (booking && isWithdrawnBooking(booking.status)) throw new ApiError(400, "This booking is cancelled, void or refunded. Allocate the money to open work, or record it as a customer advance.");

      // The work this receipt settles, and the ceiling it may not pass.
      const bookingFilter = booking ? { bookingId: booking.id } : null;
      const workWhere: { bookingId: string } | { visaCaseId: string } | null =
        bookingFilter ?? (visaCase ? { visaCaseId: visaCase.id } : null);
      const ceiling = booking ? booking.sellingPrice : visaCase ? visaCase.sellingPrice : 0;
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
        await tx.invoice.update({ where: { id: invoice.id }, data: { amountPaid: paid, status: Math.round(paid * 100) === Math.round(invoice.amount * 100) ? "PAID" : "PARTIAL" } });
      }
      if (visaCase) {
        const paid = await tx.payment.aggregate({ where: { visaCaseId: visaCase.id }, _sum: { amount: true } });
        await tx.visaCase.update({ where: { id: visaCase.id }, data: { amountReceived: Math.round((paid._sum.amount ?? 0) * 100) / 100 } });
      }
      await tx.activity.create({ data: { customerId, actorId: user.id, type: "PAYMENT", summary: `Payment ${inrAmount(amount)} recorded (${mode}) — ${record.receiptNo}`, link: `/customers/${customerId}?tab=payments` } });
      await transactionAudit(tx, user, "RECORD", "Payment", record.id, `${record.receiptNo} ₹${amount}`);
      return record;
    });
    return Response.json({ ok: true, receiptNo: payment.receiptNo, payment });
  } catch (e) { return jsonError(e); }
}
