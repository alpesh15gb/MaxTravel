/** Private, tab-lifetime recovery only. Never serialize this store to browser storage or telemetry. */
export type QuoteDraftFields = {
  items: { description: string; quantity: number; priceMinor: number; costMinor: number }[];
  terms: string; expiry: string;
};
export type QuoteDraftEntry = {
  nonce: string; context: string; leadId: string; baseRevision: string;
  updatedAt: number; phase: "editing" | "submitting" | "uncertain";
  fields: QuoteDraftFields | null;
};
export const QUOTE_DRAFT_TTL = 30 * 60 * 1000;
export const QUOTE_DRAFT_MAX_BYTES = 100_000;
export function createSalesDraftMemory(context: string, now = Date.now) {
  let entry: QuoteDraftEntry | null = null;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  const clear = (nonce?: string) => {
    if (nonce && entry?.nonce !== nonce) return;
    if (entry) { entry = null; emit(); }
  };
  return {
    context,
    getSnapshot: () => entry,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    clear,
    retain(key: Pick<QuoteDraftEntry, "nonce" | "leadId" | "baseRevision">, fields: QuoteDraftFields) {
      if (!context || !key.nonce || !key.leadId || !key.baseRevision ||
          (entry && (entry.nonce !== key.nonce || entry.phase !== "editing"))) return false;
      const valid = fields.items.length >= 1 && fields.items.length <= 100 && fields.terms.length <= 10000 &&
        fields.expiry.length <= 40 && fields.items.every(item => item.description.length <= 500 &&
          [item.quantity, item.priceMinor, item.costMinor].every(value => Number.isFinite(value) && Math.abs(value) <= 2_000_000_000));
      if (!valid || new TextEncoder().encode(JSON.stringify(fields)).length > QUOTE_DRAFT_MAX_BYTES) {
        clear(key.nonce); return false;
      }
      entry = { ...key, context, fields: structuredClone(fields), phase: "editing", updatedAt: now() };
      emit(); return true;
    },
    beginSubmit(nonce: string) {
      if (entry?.nonce !== nonce || entry.phase !== "editing") return false;
      entry = { ...entry, phase: "submitting" }; emit(); return true;
    },
    settle(nonce: string, outcome: "acknowledged" | "rejected" | "uncertain") {
      if (entry?.nonce !== nonce) return;
      if (outcome === "acknowledged") { clear(nonce); return; }
      entry = { ...entry, phase: outcome === "rejected" ? "editing" : "uncertain" }; emit();
    },
    expire() {
      if (!entry || now() - entry.updatedAt < QUOTE_DRAFT_TTL) return;
      if (entry.phase === "editing") clear(entry.nonce);
      else if (entry.fields) { entry = { ...entry, fields: null }; emit(); }
      // A pending/unknown outcome is not made safe by a timer. Only its private text expires.
    },
  };
}
export type SalesDraftMemory = ReturnType<typeof createSalesDraftMemory>;
