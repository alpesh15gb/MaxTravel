import { balanceOf, bookingCharge, isWithdrawnBooking, netReceived, type CancellationAmounts, type RefundLike } from "./receivables";

/**
 * What an invoice really means right now. An invoice linked to a booking or visa is part of that
 * work's charge, and receipts are usually recorded against the work, so its own "paid" field stays
 * at zero. Screens show the position derived from the work; stored invoice records are not changed.
 */
export type InvoiceViewInput = {
  amount: number; amountPaid: number; status: string;
  booking?: (CancellationAmounts & { payments: { amount: number }[]; refunds: RefundLike[] }) | null;
  visaCase?: { sellingPrice: number; amountReceived: number } | null;
};
export type InvoiceView = { paid: number; balance: number; status: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function invoiceView(i: InvoiceViewInput): InvoiceView {
  if (i.status === "CREDITED") return { paid: 0, balance: 0, status: "CREDITED" };
  let due: number | null = null;
  if (i.booking) due = balanceOf(bookingCharge(i.booking), netReceived(i.booking.payments.reduce((s, p) => s + p.amount, 0), i.booking.refunds));
  else if (i.visaCase) due = balanceOf(i.visaCase.sellingPrice, i.visaCase.amountReceived);
  if (due === null) return { paid: i.amountPaid, balance: Math.max(0, round2(i.amount - i.amountPaid)), status: i.status };
  const balance = Math.min(i.amount, due), paid = round2(i.amount - balance);
  if (i.booking && isWithdrawnBooking(i.booking.status)) return { paid, balance, status: "CANCELLED" };
  return { paid, balance, status: balance <= 0 ? "PAID" : paid > 0 ? "PARTIAL" : "UNPAID" };
}

/** Prisma include that loads what invoiceView needs. */
export const INVOICE_VIEW_INCLUDE = {
  booking: { include: { payments: { select: { amount: true } }, refunds: { select: { amount: true, status: true } } } },
  visaCase: { select: { sellingPrice: true, amountReceived: true } },
} as const;
