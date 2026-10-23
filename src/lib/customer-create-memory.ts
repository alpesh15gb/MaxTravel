/** Tab-lifetime outcome barrier, not a draft: never retain customer/enquiry fields or capability tokens. */
export type CustomerCreateEntry = {
  nonce: string; context: string;
  phase: "submitting" | "created" | "uncertain";
  customerId?: string; reviewed?: boolean;
};
export function createCustomerCreateMemory(context: string) {
  let entry: CustomerCreateEntry | null = null;
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  return {
    context,
    getSnapshot: () => entry,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    begin(nonce: string) {
      if (!context || !nonce || entry) return false;
      entry = { nonce, context, phase: "submitting" }; emit(); return true;
    },
    settle(nonce: string, result: { kind: "created"; id: string } | { kind: "uncertain" | "rejected" | "access-changed" }) {
      if (entry?.nonce !== nonce || entry.phase !== "submitting") return;
      if (result.kind === "rejected" || result.kind === "access-changed") entry = null;
      else entry = result.kind === "created" ? { nonce, context, phase: "created", customerId: result.id } : { nonce, context, phase: "uncertain" };
      emit();
    },
    markReviewed(nonce: string) {
      if (entry?.nonce !== nonce || entry.phase !== "uncertain") return;
      entry = { ...entry, reviewed: true }; emit();
    },
    clear(nonce: string) {
      if (entry?.nonce !== nonce || entry.phase === "submitting" || (entry.phase === "uncertain" && !entry.reviewed)) return false;
      entry = null; emit(); return true;
    },
    // Only the authenticated provider/session boundary may discard a pending barrier.
    reset() { if (entry) { entry = null; emit(); } },
  };
}
export type CustomerCreateMemory = ReturnType<typeof createCustomerCreateMemory>;
