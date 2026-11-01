import { z } from "zod";
const date = z.string().datetime().nullable();
export const platformCancellationTrackingSchema = z.array(z.object({
  id: z.string().uuid(),
  status: z.enum(["REQUESTED", "UNDER_REVIEW", "AWAITING_ACCEPTANCE", "SUPPLIER_PENDING", "CONFIRMED", "REJECTED"]),
  supplierStatus: z.string().regex(/^[A-Z_0-9]{1,64}$/).nullable(),
  lastCheckedAt: date, nextCheckAt: date, followUpRequired: z.boolean(),
  checkError: z.enum(["SUPPLIER_UNAVAILABLE", "UNKNOWN_STATUS", "AMENDMENT_REFERENCE_UNAVAILABLE"]).nullable(),
}).strict()).max(30);
export function platformCancellationSummary(value: unknown): string | undefined {
  if (value === undefined) return undefined; // Older booking senders remain compatible.
  const rows = platformCancellationTrackingSchema.parse(value);
  const pending = rows.find(r => r.status === "SUPPLIER_PENDING" && r.followUpRequired) ?? rows.find(r => r.status === "SUPPLIER_PENDING");
  if (!pending) return rows.length ? "Supplier cancellation reconciliation updated. Confirmed refunds are tracked separately." : undefined;
  const when = (v: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(v)) + " IST";
  return [pending.followUpRequired ? "Cancellation needs staff follow-up." : "Cancellation is awaiting supplier confirmation.",
    pending.checkError ? "Supplier outcome needs reconciliation; do not submit cancellation again." : "Automatic status checks remain scheduled.",
    pending.lastCheckedAt ? `Last checked ${when(pending.lastCheckedAt)}.` : "",
    pending.nextCheckAt ? `Next check ${when(pending.nextCheckAt)}.` : "",
    "A pending cancellation does not confirm a customer refund."].filter(Boolean).join(" ");
}
