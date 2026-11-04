/** History line for a to-do whose owner changed. */
export function transferSummary(fromName: string, toName: string | null, note: string): string {
  if (toName === fromName) return note;
  return `Transferred from ${fromName} to ${toName ?? "unassigned"}: ${note}`;
}
