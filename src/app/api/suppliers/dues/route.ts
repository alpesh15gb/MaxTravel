import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { requireSession, jsonError, ApiError } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { boundedJson } from "@/lib/bounded-json";
import { customerFor, date, money, optionalId, text, transactionAudit } from "@/lib/transactions";

const METHODS = ["CASH", "UPI", "NEFT", "CARD", "CHEQUE", "BANK_TRANSFER", "OTHER"] as const;
const cents = (value: number) => Math.round(value * 100);
const round = (value: number) => Math.round(value * 100) / 100;

export async function POST(req: Request) {
  try {
    const user = await requireSession("supplier:manage");
    const b = await boundedJson(req);
    const dueId = optionalId(b.dueId);

    if (b.action === "reverse") {
      if (!dueId) throw new ApiError(400, "Choose the payable first.");
      const settlementId = optionalId(b.settlementId);
      const reason = text(b.reason, "Reversal reason", 300);
      if (!settlementId || !reason || reason.length < 5) throw new ApiError(400, "Choose a settlement and enter a clear reason of at least five characters.");
      const result = await prisma.$transaction(async (tx) => {
        const [due, settlement] = await Promise.all([
          tx.supplierDue.findUnique({ where: { id: dueId } }),
          tx.supplierSettlement.findUnique({ where: { id: settlementId } }),
        ]);
        if (!due || !settlement || settlement.dueId !== due.id) throw new ApiError(404, "Settlement not found.");
        if (settlement.reversedOn) throw new ApiError(409, "This settlement has already been reversed.");
        const nextPaid = round(due.paidAmount - settlement.amount);
        if (nextPaid < 0) throw new ApiError(409, "The payable balance no longer matches its settlement history. Contact an administrator.");
        const reversedAt = new Date();
        const changedSettlement = await tx.supplierSettlement.updateMany({ where: { id: settlement.id, reversedOn: null }, data: { reversedOn: reversedAt, reversedById: user.id, reversalReason: reason } });
        if (changedSettlement.count !== 1) throw new ApiError(409, "Another staff member changed this settlement. Refresh and review it.");
        const changedDue = await tx.supplierDue.updateMany({ where: { id: due.id, paidAmount: due.paidAmount }, data: { paidAmount: nextPaid, paid: nextPaid >= due.amount, paidOn: nextPaid >= due.amount ? due.paidOn : null } });
        if (changedDue.count !== 1) throw new ApiError(409, "The payable changed during reversal. Refresh and review it.");
        await transactionAudit(tx, user, "REVERSE_SETTLEMENT", "SupplierDue", due.id, `${settlement.id} · ${settlement.amount.toFixed(2)} · ${reason}`);
        return { ok: true, paidAmount: nextPaid };
      });
      return Response.json(result);
    }

    if (b.action === "edit") {
      if (!dueId) throw new ApiError(400, "Choose the payable first.");
      const updated = await prisma.$transaction(async (tx) => {
        const current = await tx.supplierDue.findUnique({ where: { id: dueId } });
        if (!current) throw new ApiError(404, "Payable not found.");
        if (current.paidAmount > 0) throw new ApiError(409, "A payable with recorded settlements is locked. Reverse the settlement with a reason before editing it.");
        const amount = b.amount === undefined ? current.amount : money(b.amount, "Payable amount", true);
        const bookingId = b.bookingId === undefined ? current.bookingId : optionalId(b.bookingId);
        const supplierInvoiceNo = b.supplierInvoiceNo === undefined ? current.supplierInvoiceNo : text(b.supplierInvoiceNo, "Supplier invoice number", 100);
        if (bookingId) await validateBookingLink(tx, user, bookingId, current.supplierId);
        const description = b.description === undefined ? current.description : text(b.description, "Description", 250);
        if (!description) throw new ApiError(400, "Enter a payable description.");
        const dueDate = b.dueDate === undefined ? current.dueDate : date(b.dueDate, "Due date");
        if (!dueDate) throw new ApiError(400, "Choose a due date.");
        const saved = await tx.supplierDue.update({ where: { id: current.id }, data: { amount, description, dueDate, bookingId, supplierInvoiceNo } });
        await transactionAudit(tx, user, "EDIT", "SupplierDue", saved.id, `Payable updated · ${description}`);
        return saved;
      });
      return Response.json({ ok: true, due: updated });
    }

    if (dueId) {
      const amount = money(b.amount, "Settlement amount", true);
      const method = String(b.method ?? "OTHER").toUpperCase();
      if (!METHODS.includes(method as typeof METHODS[number])) throw new ApiError(400, "Choose a valid settlement method.");
      const requestKey = optionalId(b.requestKey) ?? randomUUID();
      if (requestKey.length > 80) throw new ApiError(400, "Settlement request key is invalid.");
      const reference = text(b.reference, "Payment reference", 120);
      const note = text(b.note, "Note", 500);
      const settledOn = date(b.settledOn, "Payment date") ?? new Date();

      const result = await prisma.$transaction(async (tx) => {
        const prior = await tx.supplierSettlement.findUnique({ where: { requestKey } });
        if (prior) {
          if (prior.dueId !== dueId || cents(prior.amount) !== cents(amount)) throw new ApiError(409, "This request key was already used for a different payment.");
          const due = await tx.supplierDue.findUniqueOrThrow({ where: { id: dueId } });
          return { ok: true, replayed: true, due, settlement: prior };
        }
        const due = await tx.supplierDue.findUnique({ where: { id: dueId } });
        if (!due) throw new ApiError(404, "Payable not found.");
        const nextPaid = round(due.paidAmount + amount);
        if (cents(nextPaid) > cents(due.amount)) throw new ApiError(400, `Settlement exceeds the payable balance of ₹${(due.amount - due.paidAmount).toFixed(2)}.`);
        const settlement = await tx.supplierSettlement.create({ data: { dueId, amount, method, reference, note, settledOn, recordedById: user.id, requestKey } });
        const isPaid = cents(nextPaid) === cents(due.amount);
        const changed = await tx.supplierDue.updateMany({ where: { id: due.id, paidAmount: due.paidAmount }, data: { paidAmount: nextPaid, paid: isPaid, paidOn: isPaid ? settledOn : due.paidOn } });
        if (changed.count !== 1) throw new ApiError(409, "The payable changed while payment was recorded. Refresh and retry.");
        await transactionAudit(tx, user, "SETTLE", "SupplierDue", due.id, `${settlement.id} · ${amount.toFixed(2)} ${method}${reference ? ` · ${reference}` : ""}; recorded in CRM only; no funds transferred`);
        return { ok: true, replayed: false, due: { ...due, paidAmount: nextPaid, paid: isPaid }, settlement };
      });
      return Response.json(result);
    }

    const supplierId = optionalId(b.supplierId);
    const description = text(b.description, "Description", 250);
    const dueDate = date(b.dueDate, "Due date");
    const amount = money(b.amount, "Payable amount", true);
    const supplierInvoiceNo = text(b.supplierInvoiceNo, "Supplier invoice number", 100);
    const bookingId = optionalId(b.bookingId);
    if (!supplierId || !description || !dueDate) throw new ApiError(400, "Select a supplier, description and due date.");
    const due = await prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw new ApiError(404, "Supplier not found.");
      if (bookingId) await validateBookingLink(tx, user, bookingId, supplierId);
      const created = await tx.supplierDue.create({ data: { supplierId, bookingId, supplierInvoiceNo, description, dueDate, amount } });
      await transactionAudit(tx, user, "CREATE", "SupplierDue", created.id, `${description}${supplierInvoiceNo ? ` · supplier invoice ${supplierInvoiceNo}` : ""}`);
      return created;
    });
    return Response.json({ ok: true, due });
  } catch (e) { return jsonError(e, "supplier-payables"); }
}

async function validateBookingLink(tx: Prisma.TransactionClient, user: Awaited<ReturnType<typeof requireSession>>, bookingId: string, supplierId: string) {
  const booking = await tx.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new ApiError(404, "Booking not found.");
  await customerFor(tx, user, booking.customerId);
  if (booking.gdsSource === "TRIPJACK_API") throw new ApiError(409, "TripJack wallet bookings are prepaid; they cannot receive another supplier payable.");
  if (booking.supplierId !== supplierId) throw new ApiError(400, "Choose a booking already linked to this supplier.");
}
