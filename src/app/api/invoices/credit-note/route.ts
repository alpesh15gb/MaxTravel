import { ApiError, assertCan, jsonError, requireSession } from "@/lib/guard";
import { boundedJson } from "@/lib/bounded-json";
import { prisma } from "@/lib/db";
import { customerFor, nextReference, text, transactionAudit } from "@/lib/transactions";

export async function POST(request: Request) {
  try {
    const user = await requireSession("invoice:create");
    assertCan(user, "refund:manage");
    const body = await boundedJson(request);
    const invoiceId = text(body.invoiceId, "Invoice", 100);
    const reason = text(body.reason, "Credit note reason", 500);
    if (!invoiceId) throw new ApiError(400, "Select an invoice.");
    if (!reason || reason.length < 5) throw new ApiError(400, "Enter a clear reason of at least five characters.");

    const note = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) throw new ApiError(404, "Invoice not found.");
      await customerFor(tx, user, invoice.customerId);
      if (invoice.bookingId || invoice.visaCaseId) throw new ApiError(409, "Linked booking or visa invoices follow the linked work's cancellation and refund workflow.");
      if (invoice.status !== "UNPAID" || invoice.amountPaid !== 0) throw new ApiError(409, "Only a fully unpaid invoice can be credited. Record any customer refund through the separate refund workflow.");
      const [receiptCount, refundCount, existing] = await Promise.all([
        tx.payment.count({ where: { invoiceId: invoice.id } }),
        tx.refund.count({ where: { invoiceId: invoice.id } }),
        tx.invoiceCreditNote.findUnique({ where: { invoiceId: invoice.id } }),
      ]);
      if (receiptCount || refundCount || existing) throw new ApiError(409, "This invoice has a receipt, refund or existing credit note and needs an audited finance review.");

      const created = await tx.invoiceCreditNote.create({ data: { creditNoteNo: await nextReference(tx, "CN"), invoiceId: invoice.id, reason, amount: invoice.amount, taxSnapshot: invoice.taxSnapshot, issuedById: user.id } });
      const changed = await tx.invoice.updateMany({ where: { id: invoice.id, status: "UNPAID", amountPaid: 0 }, data: { status: "CREDITED" } });
      if (changed.count !== 1) throw new ApiError(409, "The invoice changed while this credit note was being created. Refresh and review its balance.");
      await tx.activity.create({ data: { customerId: invoice.customerId, actorId: user.id, type: "INVOICE_CREDIT", summary: `Credit note ${created.creditNoteNo} issued for ${invoice.invoiceNo}`, link: `/payments?focus=${invoice.id}` } });
      await transactionAudit(tx, user, "CREATE", "InvoiceCreditNote", created.id, `${created.creditNoteNo} · ${invoice.invoiceNo} · ${reason}`);
      return created;
    });
    return Response.json({ ok: true, creditNoteId: note.id, creditNoteNo: note.creditNoteNo });
  } catch (error) { return jsonError(error); }
}
