/** Integration ownership must never be claimed through manual booking forms. */
export function isReservedBookingSource(value: unknown): boolean {
  return typeof value === "string" && value.trim().toUpperCase() === "TRIPJACK_API";
}
