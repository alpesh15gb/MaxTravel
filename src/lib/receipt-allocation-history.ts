/** Receipt allocations only move from unallocated to one target in the application.
 * An atomic ALLOCATE_ADVANCE audit proves that transition; a missing audit does not
 * prove when an already-linked receipt was allocated (including migration openings).
 * Keep this separate from monetary journal positions: allocation moves no cash.
 */
export type ReceiptAllocation = { bookingId: string | null; visaCaseId: string | null; invoiceId: string | null };
export type AllocationReceipt = ReceiptAllocation & { id: string; receiptNo: string; amount: number; createdAt: Date };
export type AllocationAudit = { entityId: string | null; at: Date; detail: string | null };
export type HistoricalAllocation = { supported: true; allocation: ReceiptAllocation } | { supported: false };

const unapplied: ReceiptAllocation = { bookingId: null, visaCaseId: null, invoiceId: null };
const targetKeys = ["bookingId", "visaCaseId", "invoiceId"] as const;
const validId = (value: unknown): value is string | null => value === null || (typeof value === "string" && value.length > 0 && value.trim() === value);
const exactMinor = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const minor = Math.round(value * 100);
  return Number.isSafeInteger(minor) && Math.abs(value * 100 - minor) <= 0.00001 ? minor : null;
};

/** cutoffEnd is exclusive, in the report's existing IST-day convention. */
export function historicalReceiptAllocation(receipt: AllocationReceipt, audits: readonly AllocationAudit[], cutoffEnd: Date, now: Date): HistoricalAllocation {
  if (!audits.length) {
    return targetKeys.every(key => receipt[key] === null)
      ? { supported: true, allocation: { ...unapplied } }
      : { supported: false };
  }
  if (audits.length !== 1) return { supported: false };
  const audit = audits[0];
  const at = audit.at.getTime(), created = receipt.createdAt.getTime(), end = cutoffEnd.getTime(), current = now.getTime();
  if (audit.entityId !== receipt.id || ![at, created, end, current].every(Number.isFinite) || at < created || at > current || !audit.detail) return { supported: false };
  let detail: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(audit.detail);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { supported: false };
    detail = parsed as Record<string, unknown>;
  } catch { return { supported: false }; }
  const amount = exactMinor(receipt.amount);
  if (amount === null || exactMinor(detail.amount) !== amount || detail.receiptNo !== receipt.receiptNo) return { supported: false };
  if (!targetKeys.every(key => validId(detail[key]) && detail[key] === receipt[key])) return { supported: false };
  const allocation = { bookingId: detail.bookingId, visaCaseId: detail.visaCaseId, invoiceId: detail.invoiceId } as ReceiptAllocation;
  if ((!allocation.bookingId && !allocation.visaCaseId && !allocation.invoiceId) || (allocation.bookingId && allocation.visaCaseId)) return { supported: false };
  return { supported: true, allocation: at < end ? allocation : { ...unapplied } };
}
