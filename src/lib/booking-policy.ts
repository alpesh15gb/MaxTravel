/** Integration ownership must never be claimed through manual booking forms. */
export function isReservedBookingSource(value: unknown): boolean {
  return typeof value === "string" && value.trim().toUpperCase() === "TRIPJACK_API";
}

/** Display the online booking source without exposing its internal integration key. */
export function bookingSourceLabel(value: string | null | undefined): string {
  return isReservedBookingSource(value) ? "Online booking" : value || "-";
}
