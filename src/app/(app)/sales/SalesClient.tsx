"use client";
import CaseReference from "@/components/CaseReference";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSalesDraftEntry, useSalesDraftMemory, useCustomerCreateEntry, useCustomerCreateMemory, useSalesActionMemory, useSalesActionEntry } from "@/components/SalesDraftProvider";
import { isSalesActionAcknowledgement } from "@/lib/sales-action-memory";
import type { QuoteDraftEntry, QuoteDraftFields } from "@/lib/sales-draft-memory";
import { dateLabel, dateTimeLabel } from "@/lib/dates";
import { enumLabel } from "@/lib/labels";
import EnquiryCustomerPicker from "./EnquiryCustomerPicker";
import {
  SALES_STAGES, hasConflictingAcceptedQuotes, enquiryNextStep, quoteExpiryLabel, quoteExplanation, canPublishQuote, canStartQuote, hasPublishedShare, privateLinkGuidance, replacementQuoteAction,
  type SalesLead, type SalesCustomer,
} from "./sales-workspace";

type CaseContext={id:string;caseNo:string;customerId:string;customerName:string;customerCode:string;service:string;title:string};
type Data = {
  leads: SalesLead[]; customers: SalesCustomer[]; recoveryContext: string; nextCursor: string | null;
  canCreate: boolean; canEdit: boolean; canQuote: boolean; canConvert: boolean;
};
type Item = { description: string; quantity: number; priceMinor: number; costMinor: number };
type View = "list" | "lead" | "new" | "quote";
type Recovery = { nonce: string; kind: "checking" | "ready" | "stale" | "pending" | "unknown" | "unavailable"; lead?: SalesLead };
type ActiveQuote = { nonce: string; leadId: string; baseRevision: string };
const newItem = (): Item => ({ description: "", quantity: 1, priceMinor: 0, costMinor: 0 });
const money = (value: number | null) => value === null ? "Restricted" :
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value / 100);
const localDateTime = (value: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export default function SalesClient({ initialLeadId, initialCreate=false, initialCase=null }: { initialLeadId?: string; initialCreate?: boolean; initialCase?:CaseContext|null }) {
  const [caseContext,setCaseContext]=useState(initialCase);
  const draftMemory = useSalesDraftMemory();
  const customerMemory = useCustomerCreateMemory();
  const customerWrite = useCustomerCreateEntry();
  const customerPending = customerWrite?.phase === "submitting";
  const actionMemory = useSalesActionMemory();
  const actionWrite = useSalesActionEntry();
  const actionPending = actionWrite?.phase === "submitting";
  const retainedDraft = useSalesDraftEntry();
  const activeQuote = useRef<ActiveQuote | null>(null);
  const liveFields = useRef<QuoteDraftFields>({ items: [newItem()], terms: "", expiry: "" });
  const recoveryCheck = useRef(0);
  const readGeneration = useRef(0);
  const activationGeneration = useRef(0);
  const pendingHandoffId = useRef<string | null>(null);
  const customerAccessGeneration = useRef(0);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [retentionError, setRetentionError] = useState("");
  const [contextChanged, setContextChanged] = useState(false);
  const recoveryHeading = useRef<HTMLHeadingElement>(null);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [localBusy, setBusy] = useState(false);
  const busy = localBusy || actionPending;
  const [localUncertain, setUncertain] = useState(false);
  const uncertain = localUncertain || Boolean(actionWrite && !actionPending);
  const [localUncertaintyReason, setUncertaintyReason] = useState("");
  const uncertaintyReason = actionWrite?.phase === "uncertain"
    ? "The save outcome is unknown. It may have completed. Do not submit again; reload latest status and review the enquiry before continuing."
    : actionWrite?.phase === "acknowledged"
      ? "The save was acknowledged, but the latest record needs review. Do not save again. Reload latest status and review it first."
      : localUncertaintyReason;
  const [filter, setFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [listIds, setListIds] = useState<string[]>([]);
  const [appendedFocusId, setAppendedFocusId] = useState<string | null>(null);
  const listCriteria = useRef({ q: "", stage: "ALL" });
  const listReadLock = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  const dataRef = useRef<Data | null>(null);
  const [view, setView] = useState<View>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [share, setShare] = useState("");
  const [shareContext, setShareContext] = useState("");
  const [shareQuoteId, setShareQuoteId] = useState<string | null>(null);
  const [terms, setTerms] = useState("");
  const [expiry, setExpiry] = useState("");
  const [items, setItems] = useState<Item[]>([newItem()]);
  const [focusRequest, setFocusRequest] = useState(0);
  const [stageFormRevision, setStageFormRevision] = useState(0);
  const mutationLock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const uncertaintySummary = useRef<HTMLDivElement>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const addItemButton = useRef<HTMLButtonElement>(null);
  const shareInput = useRef<HTMLInputElement>(null);
  const shareHeading = useRef<HTMLHeadingElement>(null);
  const selected = data?.leads.find(lead => lead.id === selectedId);
  const nextStep = selected ? enquiryNextStep(selected) : null;
  const locked = busy || customerPending || uncertain || loading || recoveryBusy || Boolean(retainedDraft && retainedDraft.phase !== "editing");
  // Every sales POST also requires customer:edit. Do not offer an action the API forbids.
  const canQuote = Boolean(data?.canEdit && data.canQuote);
  const canCreate = Boolean(data?.canEdit && data.canCreate);
  selectedIdRef.current = selectedId; dataRef.current = data;
  const visible = data ? listIds.flatMap(id => { const lead = data.leads.find(item => item.id === id); return lead ? [lead] : []; }) : [];

  const load = useCallback(async (options: { q?: string; stage?: string; cursor?: string; focusId?: string } = {}) => {
    const generation = ++readGeneration.current;
    const criteria = { q: options.q ?? listCriteria.current.q, stage: options.stage ?? listCriteria.current.stage };
    const params = new URLSearchParams();
    if (criteria.q) params.set("q", criteria.q);
    if (criteria.stage !== "ALL") params.set("stage", criteria.stage);
    if (options.cursor) params.set("cursor", options.cursor);
    const response = await fetch(`/api/sales${params.size ? `?${params}` : ""}`, { cache: "no-store" });
    const result = await response.json();
    if (generation !== readGeneration.current) throw new Error("A newer enquiry read replaced this request. Review the latest status.");
    if (!response.ok) {
      if ([401, 403, 404].includes(response.status)) {
        draftMemory.clear(); setContextChanged(true); setData(null); setView("list"); setSelectedId(null); setDirty(false);
        setItems([newItem()]); setTerms(""); setExpiry(""); setShare(""); setShareContext(""); setShareQuoteId(null);
        activeQuote.current = null;
        throw new Error("Staff session or access changed. Reload this workspace before continuing.");
      }
      throw new Error(result.error ?? "Cannot load enquiries.");
    }
    if (result.recoveryContext !== draftMemory.context) {
      draftMemory.clear(); setContextChanged(true); setData(null); setShare(""); setShareContext(""); setShareQuoteId(null);
      throw new Error("Staff session or access changed. Reload this workspace before continuing.");
    }
    const page = result as Data;
    const ids = page.leads.map(lead => lead.id);
    const id = options.focusId ?? selectedIdRef.current;
    let missingId: string | null = null;
    if (id && !page.leads.some(lead => lead.id === id)) {
      const detail = await fetch(`/api/sales?leadId=${encodeURIComponent(id)}`, { cache: "no-store" });
      const selectedResult = await detail.json();
      if (generation !== readGeneration.current) throw new Error("A newer enquiry read replaced this request.");
      if ([401, 403].includes(detail.status) || (detail.ok && selectedResult.recoveryContext !== draftMemory.context)) {
        draftMemory.clear(); setContextChanged(true); setData(null); setView("list"); setSelectedId(null);
        setShare(""); setShareContext(""); setShareQuoteId(null); throw new Error("Staff session or access changed. Reload this workspace before continuing.");
      }
      if (detail.ok) { page.leads = [...page.leads, selectedResult.lead]; if (selectedResult.customer) page.customers.push(selectedResult.customer); }
      else if (detail.status === 404) missingId = id;
      else throw new Error("Cannot refresh the selected enquiry.");
    }
    const previous = options.cursor ? dataRef.current : null;
    const merged = { ...page, leads: [...new Map([...(previous?.leads.filter(lead => lead.id !== missingId) ?? []), ...page.leads].map(lead => [lead.id, lead])).values()], customers: [...new Map([...(previous?.customers ?? []), ...page.customers].map(customer => [customer.id, customer])).values()] };
    if (options.cursor) setAppendedFocusId(ids.find(id => !previous?.leads.some(lead => lead.id === id)) ?? null);
    listCriteria.current = criteria; setListIds(previousIds => options.cursor ? [...new Set([...previousIds, ...ids])] : ids);
    setContextChanged(false); setData(merged);
    return merged;
  }, [draftMemory]);

  const checkRecovery = useCallback(async (entry: QuoteDraftEntry): Promise<Recovery | null> => {
    const generation = ++recoveryCheck.current;
    setRecovery({ nonce: entry.nonce, kind: "checking" });
    try {
      const response = await fetch(`/api/sales?leadId=${encodeURIComponent(entry.leadId)}`, { cache: "no-store" });
      const result = await response.json();
      if (generation !== recoveryCheck.current || draftMemory.getSnapshot()?.nonce !== entry.nonce) return null;
      if ([401, 403, 404].includes(response.status) || (response.ok &&
          (result.recoveryContext !== draftMemory.context || !result.canEdit || !result.canQuote))) {
        draftMemory.clear(entry.nonce); setRecovery(null);
        if (response.ok && result.recoveryContext !== draftMemory.context) { setContextChanged(true); setData(null); setShare(""); setShareContext(""); setShareQuoteId(null); }
        setError("The saved quotation was cleared because its staff session or permitted record is no longer available."); return null;
      }
      if (!response.ok) throw new Error("unavailable");
      const latest = draftMemory.getSnapshot();
      if (!latest || !result.lead || result.lead.id !== entry.leadId) throw new Error("unavailable");
      const kind: Recovery["kind"] = latest.phase === "submitting" ? "pending" : latest.phase === "uncertain" ? "unknown"
        : result.lead.baseRevision !== entry.baseRevision || !canStartQuote(result.lead) || result.lead.quotes.some((quote: { state: string }) => quote.state === "ACCEPTED") ? "stale" : "ready";
      const checked = { nonce: entry.nonce, kind, lead: result.lead };
      setRecovery(checked); return checked;
    } catch {
      if (generation === recoveryCheck.current && draftMemory.getSnapshot()?.nonce === entry.nonce)
        setRecovery({ nonce: entry.nonce, kind: "unavailable" });
      return null;
    }
  }, [draftMemory]);

  useLayoutEffect(() => {
    let active = true;
    const activation = ++activationGeneration.current;
    // Reset before paint: Activity may preserve old fields while hidden, but cannot authorize their reveal.
    // Activity/Back restoration is not authorization. Re-check before exposing any retained text.
    setLoading(true); setData(null); setRecovery(null); setView("list"); setDirty(false); activeQuote.current = null;
    pendingHandoffId.current = initialLeadId ?? null;
    if (initialLeadId) setSelectedId(null);
    setError(""); setNotice("");
    setItems([newItem()]); setTerms(""); setExpiry("");
    setShare(""); setShareContext(""); setShareQuoteId(null);
    draftMemory.expire();
    load({ focusId: initialLeadId }).then(async latest => {
      if (!active || activation !== activationGeneration.current) return;
      if (initialLeadId) {
        if (latest.leads.some(lead => lead.id === initialLeadId)) {
          setSelectedId(initialLeadId); setView("lead"); setFocusRequest(value => value + 1);
        } else { setSelectedId(null); setNotice("This enquiry is no longer available in your workspace."); }
        pendingHandoffId.current = null;
      }
      const entry = draftMemory.getSnapshot();
      if (active && activation === activationGeneration.current && entry) await checkRecovery(entry);
      else if (!initialLeadId && initialCreate && latest.canCreate && latest.canEdit && new URLSearchParams(window.location.search).get("action")==="new") { setCaseContext(initialCase);setSelectedId(null); setView("new"); setFocusRequest(value => value + 1); window.history.replaceState(null,"","/sales"); }
    }).catch(error => { if (active && activation === activationGeneration.current) setError(error instanceof Error && error.message.startsWith("Staff session or access changed") ? error.message : "Enquiries could not be loaded. Retry to see the latest records."); })
      .finally(() => { if (active && activation === activationGeneration.current) setLoading(false); });
    return () => { active = false; activationGeneration.current += 1; recoveryCheck.current += 1; readGeneration.current += 1; };
  }, [load, checkRecovery, draftMemory, initialLeadId, initialCreate, initialCase]);

  useEffect(() => {
    if (!recovery) return;
    if (!retainedDraft) { setRecovery(null); setLoading(true); void load().catch(() => setError("Reload latest status to review the enquiry.")).finally(() => setLoading(false)); return; }
    if (recovery.nonce !== retainedDraft.nonce || !recovery.lead) return;
    if (retainedDraft.phase === "editing" && ["pending", "unknown"].includes(recovery.kind)) {
      void checkRecovery(retainedDraft); return;
    }
    const kind = retainedDraft.phase === "submitting" ? "pending" : retainedDraft.phase === "uncertain" ? "unknown" : recovery.kind;
    if (kind !== recovery.kind) setRecovery({ ...recovery, kind });
  }, [retainedDraft, recovery, load, checkRecovery]);

  useEffect(() => { if (recovery && recovery.kind !== "checking") recoveryHeading.current?.focus(); }, [recovery]);

  // Focus only after the new workspace is committed, never on an arbitrary timer.
  useEffect(() => {
    if (!focusRequest) return;
    if (view === "list") {
      const row = selectedId ? document.getElementById(`sales-open-${selectedId}`) : null;
      const target = row ?? searchInput.current ?? newButton.current;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest", behavior: "instant" });
    } else {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, [focusRequest, view, selectedId]);
  useEffect(() => {
    if (!share) return;
    shareHeading.current?.focus({ preventScroll: true });
    shareHeading.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [share]);
  useEffect(() => {
    if (!appendedFocusId || loading) return;
    const row = document.getElementById(`sales-open-${appendedFocusId}`);
    row?.focus({ preventScroll: true }); row?.scrollIntoView({ block: "nearest" });
    setAppendedFocusId(null);
  }, [appendedFocusId, loading]);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);
  useEffect(() => { if (uncertain) uncertaintySummary.current?.focus(); }, [uncertain]);

  useEffect(() => {
    if (!dirty && !busy && !customerPending) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest("a[href]");
      if (!anchor || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      if (busy || customerPending || !window.confirm("Leave this enquiry? Unsaved changes will be lost.")) {
        event.preventDefault(); event.stopPropagation();
      } else if (activeQuote.current) draftMemory.clear(activeQuote.current.nonce);
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [dirty, busy, customerPending, draftMemory]);

  function leaveAllowed() {
    return !mutationLock.current && actionMemory.getSnapshot()?.phase !== "submitting" && customerMemory.getSnapshot()?.phase !== "submitting" && (!dirty || window.confirm("Discard unsaved changes to this enquiry?"));
  }
  function open(viewNext: View, id: string | null = selectedId) {
    if (!leaveAllowed()) return;
    if (viewNext === "quote" && draftMemory.getSnapshot() && draftMemory.getSnapshot()?.nonce !== activeQuote.current?.nonce) {
      setError("Restore or explicitly discard the retained quotation before starting another one."); return;
    }
    if (activeQuote.current) draftMemory.clear(activeQuote.current.nonce);
    activeQuote.current = null; if (!draftMemory.getSnapshot()) setRecovery(null); setRetentionError("");
    setCaseContext(null);setDirty(false); setError(""); setSelectedId(id); setView(viewNext);
    if (viewNext === "quote") {
      const lead = data?.leads.find(item => item.id === id);
      if (!lead?.baseRevision) { setError("Reload latest status before preparing a quotation."); setView("lead"); return; }
      activeQuote.current = { nonce: crypto.randomUUID(), leadId: lead.id, baseRevision: lead.baseRevision };
      liveFields.current = { items: [newItem()], terms: "", expiry: "" };
      setItems(liveFields.current.items); setTerms(""); setExpiry("");
    }
    setFocusRequest(value => value + 1);
  }

  function reconcileShare(latest: Data, quoteId: string | null = shareQuoteId) {
    if (quoteId && !hasPublishedShare(latest.leads, quoteId)) {
      setShare(""); setShareQuoteId(null); setShareContext("");
    }
  }

  async function reload() {
    if (mutationLock.current || actionMemory.getSnapshot()?.phase === "submitting" || customerMemory.getSnapshot()?.phase === "submitting" || draftMemory.getSnapshot()?.phase === "submitting" || (dirty && !window.confirm("Reload latest status and discard local edits? Copy anything you need first. A previous save may already have completed."))) return;
    const activation = activationGeneration.current;
    const pendingReview = actionMemory.getSnapshot();
    const reviewEpoch = actionMemory.getReviewEpoch();
    const reviewUnknownCreate = pendingReview?.kind === "create" && pendingReview.phase === "uncertain";
    // A failed initial exact-record read must retry the URL target, not silently fall back
    // to page one. A pending write review takes precedence; resolved links do not override
    // the operator's later selection. The activation check below fences route changes.
    const handoffId = pendingHandoffId.current;
    const focusId = pendingReview?.leadId ?? (reviewUnknownCreate ? undefined : handoffId ?? selectedIdRef.current ?? undefined);
    mutationLock.current = true; setLoading(true); setError("");
    try {
      const latest = await load({ focusId, ...(reviewUnknownCreate ? { q: "", stage: "ALL" } : {}) });
      if (activation !== activationGeneration.current) return;
      reconcileShare(latest);
      if (activeQuote.current) draftMemory.clear(activeQuote.current.nonce);
      activeQuote.current = null;
      const retained = draftMemory.getSnapshot();
      if (retained) await checkRecovery(retained);
      if (activation !== activationGeneration.current) return;
      if (pendingReview && !actionMemory.clearAfterReview(pendingReview.nonce, reviewEpoch)) {
        setError("This review was interrupted. Reload latest status again before making another change."); return;
      }
      if (reviewUnknownCreate) { setQuery(""); setFilter("ALL"); }
      setUncertain(false); setDirty(false);
      const selectedAfterReview = focusId ?? selectedIdRef.current;
      const available = !!selectedAfterReview && latest.leads.some(lead => lead.id === selectedAfterReview);
      setSelectedId(available ? selectedAfterReview : null); setView(available ? "lead" : "list");
      pendingHandoffId.current = null;
      setNotice(handoffId && focusId === handoffId && !available
        ? "This enquiry is no longer available in your workspace."
        : "Latest records loaded. Review the enquiry and quote versions before making another change.");
      setFocusRequest(value => value + 1);
    } catch { if (activation === activationGeneration.current) setError("Latest status could not be loaded. Keep your local notes and try loading again; do not repeat an uncertain save."); }
    finally { mutationLock.current = false; if (activation === activationGeneration.current) setLoading(false); }
  }

  async function searchEnquiries(reset = false, more = false) {
    if (listReadLock.current || mutationLock.current || locked || dirty) return;
    const cursor = more ? data?.nextCursor : null;
    if (more && !cursor) return;
    const activation = activationGeneration.current;
    listReadLock.current = true; setLoading(true); setError("");
    try {
      const latest = await load(more ? { cursor: cursor! } : { q: reset ? "" : query, stage: reset ? "ALL" : filter });
      if (activation !== activationGeneration.current) return;
      if (reset) { setQuery(""); setFilter("ALL"); }
      if (!more) setView("list");
      setNotice(more ? "More matching enquiries loaded." : "Search updated across all enquiries in your permitted scope.");
      if (selectedId && !latest.leads.some(lead => lead.id === selectedId)) { setSelectedId(null); setView("list"); }
    } catch (error) { if (activation === activationGeneration.current) setError(error instanceof Error ? error.message : "Search could not be loaded. Try again."); }
    finally { listReadLock.current = false; if (activation === activationGeneration.current) setLoading(false); }
  }

  async function action(body: unknown): Promise<Record<string, unknown> | null> {
    if (mutationLock.current || actionMemory.getSnapshot() || customerMemory.getSnapshot()?.phase === "submitting" || uncertain || (draftMemory.getSnapshot() && draftMemory.getSnapshot()?.phase !== "editing")) return null;
    const kind = (body as { action?: string }).action;
    if (dirty && !["create", "quote", "stage"].includes(kind ?? "") &&
      !window.confirm("Discard unsaved stage or follow-up edits before continuing?")) return null;
    const actionActivation = activationGeneration.current;
    const actionAccess = customerAccessGeneration.current;
    const quoteNonce = kind === "quote" ? activeQuote.current?.nonce : null;
    if (kind === "quote" && (!quoteNonce || !activeQuote.current || !draftMemory.retain(activeQuote.current, liveFields.current) || !draftMemory.beginSubmit(quoteNonce))) {
      setError("This quotation cannot be safely retained for submission. Review its size and reload latest status if needed."); return null;
    }
    const actionNonce = kind === "quote" ? null : crypto.randomUUID();
    if (actionNonce && !actionMemory.begin(actionNonce, kind, (body as { leadId?: string }).leadId)) return null;
    mutationLock.current = true; setBusy(true); setError(""); setNotice("");
    let confirmed = false;
    let activeShareId = shareQuoteId;
    try {
      const response = await fetch("/api/sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (response.ok && !isSalesActionAcknowledgement(kind, result)) throw new Error("uncertain");
      if (actionNonce) actionMemory.settle(actionNonce, response.ok ? "acknowledged" : response.status >= 500 ? "uncertain" : "rejected", typeof result.id === "string" ? result.id : undefined);
      if (actionAccess !== customerAccessGeneration.current) {
        // Revoked access may settle metadata, never restart reads or reveal its result.
        // Ordinary Activity hiding is different: its unknown outcomes must still lock the workspace.
        if (quoteNonce) draftMemory.settle(quoteNonce, response.ok ? "acknowledged" : response.status >= 500 ? "uncertain" : "rejected");
        return null;
      }
      if (!response.ok) {
        if (response.status >= 500) throw new Error("uncertain");
        if (quoteNonce) draftMemory.settle(quoteNonce, "rejected");
        if ([401, 403, 404].includes(response.status)) {
          draftMemory.clear(quoteNonce ?? undefined); activeQuote.current = null;
          setData(null); setView("list"); setDirty(false); setItems([newItem()]); setTerms(""); setExpiry("");
          setShare(""); setShareContext(""); setShareQuoteId(null);
        }
        if (quoteNonce && result.code === "QUOTE_REVISION_CONFLICT") {
          const entry = draftMemory.getSnapshot();
          activeQuote.current = null; setDirty(false); setView("list");
          if (entry) await checkRecovery(entry);
          if (actionAccess !== customerAccessGeneration.current) return null;
        }
        setError(quoteNonce && result.code === "QUOTE_REVISION_CONFLICT"
          ? "The enquiry or quotation changed; this draft was not saved. Recheck your access and review the latest enquiry before continuing. A retained copy cannot overwrite a newer version."
          : result.error ?? "The request was not accepted. Check the fields and permissions.");
        return null;
      }
      confirmed = true;
      if (quoteNonce) draftMemory.settle(quoteNonce, "acknowledged");
      // A replaced/hidden page cannot own review. Its provider keeps only the acknowledged outcome.
      if (actionNonce && (actionActivation !== activationGeneration.current || actionMemory.getSnapshot()?.requiresReview)) return null;
      const request = body as { leadId?: string; quoteId?: string };
      if (kind === "withdraw" && request.quoteId === activeShareId) {
        setShare(""); setShareQuoteId(null); setShareContext(""); activeShareId = null;
      }
      if (actionActivation === activationGeneration.current && typeof result.sharePath === "string" && /^\/proposal#[a-f0-9]{64}$/.test(result.sharePath)) {
        const sourceLead = data?.leads.find(lead => lead.id === request.leadId);
        const sourceQuote = sourceLead?.quotes.find(quote => quote.id === request.quoteId);
        activeShareId = request.quoteId ?? null;
        setShareQuoteId(activeShareId);
        setShareContext(`${sourceLead?.title ?? "Published enquiry"}${sourceQuote ? ` · Quote v${sourceQuote.version}` : ""}`);
        setShare(new URL(result.sharePath, window.location.origin).href);
      }
      const latest = await load({ focusId: typeof result.id === "string" ? result.id : request.leadId });
      if (actionAccess !== customerAccessGeneration.current || (actionNonce && (actionActivation !== activationGeneration.current || actionMemory.getSnapshot()?.requiresReview))) return null;
      if (actionNonce) actionMemory.clearAfterReview(actionNonce);
      reconcileShare(latest, activeShareId);
      // A confirmed action may leave the persisted stage/follow-up unchanged (e.g. withdraw).
      // Remount uncontrolled fields before clearing dirty state, so discarded edits cannot survive.
      // Keep this separate from focusRequest: publishing must retain private-link heading focus.
      setStageFormRevision(revision => revision + 1);
      setDirty(false); setNotice("Saved. The latest enquiry record is shown below.");
      return result;
    } catch {
      if (actionNonce && !confirmed) actionMemory.settle(actionNonce, "uncertain");
      if (quoteNonce && !confirmed) draftMemory.settle(quoteNonce, "uncertain");
      if (actionAccess !== customerAccessGeneration.current) return null;
      setUncertain(true); setError("");
      setUncertaintyReason(confirmed
        ? "The save was acknowledged, but the latest record could not be loaded. Do not save again. Reload latest status and review it first."
        : "The save outcome is unknown. It may have completed. Do not submit again; reload latest status and review the enquiry before continuing.");
      return null;
    } finally { mutationLock.current = false; setBusy(false); }
  }

  function changeQuote(patch: Partial<QuoteDraftFields>) {
    const fields = { ...liveFields.current, ...patch };
    liveFields.current = fields;
    if (activeQuote.current) {
      const kept = draftMemory.retain(activeQuote.current, fields);
      setRetentionError(kept ? "" : "This quotation is too large for temporary recovery. Keep this page open; its latest edits cannot be recovered after navigation.");
    }
    setItems(fields.items); setTerms(fields.terms); setExpiry(fields.expiry); setDirty(true);
  }
  function updateItem(index: number, patch: Partial<Item>) {
    changeQuote({ items: liveFields.current.items.map((item, position) => position === index ? { ...item, ...patch } : item) });
  }
  async function restoreQuote() {
    const entry = draftMemory.getSnapshot();
    if (!entry?.fields || recoveryBusy) return;
    setRecoveryBusy(true);
    const checked = await checkRecovery(entry);
    const latest = draftMemory.getSnapshot();
    if (checked?.kind === "ready" && checked.lead && latest?.nonce === entry.nonce && latest.fields) {
      setData(previous => previous ? { ...previous, leads: [checked.lead!, ...previous.leads.filter(lead => lead.id !== checked.lead!.id)] } : previous);
      activeQuote.current = { nonce: latest.nonce, leadId: latest.leadId, baseRevision: latest.baseRevision };
      liveFields.current = structuredClone(latest.fields);
      setItems(liveFields.current.items); setTerms(liveFields.current.terms); setExpiry(liveFields.current.expiry);
      setSelectedId(latest.leadId); setView("quote"); setDirty(true); setRecovery(null); setError("");
      setFocusRequest(value => value + 1);
    }
    setRecoveryBusy(false);
  }
  async function reviewRetainedQuote() {
    const entry = draftMemory.getSnapshot();
    if (!entry || recoveryBusy) return;
    setRecoveryBusy(true);
    const checked = await checkRecovery(entry);
    if (checked?.lead) {
      const lead = checked.lead;
      setData(previous => previous ? { ...previous, leads: [lead, ...previous.leads.filter(item => item.id !== lead.id)] } : previous);
      setSelectedId(lead.id); setView("lead"); setDirty(false); activeQuote.current = null;
      setFocusRequest(value => value + 1);
    }
    setRecoveryBusy(false);
  }
  function discardRetainedQuote() {
    const entry = draftMemory.getSnapshot();
    if (!entry || entry.phase === "submitting") return;
    if (!window.confirm(entry.phase === "uncertain"
      ? "Discard this saved copy after reviewing the latest enquiry? This does not cancel a request that may still complete. Never automatically repeat the old save."
      : "Discard this unsaved quotation copy? This cannot be undone.")) return;
    draftMemory.clear(entry.nonce); setRecovery(null); setUncertain(false); setDirty(false); activeQuote.current = null;
    setItems([newItem()]); setTerms(""); setExpiry(""); setView(selectedId ? "lead" : "list");
    setFocusRequest(value => value + 1);
  }
  function customerAccessChanged() {
    // Revoke every outstanding reader synchronously, before React batches the cleared UI.
    // Otherwise an older permitted response could undo this newer access boundary.
    readGeneration.current += 1; recoveryCheck.current += 1; activationGeneration.current += 1; customerAccessGeneration.current += 1;
    listReadLock.current = false; dataRef.current = null; selectedIdRef.current = null;
    setLoading(false); setRecoveryBusy(false); setRecovery(null); setNotice(""); setRetentionError("");
    setUncertain(false); setUncertaintyReason(""); setListIds([]); setAppendedFocusId(null);
    customerMemory.reset(); actionMemory.reset();
    draftMemory.clear(); activeQuote.current = null;
    setContextChanged(true); setData(null); setView("list"); setSelectedId(null); setDirty(false);
    setItems([newItem()]); setTerms(""); setExpiry(""); setShare(""); setShareContext(""); setShareQuoteId(null);
    setError("Staff session or access changed. Reload this workspace before continuing.");
  }
  const customerName = (id: string) => data?.customers.find(customer => customer.id === id)?.name ?? "Customer record";
  const headingProps = { ref: heading, tabIndex: -1, className: "text-xl font-semibold scroll-mt-24" };

  return <div className="workspace-page sales-workspace">
    <header className="sales-header flex flex-wrap items-start justify-between gap-4">
      <div><p className="sales-eyebrow text-sm font-semibold">Sales workspace</p><h1 className="text-3xl font-semibold">Enquiries &amp; quotations</h1>
        <p className="mt-2 text-sm text-slate-600">Understand the request. Prepare a private proposal. Keep the next step clear.</p></div>
      {canCreate && <button ref={newButton} className={view === "new" || view === "quote" || recovery ? "btn" : "btn btn-primary"} disabled={locked} onClick={() => open("new", null)}>New enquiry</button>}
    </header>

    {error && <div ref={errorSummary} tabIndex={-1} role="alert" className="form-error space-y-3"><p>{error}</p>
      {contextChanged && <button className="btn" onClick={() => window.location.reload()}>Reload workspace</button>}
      {!contextChanged && !uncertain && !data && <button className="btn" disabled={loading || busy} onClick={() => void reload()}>{loading ? "Loading…" : "Reload latest status"}</button>}</div>}
    {!contextChanged && actionPending && <p role="status" className="panel p-5" data-sales-action-state="submitting">The previous save is still pending. Do not submit again. Wait for its outcome before continuing.</p>}
    {!contextChanged && uncertain && <div data-sales-action-state={actionWrite?.phase} ref={uncertaintySummary} tabIndex={-1} role="alert" className="form-error space-y-3"><p>{uncertaintyReason}</p><p>Changes remain locked across this workspace until the latest status is loaded.</p><button className="btn" disabled={loading || busy} onClick={() => void reload()}>{loading ? "Loading…" : "Reload latest status"}</button></div>}
    {notice && <p role="status" className="form-success">{notice}</p>}
    {data && view !== "new" && customerWrite && <section className="panel p-5 space-y-3" aria-label="Customer save review" data-customer-save-state={customerWrite.phase}>
      <h2 className="text-lg font-semibold">Review the customer save</h2>
      {customerPending ? <p role="status">The customer save is still pending. Do not create it again. Wait for the result before continuing.</p>
        : <><p role={customerWrite.phase === "uncertain" ? "alert" : "status"}>{customerWrite.phase === "created" ? "The customer was created. Check its current access before using it; do not create it again." : "The customer save outcome is unknown. It may have completed. Search current customers before any new creation; never repeat the earlier save."}</p>
          <button type="button" className="btn" disabled={locked} onClick={() => open("new", null)}>Review customer in new enquiry</button></>}
      <p className="text-sm text-slate-600">The enquiry was not saved. Only the customer-save outcome is retained in this signed-in tab, not the form fields.</p>
    </section>}
    {retentionError && <p role="alert" className="form-error">{retentionError}</p>}
    {recovery && retainedDraft && recovery.nonce === retainedDraft.nonce && <section className="panel p-5 space-y-3" aria-label="Quotation recovery" data-recovery-state={recovery.kind}>
      <h2 ref={recoveryHeading} tabIndex={-1} className="text-lg font-semibold scroll-mt-24">{["pending", "unknown"].includes(recovery.kind) ? "Review an unresolved quotation save" : "Recover an unsaved quotation"}</h2>
      {recovery.kind === "checking" && <p role="status">Checking your current access and the latest enquiry…</p>}
      {recovery.kind === "unavailable" && <><p role="alert">Access could not be rechecked. The copy stays hidden; retry before restoring it.</p><button className="btn btn-primary" disabled={recoveryBusy} onClick={() => void checkRecovery(retainedDraft)}>Retry recovery check</button></>}
      {recovery.lead && <>
        <p className="font-semibold break-words">{recovery.lead.title}</p>
        {recovery.kind === "ready" && <p>The enquiry is unchanged. Restore your quotation to continue editing; saving remains a separate action.</p>}
        {recovery.kind === "stale" && <p role="alert">The enquiry or a quotation changed while you were away. Your old copy is read-only and cannot overwrite the latest version.</p>}
        {recovery.kind === "pending" && <p role="alert">The previous quotation save is still pending. Do not submit again. Wait for its outcome and review the latest enquiry.</p>}
        {recovery.kind === "unknown" && <p role="alert">The previous save outcome is unknown. It may have completed. This copy cannot be restored or resubmitted; review the latest enquiry before discarding it.</p>}
        <div className="flex flex-wrap gap-3">
          {recovery.kind === "ready" && retainedDraft.fields && <button className="btn btn-primary" disabled={recoveryBusy} onClick={() => void restoreQuote()}>Restore quotation</button>}
          <button className={recovery.kind === "ready" ? "btn" : "btn btn-primary"} disabled={recoveryBusy} onClick={() => void reviewRetainedQuote()}>Review latest enquiry</button>
          <button className="btn" disabled={recoveryBusy || retainedDraft.phase === "submitting"} onClick={discardRetainedQuote}>Discard saved draft</button>
        </div>
        {retainedDraft.fields && recovery.kind !== "ready" && <details><summary className="cursor-pointer py-3 font-medium">Read retained text without applying it</summary><div className="space-y-3">
          {retainedDraft.fields.items.map((item, index) => <div key={index}><p className="font-semibold">Item {index + 1}</p><p className="whitespace-pre-wrap break-words">{item.description}</p><p>{item.quantity} × {money(item.priceMinor)} · Cost per unit {money(item.costMinor)}</p></div>)}
          <h3 className="font-semibold">Terms and inclusions</h3><p className="whitespace-pre-wrap break-words">{retainedDraft.fields.terms}</p><p>Original expiry (device local time): {retainedDraft.fields.expiry || "Not entered"}</p>
        </div></details>}
        {!retainedDraft.fields && <p>The temporary text copy has expired. The unresolved save still needs review.</p>}

      </>}
      <p className="text-sm text-slate-600">One temporary copy stays in this signed-in tab for 30 minutes after the last edit. Reloading, closing the tab or signing out clears it. Nothing is sent automatically.</p>
    </section>}
    {share && <section className="sales-private-link panel p-5 space-y-3" aria-label="Private proposal link">
      <h2 ref={shareHeading} tabIndex={-1} className="text-lg font-semibold scroll-mt-24">Private proposal link — copy before leaving</h2><p className="font-semibold break-words">For enquiry: {shareContext}</p>
      <p className="text-sm">Shown once. Copy it now and share only with the intended customer.</p>
      <details className="text-sm"><summary className="cursor-pointer py-2 font-medium">Private-link safety</summary><p>This link cannot be retrieved after reloading or hiding it. Losing it does not withdraw the proposal. Anyone with the link can view it; this is not a public package listing.</p></details>
      {uncertain && <p className="text-sm">Link status is unverified. Reload latest status before sharing.</p>}
      <div className="field text-sm font-medium"><label className="field-label" htmlFor="sales-private-link">Private proposal link</label><input id="sales-private-link" ref={shareInput} className="control mt-2" readOnly disabled={uncertain} value={share} onFocus={event => event.target.select()} /></div>
      <div className="sales-actions flex flex-wrap gap-2"><button className="btn" disabled={uncertain || busy} onClick={async () => {
        try { await navigator.clipboard.writeText(share); setNotice("Private link copied. Share it only with the intended customer."); }
        catch { shareInput.current?.focus(); shareInput.current?.select(); setNotice("Select and copy the private link manually."); }
      }}>Copy private link</button><button className="btn" onClick={() => {
        if (window.confirm("Hide this one-time link? Make sure you have copied it first.")) { setShare(""); setShareQuoteId(null); setShareContext(""); heading.current?.focus(); }
      }}>Hide link</button></div>
    </section>}

    {loading && !data && <p role="status" className="panel p-6">Loading your enquiries…</p>}
    {data && <>
      <form className="sales-toolbar flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void searchEnquiries(); }}>
        <div className="field min-w-0 flex-1 text-sm font-medium"><label className="field-label" htmlFor="sales-search">Search enquiries</label><input id="sales-search" ref={searchInput} className="control mt-1" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} placeholder="Customer name/code, destination or enquiry" aria-describedby="sales-list-status" /></div>
        <div className="field text-sm font-medium"><label className="field-label" htmlFor="sales-stage-filter">Filter by stage</label><select id="sales-stage-filter" className="control mt-1" value={filter} onChange={event => setFilter(event.target.value)}><option value="ALL">All stages</option>{SALES_STAGES.map(stage => <option key={stage} value={stage}>{enumLabel(stage)}</option>)}</select></div>
        <button className="btn btn-primary" disabled={locked || dirty}>Search all enquiries</button>
        {selected && view === "list" && <button type="button" className="btn" disabled={locked} onClick={() => open("lead", selected.id)}>View selected enquiry</button>}
        <button type="button" className="btn" aria-label="Refresh records" disabled={busy || customerPending || loading} onClick={() => void reload()}>{loading ? "Loading…" : "Refresh"}</button>
      </form>
      <p id="sales-list-status" role="status" className="text-sm text-slate-600">{visible.length} matching enquiries loaded{data.nextCursor ? " · More available below" : " · End of results"}. Search covers all permitted enquiries, not just this page. Newest enquiries first, 50 at a time.{query.trim() !== listCriteria.current.q || filter !== listCriteria.current.stage ? " Changed filters are not applied yet; choose Search all enquiries." : ""}{dirty ? " Save or close your edits before changing the list." : ""}</p>
      <div className="sales-layout grid gap-5" data-detail={view !== "list"}>
        <section className="sales-list panel overflow-hidden" aria-label="Enquiry list">
          <div className="border-b p-4"><h2 className="font-semibold">Your enquiry list</h2><p className="text-sm text-slate-600">Open one request to work on its next step.</p></div>
          {!visible.length && !listCriteria.current.q && listCriteria.current.stage === "ALL" ? <div className="p-6 space-y-3"><h3 className="font-semibold">No enquiries yet</h3><p className="text-sm">Start with an existing customer, then record their travel request.</p><Link className="btn" href="/customers">Open customers</Link></div>
            : !visible.length ? <div className="p-6 space-y-3"><h3 className="font-semibold">No matching enquiries</h3><p className="text-sm">Try a different customer, destination or stage. Your selected enquiry is still available.</p><button className="btn" disabled={locked || dirty} onClick={() => void searchEnquiries(true)}>Clear filters</button></div>
              : <ul className="divide-y">{visible.map(lead => <li key={lead.id}><button id={`sales-open-${lead.id}`} className={`sales-row w-full p-4 text-left ${selectedId === lead.id && view !== "new" ? "is-selected" : ""}`} aria-label={`Open enquiry: ${lead.title}`} aria-current={selectedId === lead.id && view !== "new" ? "true" : undefined} disabled={loading || busy} onClick={() => open("lead", lead.id)}>
                <span className="flex items-start justify-between gap-3 font-semibold"><span className="min-w-0 break-words">{lead.title}</span><span aria-hidden="true" className="shrink-0 text-brand-700">→</span></span><span className="block text-sm text-slate-600">{customerName(lead.customerId)} · {enumLabel(lead.product)}</span>
                <span className="sales-row-meta"><span className="pill">{enumLabel(lead.stage)}</span><span className="sales-row-followup"><span>{lead.followUpAt ? "Next follow-up" : "Follow-up not scheduled"}</span>{lead.followUpAt && <strong>{dateTimeLabel(lead.followUpAt)}</strong>}</span></span><span className="sales-row-action" aria-hidden="true">Open enquiry →</span>
              </button></li>)}</ul>}
          {data.nextCursor && <div className="border-t p-4"><button type="button" className="btn w-full" disabled={locked || dirty} onClick={() => void searchEnquiries(false, true)}>{loading ? "Loading enquiries…" : "Load more enquiries"}</button></div>}
        </section>
        <section className={`sales-record panel min-w-0 p-5 ${view === "quote" || view === "new" ? "sales-editor" : ""}`} aria-label="Selected enquiry">
          {view === "list" && <div className="py-10 space-y-3"><p className="sales-eyebrow text-sm font-semibold">One enquiry, one clear next step</p><h2 className="text-2xl font-semibold">Choose a request to get started</h2><p className="text-slate-600">Review the customer’s request, prepare a quotation, or follow up on a private proposal.</p><ol className="sales-lifecycle flex flex-wrap gap-3 text-sm"><li>1. Enquiry</li><li>2. Draft quotation</li><li>3. Private proposal</li><li>4. Accepted → CRM booking</li></ol></div>}
          {view !== "list" && <button className="btn mb-4" disabled={busy || customerPending || loading} onClick={() => open("list")}>Back to enquiries</button>}
          {view === "new" && <>
            <h2 {...headingProps}>New enquiry</h2><p className="mt-2 mb-5 text-sm text-slate-600">Choose an existing customer and record the request. This does not create a booking.</p><p className="mb-4 text-sm text-slate-600">Date/time fields use your device’s local time. Saved follow-up and expiry labels are shown in IST.</p>
            {caseContext?<><CaseReference record={caseContext}/><p className="text-sm mb-4">Customer: {caseContext.customerName} · {caseContext.customerCode}</p><input type="hidden" form="sales-new-enquiry" name="customer" value={caseContext.customerId}/></>:<EnquiryCustomerPicker key={`customer-${focusRequest}`} context={data.recoveryContext} initialCustomers={data.customers} disabled={locked}
              onDirty={() => setDirty(true)} onAccessChanged={customerAccessChanged} />}
            <form id="sales-new-enquiry" key={`new-${focusRequest}`} onChange={() => setDirty(true)} onSubmit={async event => {
              event.preventDefault(); const form = new FormData(event.currentTarget); const follow = String(form.get("follow") ?? ""); const travel = String(form.get("date") ?? "");
              const result = await action({ action: "create", data: { ...(caseContext?{serviceCaseId:caseContext.id}:{}),customerId: form.get("customer"), title: form.get("title"), source: form.get("source"), product: caseContext?.service??form.get("product"), budgetMinor: Math.round(Number(form.get("budget") ?? 0) * 100), destination: form.get("destination"), notes: form.get("notes"), followUpAt: follow ? new Date(follow).toISOString() : null, travelDate: travel ? new Date(travel).toISOString() : null } });
              if (result && typeof result.id === "string") { setSelectedId(result.id); setView("lead"); setFocusRequest(value => value + 1); }
            }}>
              <fieldset disabled={locked} className="space-y-4"><div className="sales-editor-grid grid gap-4 sm:grid-cols-2">
                <div className="field text-sm font-medium"><label className="field-label" htmlFor="sales-title">Enquiry title</label><input id="sales-title" className="control mt-1" name="title" defaultValue={caseContext?.title} required maxLength={200} /></div>
                <div className="field text-sm font-medium"><label className="field-label" htmlFor="sales-source">Source</label><input id="sales-source" className="control mt-1" name="source" required maxLength={100} placeholder="Website, referral, walk-in…" /></div>
                <div className="field text-sm font-medium"><label className="field-label" htmlFor="sales-product">Product</label><select id="sales-product" className="control mt-1" name="product" disabled={Boolean(caseContext)} defaultValue={caseContext?.service??"FLIGHT"}><option value="FLIGHT">Flight</option><option value="HOTEL">Hotel</option></select></div>
                <div className="field text-sm font-medium"><label className="field-label" htmlFor="sales-destination">Destination / route</label><input id="sales-destination" className="control mt-1" name="destination" maxLength={200} /></div>
                <div className="field text-sm font-medium"><label className="field-label" htmlFor="sales-travel-date">Travel date</label><input id="sales-travel-date" className="control mt-1" name="date" type="date" /></div>
                <div className="field text-sm font-medium"><label className="field-label" htmlFor="sales-follow-up">Follow-up deadline</label><input id="sales-follow-up" className="control mt-1" name="follow" type="datetime-local" /></div>
                {canQuote && <div className="field text-sm font-medium"><label className="field-label" htmlFor="sales-budget">Budget (INR)</label><input id="sales-budget" className="control mt-1" name="budget" type="number" min={0} max={20000000} step="0.01" /></div>}
              </div><div className="field text-sm font-medium"><label className="field-label" htmlFor="sales-notes">Notes</label><textarea id="sales-notes" className="control mt-1" name="notes" maxLength={4000} rows={4} /></div>
                <div className="sales-editor-footer sales-actions flex flex-wrap items-center gap-3"><button className="btn btn-primary">Save enquiry</button><button type="button" className="btn" onClick={() => open("list")}>Close enquiry</button><span className="text-sm">{dirty ? "Unsaved changes — keep this page open until saved." : "Not saved yet"}</span></div>
              </fieldset>
            </form>
          </>}
          {view !== "new" && view !== "list" && !selected && <p>This enquiry is no longer in the loaded view. Return to the enquiry list or refresh your permitted records.</p>}
          {selected && view === "lead" && <>
            <div className="sales-record-header space-y-3"><div className="flex flex-wrap items-center gap-2"><span className="pill">{enumLabel(selected.stage)}</span><span className="text-sm">{enumLabel(selected.product)}</span></div>
              <CaseReference record={selected.serviceCase}/><h2 {...headingProps}>{selected.title}</h2><p className="text-sm text-slate-600">{customerName(selected.customerId)} · {data.customers.find(customer => customer.id === selected.customerId)?.code ?? "Customer code unavailable"} · {selected.source}</p>
              <div className="sales-actions flex flex-wrap gap-2">{canQuote && canStartQuote(selected) && <button className={selected.quotes.length ? "btn" : "btn btn-primary"} disabled={locked} onClick={() => open("quote")}>New quote version</button>}<Link className="btn" href={`/customers/${selected.customerId}`}>Open customer</Link></div>
            </div>
            {nextStep && <section className="mt-5 rounded-xl border bg-slate-50 p-4 space-y-2" aria-label="Enquiry next step">
              <p className="sales-eyebrow text-sm font-semibold">Next step · based on the loaded record</p>
              <h3 className="font-semibold">{nextStep.title}</h3><p className="text-sm text-slate-600">{nextStep.detail}</p>
              {selected.stage === "LOST" && <p className="text-sm whitespace-pre-wrap break-words">Lost reason: {selected.lostReason || "Not recorded"}</p>}
              {nextStep.quoteId && <button type="button" className="btn" disabled={locked} onClick={() => {
                const target = document.getElementById(`sales-quote-${nextStep.quoteId}`);
                target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: "start", behavior: "instant" });
              }}>Review quote v{nextStep.version}</button>}
            </section>}
            <dl className="sales-summary grid gap-4 py-5 sm:grid-cols-2"><div><dt className="text-sm text-slate-600">Destination / route</dt><dd className="font-medium">{selected.destination || "Not recorded"}</dd></div><div><dt className="text-sm text-slate-600">Next follow-up</dt><dd className="font-medium">{selected.followUpAt ? dateTimeLabel(selected.followUpAt) : "Not set"}</dd></div><div><dt className="text-sm text-slate-600">Travel date</dt><dd className="font-medium">{selected.travelDate ? dateLabel(selected.travelDate) : "Not recorded"}</dd></div>{selected.budgetMinor !== null && selected.budgetMinor !== undefined && <div><dt className="text-sm text-slate-600">Customer budget</dt><dd className="font-medium">{money(selected.budgetMinor)}</dd></div>}</dl>{selected.notes && <section className="mb-5 space-y-2"><h3 className="font-semibold">Enquiry notes</h3><p className="whitespace-pre-wrap break-words text-sm">{selected.notes}</p></section>}
            {data.canEdit && selected.stage !== "WON" && <details className="border-y py-4"><summary className="cursor-pointer font-semibold">Update stage / follow-up</summary><form key={`${selected.id}:${selected.stage}:${selected.followUpAt}:${focusRequest}:${stageFormRevision}`} className="mt-4 space-y-4" onChange={() => setDirty(true)} onSubmit={async event => {
              event.preventDefault(); const form = new FormData(event.currentTarget); const follow = String(form.get("follow") ?? "");
              await action({ action: "stage", leadId: selected.id, baseRevision: selected.baseRevision, stage: form.get("stage"), lostReason: form.get("reason"), followUpAt: follow ? new Date(follow).toISOString() : null });
            }}><fieldset disabled={locked} className="sales-editor-grid grid gap-4 sm:grid-cols-2"><div className="field text-sm font-medium"><label className="field-label" htmlFor="sales-stage">Enquiry stage</label><select id="sales-stage" className="control mt-1" name="stage" defaultValue={selected.stage}>{SALES_STAGES.filter(stage => stage !== "WON").map(stage => <option key={stage} value={stage}>{enumLabel(stage)}</option>)}</select></div><div className="field text-sm font-medium"><label className="field-label" htmlFor="sales-next-follow-up">Next follow-up</label><input id="sales-next-follow-up" className="control mt-1" name="follow" type="datetime-local" defaultValue={localDateTime(selected.followUpAt)} /></div><div className="field text-sm font-medium sm:col-span-2"><label className="field-label" htmlFor="sales-lost-reason">Lost reason (required for Lost)</label><input id="sales-lost-reason" className="control mt-1" name="reason" maxLength={500} defaultValue={selected.lostReason ?? ""} /></div><button className="btn justify-self-start">Save stage / follow-up</button></fieldset></form></details>}
            <div className="mt-6 mb-4"><h3 className="text-lg font-semibold">Quotation history</h3><p className="text-sm text-slate-600">Drafts stay private. Publishing creates a private customer proposal, not a public package.</p></div>
            {!selected.quotes.length && <p className="py-4 text-slate-600">No quotations yet. Prepare the first version when the request is ready.</p>}
            <div className="sales-quote-list space-y-4">{selected.quotes.map(quote => <article key={quote.id} className="sales-quote rounded-xl border p-4 space-y-3">
              <div className="flex flex-wrap justify-between gap-2"><h4 id={`sales-quote-${quote.id}`} tabIndex={-1} className="font-semibold scroll-mt-24">Quote v{quote.version} · {enumLabel(quote.state)}</h4><span className="font-semibold tabular-nums">{money(quote.totalMinor)}</span></div>
              <p className="text-sm">{quoteExplanation(quote)}</p><p className="text-sm text-slate-600">{quoteExpiryLabel(quote)} {dateTimeLabel(quote.expiresAt)}</p>
              {canQuote && <p className="text-sm text-slate-600">Cost {money(quote.costMinor)} · Margin {money(quote.totalMinor !== null && quote.costMinor !== null ? quote.totalMinor - quote.costMinor : null)}</p>}
              {(!share || shareQuoteId !== quote.id) && privateLinkGuidance(selected, quote, canQuote) && <aside className="rounded-lg bg-slate-50 p-3 space-y-2" aria-label={`Private link guidance for quote v${quote.version}`}>
                <h5 className="font-semibold">Need the private proposal link?</h5><p className="text-sm">Earlier links cannot be retrieved. Losing a link does not withdraw the proposal.</p>
                <details className="text-sm"><summary className="cursor-pointer py-2 font-medium">Link safety &amp; replacement details</summary><p>{privateLinkGuidance(selected, quote, canQuote)}</p></details>
                {replacementQuoteAction(selected, quote, canQuote)?.kind === "review-draft" ? <button type="button" className="btn" disabled={locked} onClick={() => {
                  const next = replacementQuoteAction(selected, quote, canQuote);
                  if (next?.kind !== "review-draft") return;
                  const target = document.getElementById(`sales-quote-${next.quoteId}`);
                  target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: "start", behavior: "instant" });
                }}>Review latest draft</button> : replacementQuoteAction(selected, quote, canQuote)?.kind === "new-draft" && <button type="button" className="btn" disabled={locked} onClick={() => open("quote")}>Prepare replacement draft</button>}
              </aside>}
              <details className="text-sm"><summary className="cursor-pointer font-medium">View quotation details</summary><div className="mt-3 space-y-3">{quote.items?.length ? <ol className="space-y-3">{quote.items.map((item, position) => <li key={position}><p className="whitespace-pre-wrap break-words">{item.description}</p><p className="text-slate-600">{item.quantity} × {money(item.priceMinor)}{canQuote ? ` · Cost per unit ${money(item.costMinor)}` : ""}</p></li>)}</ol> : <p>Line-item amounts are not available in this view.</p>}<h5 className="font-semibold">Terms and inclusions</h5><p className="whitespace-pre-wrap break-words">{quote.terms}</p></div></details>
              <div className="sales-actions flex flex-wrap gap-2">{canQuote && quote.state === "DRAFT" && <button className="btn btn-primary" disabled={locked || !canPublishQuote(selected, quote)} onClick={() => {
                if (window.confirm("Publish this private proposal? Any earlier published proposal link will stop working.")) void action({ action: "publish", leadId: selected.id, quoteId: quote.id });
              }}>Publish private proposal</button>}
                {canQuote && data.canConvert && quote.state === "ACCEPTED" && !quote.bookingId && <button className="btn btn-primary" disabled={locked || hasConflictingAcceptedQuotes(selected) || ["WON", "LOST"].includes(selected.stage)} onClick={() => void action({ action: "convert", leadId: selected.id, quoteId: quote.id })}>Create CRM booking from accepted quote</button>}
                {quote.state === "ACCEPTED" && !quote.bookingId && selected.stage === "LOST" && <p className="text-sm">Reopen this enquiry before creating a CRM booking.</p>}
                {quote.state === "ACCEPTED" && !quote.bookingId && selected.stage === "WON" && <p className="text-sm">This enquiry is already won. Review its recorded booking before proceeding.</p>}
                {quote.bookingId && <Link className="btn btn-primary" href={`/ticketing/${quote.bookingId}`}>Open linked booking</Link>}
                {canQuote && !quote.bookingId && !["WITHDRAWN", "SUPERSEDED"].includes(quote.state) && <button className="btn" disabled={locked} onClick={() => { if (window.confirm(`Withdraw quote v${quote.version} (${enumLabel(quote.state)}) for ${selected.title}? This invalidates its customer link.${quote.state === "ACCEPTED" ? " The customer has accepted this version. Review their agreement before withdrawing; the acceptance evidence remains recorded." : ""}`)) void action({ action: "withdraw", leadId: selected.id, quoteId: quote.id, baseRevision: selected.baseRevision }); }}>Withdraw quote</button>}
              </div>{quote.state === "DRAFT" && !canPublishQuote(selected, quote) && <p className="text-sm">Publishing requires the latest, unexpired draft and an open enquiry.</p>}
            </article>)}</div>
          </>}
          {selected && view === "quote" && <>
            <h2 {...headingProps}>Quotation · {selected.title}</h2><p className="mt-2 mb-4 text-sm text-slate-600">New private draft. Saving does not publish or send it.</p>
            <section className="sales-quote-orientation" aria-label="Quotation overview">
              <div><span className="text-sm">Draft total · {items.length} {items.length === 1 ? "item" : "items"}</span><strong className="sales-draft-total">{money(items.reduce((total, item) => total + item.quantity * item.priceMinor, 0))}</strong></div>
              <div className="sales-quote-route"><p className="text-sm">1. Itinerary &amp; prices <span aria-hidden="true">→</span> 2. Validity &amp; terms <span aria-hidden="true">→</span> Save draft</p><button type="button" className="btn" disabled={locked} onClick={() => { const field = document.getElementById("sales-quote-expiry"); field?.focus({ preventScroll: true }); field?.scrollIntoView({ block: "center", behavior: "instant" }); }}>Continue to validity &amp; terms</button></div>
            </section>
            <form onSubmit={async event => { event.preventDefault();
              const total = items.reduce((sum, item) => sum + item.quantity * item.priceMinor, 0);
              const cost = items.reduce((sum, item) => sum + item.quantity * item.costMinor, 0);
              if (total <= 0 || total > 2000000000 || cost > 2000000000) { setError("Quotation total must be above zero and no more than ₹20,000,000. Total cost must also be within this limit."); return; }
              if (new Date(expiry).getTime() <= Date.now()) { setError("Choose a future quotation expiry."); return; }
              const result = await action({ action: "quote", leadId: selected.id, baseRevision: activeQuote.current?.baseRevision, items, terms, expiresAt: new Date(expiry).toISOString() }); if (result) { setView("lead"); setFocusRequest(value => value + 1); } }}>
              <fieldset disabled={locked} className="space-y-5">{items.map((item, index) => <fieldset key={index} className="sales-line-item rounded-xl border p-4 space-y-3"><legend className="px-2 font-semibold">Item {index + 1}</legend>
                <div className="field text-sm font-medium"><label className="field-label" htmlFor={`sales-item-${index}-description`}>Description / itinerary</label><textarea id={`sales-item-${index}-description`} className="control mt-1" required maxLength={500} rows={3} value={item.description} onChange={event => updateItem(index, { description: event.target.value })} /></div>
                <div className="sales-line-fields grid gap-3 sm:grid-cols-3"><div className="field text-sm font-medium"><label className="field-label" htmlFor={`sales-item-${index}-quantity`}>Quantity</label><input id={`sales-item-${index}-quantity`} className="control mt-1" type="number" required min={1} max={1000} step={1} value={item.quantity} onChange={event => updateItem(index, { quantity: Number(event.target.value) })} /></div><div className="field text-sm font-medium"><label className="field-label" htmlFor={`sales-item-${index}-price`}>Price per unit (INR)</label><input id={`sales-item-${index}-price`} className="control mt-1" type="number" required min={0} max={1000000} step="0.01" value={item.priceMinor / 100} onChange={event => updateItem(index, { priceMinor: Math.round(Number(event.target.value) * 100) })} /></div><div className="field text-sm font-medium"><label className="field-label" htmlFor={`sales-item-${index}-cost`}>Cost per unit (INR)</label><input id={`sales-item-${index}-cost`} className="control mt-1" type="number" required min={0} max={1000000} step="0.01" value={item.costMinor / 100} onChange={event => updateItem(index, { costMinor: Math.round(Number(event.target.value) * 100) })} /></div></div>
                {items.length > 1 && <button className="btn" type="button" aria-label={`Remove item ${index + 1}`} onClick={() => { changeQuote({ items: liveFields.current.items.filter((_, position) => position !== index) }); addItemButton.current?.focus(); }}>Remove item</button>}
              </fieldset>)}
                <button ref={addItemButton} type="button" className="btn" disabled={items.length >= 100} onClick={() => { changeQuote({ items: [...liveFields.current.items, newItem()] }); }}>Add item</button>
                <div className="field text-sm font-medium"><label className="field-label" htmlFor="sales-quote-expiry">Valid until</label><p id="sales-quote-expiry-help" className="text-sm text-slate-600">Enter your device’s local time; saved expiry labels are shown in IST.</p><input id="sales-quote-expiry" aria-describedby="sales-quote-expiry-help" className="control mt-1" type="datetime-local" required value={expiry} onChange={event => { changeQuote({ expiry: event.target.value }); }} /></div>
                <div className="field text-sm font-medium"><label className="field-label" htmlFor="sales-quote-terms">Terms and inclusions</label><textarea id="sales-quote-terms" className="control mt-1" required maxLength={10000} rows={6} value={terms} onChange={event => { changeQuote({ terms: event.target.value }); }} /></div>
                <div className="sales-editor-footer space-y-3"><p className="font-semibold">Quotation total {money(items.reduce((total, item) => total + item.quantity * item.priceMinor, 0))}</p><div className="sales-actions flex flex-wrap gap-3"><button className="btn btn-primary">Save draft version</button><button type="button" className="btn" onClick={() => open("lead")}>Close quotation</button></div><p className="text-sm text-slate-600">{dirty ? "Unsaved changes — save or explicitly discard before leaving." : "New draft — not yet saved or shared."}</p><p className="text-sm text-slate-600">A temporary quotation copy supports Back/Forward recovery in this signed-in tab for up to 30 minutes. Reloading, closing the tab or signing out clears that copy.</p></div>
              </fieldset>
            </form>
          </>}
        </section>
      </div>
    </>}
  </div>;
}
