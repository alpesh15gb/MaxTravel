/** Outcome metadata only: no request bodies, customer text or private proposal capabilities. */
export type SalesActionKind = "create" | "stage" | "publish" | "withdraw" | "convert";
export type SalesActionEntry = {
  nonce: string; context: string; kind: SalesActionKind;
  phase: "submitting" | "acknowledged" | "uncertain";
  leadId?: string; requiresReview?: true;
};
export function createSalesActionMemory(context: string) {
  let entry: SalesActionEntry | null = null;
  let reviewEpoch = 0;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  const reset = () => { reviewEpoch += 1; if (entry) { entry = null; emit(); } };
  const requireReview = () => { reviewEpoch += 1; if (entry && !entry.requiresReview) { entry = { ...entry, requiresReview: true }; emit(); } };
  return {
    context,
    getSnapshot: () => entry,
    getReviewEpoch: () => reviewEpoch,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    begin(nonce: string, kind: string | undefined, leadId?: string) {
      if (!context || !nonce || entry || !["create", "stage", "publish", "withdraw", "convert"].includes(kind ?? "")) return false;
      entry = { nonce, context, kind: kind as SalesActionKind, phase: "submitting", ...(leadId ? { leadId } : {}) }; emit(); return true;
    },
    settle(nonce: string, outcome: "acknowledged" | "uncertain" | "rejected", leadId?: string) {
      if (entry?.nonce !== nonce || entry.phase !== "submitting") return;
      entry = outcome === "rejected" ? null : { ...entry, phase: outcome, ...(leadId ? { leadId } : {}) }; emit();
    },
    clearAfterReview(nonce: string, epoch?: number) {
      if (entry?.nonce !== nonce || entry.phase === "submitting" ||
          ((entry.requiresReview || entry.phase === "uncertain") && epoch === undefined) ||
          (epoch !== undefined && epoch !== reviewEpoch)) return false;
      entry = null; emit(); return true;
    },
    // Authenticated provider/session boundary only. A late response cannot recreate the marker.
    reset,
    // A BFCache document may resume late callbacks. Preserve only metadata and require fresh review.
    pageHide(persisted: boolean) { if (persisted) requireReview(); else reset(); },
    pageShow(persisted: boolean) { if (persisted) requireReview(); },
  };
}
export type SalesActionMemory = ReturnType<typeof createSalesActionMemory>;

/** Treat malformed 2xx acknowledgements as unknown, never as permission to repeat a write. */
export function isSalesActionAcknowledgement(kind: string | undefined, result: unknown): result is Record<string, unknown> {
  if (!result || typeof result !== "object" || (result as { ok?: unknown }).ok !== true) return false;
  const value = result as Record<string, unknown>;
  const id = (key: string) => typeof value[key] === "string" && value[key].trim().length > 0 && value[key].length <= 200;
  if (kind === "create") return id("id");
  if (kind === "quote") return id("quoteId");
  if (kind === "convert") return id("bookingId");
  if (kind === "publish") return typeof value.sharePath === "string" && /^\/proposal#[a-f0-9]{64}$/.test(value.sharePath);
  return kind === "stage" || kind === "withdraw";
}
