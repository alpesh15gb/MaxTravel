// Legacy imported HOTEL rows can retain a flight deadline. Never treat it as a
// supplier-confirmation expiry. Preserve existing behavior for other products.
export function airlineDeadlineEligible(booking: { product: string; status: string; ticketingDeadline: Date | null }, includeQuote = false) {
  return booking.product !== "HOTEL" && booking.ticketingDeadline !== null &&
    ["PNR_CREATED", "ON_HOLD", "PAYMENT_AWAITED", ...(includeQuote ? ["QUOTE_SENT"] : [])].includes(booking.status);
}
