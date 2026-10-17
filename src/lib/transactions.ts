import type { Prisma } from "@prisma/client";
import type { SessionUser } from "./session";
import { journalEntity } from "./financial-journal";
import { ApiError, canTouchRecord } from "./guard";

export const optionalId = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;

// Human-readable agency references (C-2026-0001). The counter row is written in the same
// transaction as the record, so the same number can never be handed out twice; the per-table
// lookup additionally skips numbers already used by imported or legacy records.
const COUNTERS: Record<string, (tx: Prisma.TransactionClient, code: string) => Promise<number>> = {
  C: (tx, code) => tx.customer.count({ where: { code } }),
  EMP: (tx, code) => tx.user.count({ where: { employeeCode: code } }),
  VC: (tx, code) => tx.visaCase.count({ where: { caseNo: code } }),
  BK: (tx, code) => tx.booking.count({ where: { bookingNo: code } }),
  INV: (tx, code) => tx.invoice.count({ where: { invoiceNo: code } }),
  RCP: (tx, code) => tx.payment.count({ where: { receiptNo: code } }),
  RF: (tx, code) => tx.refund.count({ where: { refundNo: code } }),
  DOC: (tx, code) => tx.document.count({ where: { docNo: code } }),
};
export const isReference = (prefix: string) => Boolean(COUNTERS[prefix]);
export async function nextReference(tx: Prisma.TransactionClient, prefix: string, tag = "reference") {
  const known = COUNTERS[prefix];
  if (!known) throw new ApiError(500, `Unknown ${tag} prefix ${prefix}.`);
  const key = `counter.${prefix}`;
  const current = await tx.settings.findUnique({ where: { key } });
  let next = Math.max(0, Math.trunc(Number(current?.value) || 0));
  for (let attempt = 0; attempt < 50; attempt++) {
    next += 1;
    const candidate = `${prefix}-${new Date().getFullYear()}-${String(next).padStart(4, "0")}`;
    if (!(await known(tx, candidate))) {
      await tx.settings.upsert({ where: { key }, create: { key, value: String(next) }, update: { value: String(next) } });
      return candidate;
    }
  }
  throw new ApiError(500, `Could not allocate a free ${tag} number. Contact support.`);
}
export function money(value: unknown, label = "Amount", positive = false): number {
  const n = Number(value ?? 0);
  const cents = Math.round(n * 100);
  if (!Number.isFinite(n) || n < 0 || n > 100000000 || (positive && cents <= 0) || Math.abs(n * 100 - cents) > 0.00001) throw new ApiError(400, `${label} must be ${positive ? "positive" : "non-negative"}, at most ₹100,000,000, with no more than two decimal places.`);
  return cents / 100;
}
/**
 * A free-text field with an explicit length ceiling.
 *
 * Without it an oversized note or address is stored whole (or quietly cut off at the column), and the
 * person who typed it never learns that. Refusing the value keeps what was saved and what was asked
 * for the same thing. Blank and missing both mean "no value", matching optionalId.
 */
export function text(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new ApiError(400, `${label} must be ${max} characters or fewer.`);
  return trimmed;
}
export function date(value: unknown, label = "Date"): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  if (!Number.isFinite(d.getTime())) throw new ApiError(400, `${label} is invalid.`);
  return d;
}
export async function customerFor(tx: Prisma.TransactionClient, user: SessionUser, id: string) {
  const customer = await tx.customer.findUnique({ where: { id } });
  if (!customer) throw new ApiError(404, "Customer not found.");
  if (!canTouchRecord(user, customer)) throw new ApiError(403, "This customer is outside your workspace access.");
  if(customer.mergedIntoId)throw new ApiError(409,"This customer profile was consolidated. Open its retained customer profile before creating work.");
  return customer;
}
export async function relatedFor(tx: Prisma.TransactionClient, user: SessionUser, customerId: string, bookingId: string | null, visaCaseId: string | null) {
  if (bookingId && visaCaseId) throw new ApiError(400, "Choose a booking or a visa case, not both.");
  const booking = bookingId ? await tx.booking.findUnique({ where: { id: bookingId } }) : null;
  const visaCase = visaCaseId ? await tx.visaCase.findUnique({ where: { id: visaCaseId } }) : null;
  if ((bookingId && !booking) || (visaCaseId && !visaCase)) throw new ApiError(404, "Related work record not found.");
  for (const record of [booking, visaCase]) {
    if (!record) continue;
    if (record.customerId !== customerId) throw new ApiError(400, "The selected work record belongs to a different customer.");
    if (!canTouchRecord(user, record)) throw new ApiError(403, "The selected work record is outside your access.");
  }
  return { booking, visaCase };
}
export async function travellersFor(tx: Prisma.TransactionClient, customerId: string, value: unknown) {
  if (!Array.isArray(value) || !value.length || value.some(v => typeof v !== "string")) throw new ApiError(400, "Select at least one traveller.");
  const ids = Array.from(new Set(value as string[]));
  const travellers = await tx.traveller.findMany({ where: { id: { in: ids }, customerId } });
  if (travellers.length !== ids.length) throw new ApiError(400, "All selected travellers must belong to this customer.");
  return travellers;
}
export async function transactionAudit(tx: Prisma.TransactionClient, user: SessionUser, action: string, entity: string, entityId: string, detail: string) {
  if (!(entity === "VisaCase" && action === "STAGE")) await journalEntity(tx, entity, entityId, user.id);
  await tx.auditLog.create({ data: { userId: user.id, action, entity, entityId, detail } });
}
