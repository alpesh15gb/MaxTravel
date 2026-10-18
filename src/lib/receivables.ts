import { inrAmount } from "@/lib/money";
// Money owed by customers is derived in exactly one place.
//
// Every surface that answers "how much are we owed?" (dashboard pulse, money page, customer 360)
// must use this definition, otherwise two screens can show two different truths for the same data.
//
// Rules:
//  - A booking or visa case is its own demand: outstanding = selling price - money received against it.
//    Receipts recorded against a linked invoice are stored on the work record too, so this already
//    includes them (no invoice needs to be counted separately).
//  - An invoice *not* linked to work is a standalone demand and counts on its own.
//  - An invoice linked to a booking or visa case is NOT counted: its amount is part of that work
//    record's selling price, so counting both would bill the customer twice whenever they paid part
//    of a booking directly and part through the linked invoice.
//  - Money returned to a customer reduces what was received, so a partial refund raises the
//    remaining balance while leaving the booking's sale status untouched.
//  - Money is rounded to paise at every step so floats cannot leave dust behind.

export const WITHDRAWN_BOOKING_STATUSES = ["CANCELLED", "VOID", "REFUNDED"] as const;

/** A booking whose sale has been withdrawn: it is no longer a demand and takes no new receipts. */
export const isWithdrawnBooking = (status: string) =>
  (WITHDRAWN_BOOKING_STATUSES as readonly string[]).includes(status);

// ── Refunds ──────────────────────────────────────────────────────────────────────────────────
// A refund is money leaving the agency, not a status of the sale. Only a COMPLETED refund moves
// money, and only a refund that returns every rupee recorded as received withdraws the booking.
// A partial refund leaves the trip exactly as sold (the customer is simply owed less), and a
// rejected refund changes nothing at all.

export interface RefundLike {
  amount: number;
  status: string;
}

/** Refund stages that are still working their way through the supplier pipeline. */
export const REFUND_IN_FLIGHT_STATUSES = ["REQUESTED", "SUPPLIER_PENDING", "SUPPLIER_RECEIVED", "APPROVED", "PROCESSED"] as const;

export const isInFlightRefund = (status: string) =>
  (REFUND_IN_FLIGHT_STATUSES as readonly string[]).includes(status);

/** Money actually returned to the customer. Approved-but-unpaid refunds are a liability, not a payment. */
export const refundedTotal = (refunds: RefundLike[] = []) =>
  round2(refunds.filter((r) => r.status === "PAID").reduce((s, r) => s + r.amount, 0));

/** Receipts minus a known total of returned money, for callers that only have an aggregate. */
export const netOfRefundTotal = (received: number, refunded: number) => round2(received - refunded);

/** Receipts minus money returned — what the agency has really kept. */
export const netReceived = (received: number, refunds: RefundLike[] = []) =>
  netOfRefundTotal(received, refundedTotal(refunds));

/**
 * Refunds already promised back but not yet returned: everything except the rejected ones and the
 * ones that have actually been paid. A second request must not count this again, or the agency ends
 * up owing the same rupee twice.
 */
export const promisedTotal = (refunds: RefundLike[] = []) =>
  round2(refunds.filter((r) => r.status !== "REJECTED" && r.status !== "PAID").reduce((s, r) => s + r.amount, 0));

/**
 * Money a booking still holds that no existing refund has already promised to return — the ceiling
 * for any further refund, and the figure owed to the customer when a sale is written off.
 */
export const unencumberedBalance = (received: number, refunds: RefundLike[] = []) =>
  Math.max(0, round2(netReceived(received, refunds) - promisedTotal(refunds)));

/** True once a completed refund covers every rupee recorded as received. */
export function isFullyRefunded(received: number, refunds: RefundLike[] = []) {
  const back = refundedTotal(refunds);
  if (back <= 0) return false;
  return Math.round(back * 100) >= Math.round(round2(Math.max(0, received)) * 100);
}

export interface ReceivableInvoice {
  status: string;
  amount: number;
  amountPaid: number;
  bookingId?: string | null;
  visaCaseId?: string | null;
}

export interface ReceivableBooking {
  status: string;
  sellingPrice: number;
  received: number;
  /** Giving a booking its refunds lets the shared figure net them out automatically. */
  refunds?: RefundLike[];
}

export interface ReceivableCase {
  sellingPrice: number;
  received: number;
}

export interface ReceivableBreakdown {
  /** Total genuinely owed by customers right now. */
  total: number;
  /** Outstanding on invoices that are not attached to a booking or visa case. */
  unlinkedInvoices: number;
  /** Outstanding on live bookings. */
  bookings: number;
  /** Outstanding on visa cases. */
  visaCases: number;
  /** Unpaid standalone invoices. */
  openInvoices: number;
  /** Bookings and visa cases with money still due. */
  unpaidWork: number;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Remaining balance on a demand, never negative. */
export const balanceOf = (due: number, paid: number) => Math.max(0, round2(due - paid));

export function receivablesFrom({
  invoices = [],
  bookings = [],
  visaCases = [],
}: {
  invoices?: ReceivableInvoice[];
  bookings?: ReceivableBooking[];
  visaCases?: ReceivableCase[];
}): ReceivableBreakdown {
  const openStandalone = invoices.filter(
    (i) => i.status !== "PAID" && i.status !== "CREDITED" && !i.bookingId && !i.visaCaseId && balanceOf(i.amount, i.amountPaid) > 0,
  );
  const unlinkedInvoices = round2(openStandalone.reduce((s, i) => s + balanceOf(i.amount, i.amountPaid), 0));

  const owedBookings = bookings
    .filter((b) => !isWithdrawnBooking(b.status))
    .map((b) => balanceOf(b.sellingPrice, netReceived(b.received, b.refunds)))
    .filter((n) => n > 0);
  const bookingsOwed = round2(owedBookings.reduce((s, n) => s + n, 0));

  const owedCases = visaCases.map((v) => balanceOf(v.sellingPrice, v.received)).filter((n) => n > 0);
  const casesOwed = round2(owedCases.reduce((s, n) => s + n, 0));

  return {
    total: round2(unlinkedInvoices + bookingsOwed + casesOwed),
    unlinkedInvoices,
    bookings: bookingsOwed,
    visaCases: casesOwed,
    openInvoices: openStandalone.length,
    unpaidWork: owedBookings.length + owedCases.length,
  };
}

/** Short, honest note for a "receivables" card so the figure is never misread. */
export function receivablesNote(b: ReceivableBreakdown) {
  if (b.total === 0) return "Nothing outstanding across invoices, bookings and visa cases";
  const cash = (n: number) => `${inrAmount(n)}`;
  const parts: string[] = [];
  if (b.bookings > 0) parts.push(`bookings ${cash(b.bookings)}`);
  if (b.visaCases > 0) parts.push(`visa ${cash(b.visaCases)}`);
  if (b.unlinkedInvoices > 0) parts.push(`invoices ${cash(b.unlinkedInvoices)}`);
  return parts.join(" · ");
}
