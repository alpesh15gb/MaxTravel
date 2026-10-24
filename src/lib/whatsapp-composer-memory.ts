/** Tab-lifetime, authenticated-workspace memory. Never put message text in browser storage. */
export type ComposerAttachment = { id: string; filename: string; url: string; confirmed: boolean };
export type ComposerFields = { draft: string; cloudKey: string; cloudValues: Record<string, string>; attachment: ComposerAttachment | null };
export type ComposerHandoff = { url: string | null; body: string; status: string; newerDraftKept: boolean };
type Action = { token: number; kind: "send" | "consent"; phase: "pending" | "uncertain"; privateCleared?: boolean };
export type ComposerEntry = ComposerFields & {
  revision: number; attachmentEpoch: number; updatedAt: number; cloudPreview: string | null; previewToken: number | null; uploading: boolean;
  action: Action | null; request: { id: string; signature: string } | null;
  error: string; handoff: ComposerHandoff | null;
};
export type PreviewToken = { customerId: string; generation: number; revision: number; token: number; cloud: boolean };
export type SendToken = { customerId: string; revision: number; token: number; requestId: string; fields: ComposerFields; cloudPreview: string | null };
const emptyFields = (): ComposerFields => ({ draft: "", cloudKey: "", cloudValues: {}, attachment: null });
const EMPTY: ComposerEntry = { ...emptyFields(), revision: 0, attachmentEpoch: 0, updatedAt: 0, cloudPreview: null, previewToken: null, uploading: false, action: null, request: null, error: "", handoff: null };
export const hasComposerDraft = (entry: ComposerEntry) => Boolean(entry.draft || entry.cloudKey || entry.attachment);
export function composerReady(entry: ComposerEntry, parameters: readonly string[] = []) {
  return !entry.action && !entry.previewToken && !entry.uploading &&
    Boolean(entry.cloudKey ? entry.cloudPreview && parameters.every(name => entry.cloudValues[name]?.trim()) : entry.draft.trim() || entry.attachment) &&
    (!entry.attachment || entry.attachment.confirmed);
}
const signature = (fields: ComposerFields, preview: string | null) => JSON.stringify([
  fields.draft, fields.cloudKey, Object.entries(fields.cloudValues).sort(([a], [b]) => a.localeCompare(b)),
  fields.attachment?.id ?? null, preview,
]);

