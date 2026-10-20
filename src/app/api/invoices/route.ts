import { inrAmount } from "@/lib/money";
import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { isWithdrawnBooking } from "@/lib/receivables";
import { prisma } from "@/lib/db";
import { customerFor, relatedFor, optionalId, nextReference, money, date, text, transactionAudit } from "@/lib/transactions";
import { boundedJson } from "@/lib/bounded-json";
import { readInvoiceConfig, validateTaxInvoiceConfiguration, buildInvoiceTaxSnapshot } from "@/lib/invoice-config";
export async function POST(req: Request) {
  try {
    const user = await requireSession("invoice:create"); const b = await boundedJson(req);
    const customerId = optionalId(b.customerId);
    if (!customerId) throw new ApiError(400, "Select a customer.");
    const requestedAmount = money(b.amount, "Invoice amount", true); const dueDate = date(b.dueDate, "Due date");
    const documentKind = b.documentKind === "TAX_INVOICE" ? "TAX_INVOICE" : "OPERATIONAL";
    if (b.documentKind !== undefined && !["OPERATIONAL", "TAX_INVOICE"].includes(String(b.documentKind))) throw new ApiError(400, "Choose a supported invoice document.");
    const description = text(b.description, "Description", 500);
    const invoice = await prisma.$transaction(async tx => {
      const customer = await customerFor(tx, user, customerId);
      const bookingId = optionalId(b.bookingId); const visaCaseId = optionalId(b.visaCaseId);
      const { booking, visaCase } = await relatedFor(tx, user, customerId, bookingId, visaCaseId);
      if (booking?.gdsSource === "TRIPJACK_API") throw new ApiError(409,"Online booking money is managed by the booking platform.");
      // A withdrawn booking is no longer a demand. Billing it leaves an invoice that can never be
      // paid, sitting in receivables forever, for a trip that was cancelled or already refunded.
      if (booking && isWithdrawnBooking(booking.status)) {
        throw new ApiError(400, "This booking is withdrawn. Reconcile existing travel invoices separately; collect any explicit cancellation charges directly against the booking.");
      }
      // Linked invoices describe parts of the existing work demand, not extra sales.
      // Permit instalment invoices, but never issue more than the agreed selling price.
      const work = booking ?? visaCase;
      if (work) {
        const issued = await tx.invoice.aggregate({
          where: { ...(booking ? { bookingId: booking.id } : { visaCaseId: visaCase!.id }), status: { not: "CREDITED" } },
          _sum: { amount: true },
        });
        const remainingMinor = Math.round(work.sellingPrice * 100) - Math.round((issued._sum.amount ?? 0) * 100);
        if (Math.round(requestedAmount * 100) > remainingMinor) {
          throw new ApiError(409, `Linked invoices cannot exceed this work's selling price. ${inrAmount(Math.max(0, remainingMinor) / 100)} remains available to invoice. Open the existing invoices rather than billing the same work again.`);
        }
      }
      let amount = requestedAmount;
      let taxSnapshot: string | null = null;
      if (documentKind === "TAX_INVOICE") {
        if (bookingId || visaCaseId) throw new ApiError(400, "Tax invoices currently require a general invoice without linked booking or visa work. Use an operational invoice for linked work.");
        const saved = await tx.settings.findUnique({ where: { key: "invoice.configuration" } });
        const config = readInvoiceConfig(saved?.value);
        const readiness = validateTaxInvoiceConfiguration(config);
        if (readiness) throw new ApiError(409, readiness);
        const profile = config.profiles.find((item) => item.id === String(b.taxProfileId ?? ""));
        if (!profile) throw new ApiError(400, "Select one of the configured tax profiles.");
        const buyerState = text(b.buyerState, "Customer state", 80);
        if (!buyerState) throw new ApiError(400, "Enter the customer's state for this tax invoice.");
        const placeOfSupply = text(b.placeOfSupply, "Place of supply", 80);
        const sac = text(b.sac, "Service code", 20);
        const subtotalMinor = Math.round(requestedAmount * 100);
        const snapshot = buildInvoiceTaxSnapshot({ config, profile, subtotalMinor, description: description ?? "Travel services", buyer: { name: customer.name, companyName: customer.companyName, gstin: customer.gstNumber, address: customer.address, city: customer.city, state: buyerState }, placeOfSupply, sac });
        if (snapshot.totalMinor > 10000000000) throw new ApiError(400, "Tax inclusive invoice total exceeds ₹100,000,000.");
        amount = snapshot.totalMinor / 100;
        taxSnapshot = JSON.stringify(snapshot);
      }
      const record = await tx.invoice.create({ data: { invoiceNo: await nextReference(tx, "INV"), documentKind, taxSnapshot, customerId, bookingId, visaCaseId, amount, dueDate, description } });
      await tx.activity.create({ data: { customerId, actorId: user.id, type: "INVOICE", summary: `Invoice ${record.invoiceNo} issued — ${inrAmount(amount)}`, link: `/payments?focus=${record.id}` } });
      await transactionAudit(tx, user, "CREATE", "Invoice", record.id, record.invoiceNo);
      return record;
    });
    return Response.json({ ok: true, invoiceId: invoice.id, invoiceNo: invoice.invoiceNo });
  } catch (e) { return jsonError(e); }
}
