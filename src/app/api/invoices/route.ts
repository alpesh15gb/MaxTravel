import { inrAmount } from "@/lib/money";
import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { isWithdrawnBooking } from "@/lib/receivables";
import { prisma } from "@/lib/db";
import { customerFor, relatedFor, optionalId, nextReference, money, date, transactionAudit } from "@/lib/transactions";
export async function POST(req: Request) {
  try {
    const user = await requireSession("invoice:create"); const b = await req.json();
    const customerId = optionalId(b.customerId);
    if (!customerId) throw new ApiError(400, "Select a customer.");
    const amount = money(b.amount, "Invoice amount", true); const dueDate = date(b.dueDate, "Due date");
    const invoice = await prisma.$transaction(async tx => {
      await customerFor(tx, user, customerId);
      const bookingId = optionalId(b.bookingId); const visaCaseId = optionalId(b.visaCaseId);
      const { booking } = await relatedFor(tx, user, customerId, bookingId, visaCaseId);
      // A withdrawn booking is no longer a demand. Billing it leaves an invoice that can never be
      // paid, sitting in receivables forever, for a trip that was cancelled or already refunded.
      if (booking && isWithdrawnBooking(booking.status)) {
        throw new ApiError(400, "This booking is cancelled, void or refunded and is no longer a demand. Raise a refund, or invoice the customer's open work instead.");
      }
      const record = await tx.invoice.create({ data: { invoiceNo: await nextReference(tx, "INV"), customerId, bookingId, visaCaseId, amount, dueDate, description: optionalId(b.description) } });
      await tx.activity.create({ data: { customerId, actorId: user.id, type: "INVOICE", summary: `Invoice ${record.invoiceNo} issued — ${inrAmount(amount)}`, link: `/payments?focus=${record.id}` } });
      await transactionAudit(tx, user, "CREATE", "Invoice", record.id, record.invoiceNo);
      return record;
    });
    return Response.json({ ok: true, invoiceId: invoice.id, invoiceNo: invoice.invoiceNo });
  } catch (e) { return jsonError(e); }
}