export const WHATSAPP_DRAFT_TTL = 30 * 60 * 1000;
export const WHATSAPP_DRAFT_LIMIT = 20;
export function createWhatsAppComposerMemory(context: string, now = Date.now) {
  let snapshot: Readonly<Record<string, ComposerEntry>> = {};
  let generation = 0, sequence = 0, activeCustomer = "";
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  const get = (id: string) => snapshot[id] ?? EMPTY;
  const room = (id: string) => {
    if (snapshot[id] || Object.keys(snapshot).length < WHATSAPP_DRAFT_LIMIT) return true;
    const disposable = Object.entries(snapshot).find(([, entry]) => !hasComposerDraft(entry) && !entry.action && !entry.request);
    if (!disposable) return false;
    const next = { ...snapshot }; delete next[disposable[0]]; snapshot = next; return true;
  };
  const put = (id: string, entry: ComposerEntry) => { snapshot = { ...snapshot, [id]: entry }; emit(); };
  function invalidateReview(id: string) {
    if (!snapshot[id]) return;
    const entry = get(id);
    put(id, { ...entry, cloudPreview: null, previewToken: null, uploading: false,
      attachment: entry.attachment ? { ...entry.attachment, confirmed: false } : null });
  }
  const previewCurrent = (token: PreviewToken) => token.generation === generation && token.customerId === activeCustomer &&
    get(token.customerId).revision === token.revision && get(token.customerId).previewToken === token.token;
  return {
    context,
    getSnapshot: () => snapshot,
    get,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    activate(customerId: string) {
      invalidateReview(activeCustomer); activeCustomer = customerId; generation += 1; invalidateReview(customerId); return generation;
    },
    isActive: (customerId: string, view: number) => activeCustomer === customerId && view === generation,
    leave(view: number) {
      if (view !== generation) return;
      invalidateReview(activeCustomer); activeCustomer = ""; generation += 1;
    },
    edit(customerId: string, patch: Partial<ComposerFields>, view: number, attachmentEpoch?: number) {
      if (!context || view !== generation || customerId !== activeCustomer || !room(customerId)) return false;
      if (attachmentEpoch !== undefined && attachmentEpoch !== get(customerId).attachmentEpoch) return false;
      const fields = { ...get(customerId), ...patch };
      if (fields.draft.length > 4000 || fields.cloudKey.length > 200 || Object.keys(fields.cloudValues).length > 100 ||
          Object.entries(fields.cloudValues).some(([name, value]) => name.length > 200 || value.length > 1024)) return false;
      const entry = get(customerId);
      put(customerId, { ...entry, ...structuredClone(patch), revision: entry.revision + 1, updatedAt: now(),
        cloudPreview: null, previewToken: null, error: "", handoff: null });
      return true;
    },
    uploading(customerId: string, uploading: boolean, view: number, attachmentEpoch?: number) {
      if ((attachmentEpoch === undefined || attachmentEpoch === get(customerId).attachmentEpoch) && room(customerId) && view === generation && customerId === activeCustomer) put(customerId, { ...get(customerId), uploading, ...(uploading ? { updatedAt: now() } : {}) });
    },
    beginPreview(customerId: string, view: number, cloud: boolean): PreviewToken | null {
      const entry = get(customerId);
      if (!context || !room(customerId) || view !== generation || activeCustomer !== customerId || entry.action || entry.previewToken || entry.uploading) return null;
      const token = { customerId, generation, revision: entry.revision, token: ++sequence, cloud };
      put(customerId, { ...entry, previewToken: token.token, updatedAt: now(), error: "", handoff: null }); return token;
    },
    finishPreview(token: PreviewToken, body: string | null, error = "") {
      if (!previewCurrent(token)) return false;
      if (body !== null && body.length > 4000) { body = null; error = "Template is too long. Write a message of at most 4,000 characters."; }
      const entry = get(token.customerId);
      put(token.customerId, { ...entry, previewToken: null, error, updatedAt: now(),
        ...(body === null ? {} : token.cloud ? { cloudPreview: body } : { draft: body, revision: entry.revision + 1 }) });
      return true;
    },
    beginSend(customerId: string, view: number, parameters: readonly string[], createId: () => string): SendToken | null {
      const entry = get(customerId);
      if (!context || !room(customerId) || view !== generation || activeCustomer !== customerId || !composerReady(entry, parameters)) return null;
      const fields = structuredClone({ draft: entry.draft, cloudKey: entry.cloudKey, cloudValues: entry.cloudValues, attachment: entry.attachment });
      const fingerprint = signature(fields, entry.cloudPreview);
      const request = entry.request?.signature === fingerprint ? entry.request : { id: createId(), signature: fingerprint };
      const token = { customerId, revision: entry.revision, token: ++sequence, requestId: request.id, fields, cloudPreview: entry.cloudPreview };
      put(customerId, { ...entry, request, action: { token: token.token, kind: "send", phase: "pending" }, error: "", handoff: null }); return token;
    },
    finishSend(token: SendToken, outcome: "acknowledged" | "rejected" | "uncertain", result?: Omit<ComposerHandoff, "newerDraftKept">, error = "") {
      const entry = get(token.customerId);
      if (entry.action?.token !== token.token || entry.action.kind !== "send") return false;
      if (outcome === "acknowledged" && result) {
        const unchanged = entry.revision === token.revision;
        put(token.customerId, { ...entry, ...(unchanged ? { ...emptyFields(), cloudPreview: null, revision: entry.revision + 1 } : {}),
          action: null, request: null, handoff: entry.action.privateCleared ? null : { ...result, newerDraftKept: !unchanged }, error: "" });
      } else {
        put(token.customerId, { ...entry, action: outcome === "uncertain" ? { ...entry.action, phase: "uncertain" } : null,
          error: error || (outcome === "uncertain" ? `The message outcome is unknown. Check this customer's conversation and WhatsApp before sending again.${hasComposerDraft(entry) ? " Your draft has been kept." : ""}` : `Could not prepare your message.${hasComposerDraft(entry) ? " Your draft has been kept." : ""}`) });
      }
      return true;
    },
    beginConsent(customerId: string, view: number) {
      const entry = get(customerId);
      if (!context || !room(customerId) || view !== generation || activeCustomer !== customerId || entry.action || entry.previewToken) return null;
      const token = ++sequence; put(customerId, { ...entry, action: { token, kind: "consent", phase: "pending" }, error: "" }); return token;
    },
    finishConsent(customerId: string, token: number, error = "") {
      const entry = get(customerId);
      if (entry.action?.token !== token || entry.action.kind !== "consent") return false;
      put(customerId, { ...entry, action: null, error }); return true;
    },
    reviewedUnknown(customerId: string) {
      const entry = get(customerId);
      if (entry.action?.phase === "uncertain") put(customerId, { ...entry, action: null, error: "", cloudPreview: null,
        attachment: entry.attachment ? { ...entry.attachment, confirmed: false } : null });
    },
    discard(customerId: string) {
      if (get(customerId).action) return false;
      put(customerId, { ...EMPTY, ...emptyFields(), revision: get(customerId).revision + 1, attachmentEpoch: get(customerId).attachmentEpoch + 1 }); return true;
    },
    hasUnfinished: () => Object.values(snapshot).some(entry => hasComposerDraft(entry) || entry.action),
    expire() {
      for (const [id, entry] of Object.entries(snapshot)) {
        if (now() - entry.updatedAt < WHATSAPP_DRAFT_TTL || !(hasComposerDraft(entry) || entry.handoff || entry.request || entry.previewToken || entry.uploading)) continue;
        put(id, { ...EMPTY, ...emptyFields(), revision: entry.revision + 1, attachmentEpoch: entry.attachmentEpoch + 1,
          action: entry.action ? { ...entry.action, privateCleared: true } : null,
          error: "This private draft expired after 30 minutes. Check the conversation before preparing another message." });
      }
    },
    clear() { generation += 1; activeCustomer = ""; snapshot = {}; emit(); },
    leaveDocument(persisted: boolean) {
      generation += 1; activeCustomer = "";
      // BFCache must not resurrect private drafts or unlock a still-unresolved submission.
      snapshot = persisted ? Object.fromEntries(Object.entries(snapshot).filter(([, entry]) => entry.action).map(([id, entry]) =>
        [id, { ...EMPTY, ...emptyFields(), revision: entry.revision + 1, attachmentEpoch: entry.attachmentEpoch + 1, action: { ...entry.action!, privateCleared: true }, request: null }])) : {};
      emit();
    },
  };
}
export type WhatsAppComposerMemory = ReturnType<typeof createWhatsAppComposerMemory>;
