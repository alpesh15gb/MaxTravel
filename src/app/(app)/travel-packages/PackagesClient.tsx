"use client";
import PackageMediaLibrary from "./PackageMediaLibrary";
import "./packages-editor.css";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { EmptyState, Field, PageHeader, Status } from "@/components/ui";
import { emptyPackage, PACKAGE_IMAGE_HELP, validatePackage, slugSchema, type PackageDraft } from "@/lib/travel-packages";
import { usePackageDraftEntry, usePackageDraftMemory } from "@/components/PackageDraftProvider";
import { PACKAGE_EDITOR_SECTIONS, packageRecoveryKind, packageWriteAcknowledgement, readPackageEditorItem, type PackageEditorItem, type PackageDraftEntry, type PackageDraftFields, type PackageDraftKey } from "@/lib/package-draft-memory";

type Item = PackageEditorItem;
type CatalogueItem = Omit<Item, "draft"> & { destination: string; durationDays: number };
const catalogueItem = ({ draft, ...meta }: Item): CatalogueItem => ({ ...meta, destination: draft.destination, durationDays: draft.durationDays });
const sections = PACKAGE_EDITOR_SECTIONS;
type Section = typeof sections[number];
type Recovery = { nonce: string; kind: "checking" | "ready" | "stale" | "pending" | "unknown" | "unavailable"; item?: Item | null };
export default function PackagesClient() {
  const memory = usePackageDraftMemory(); const retained = usePackageDraftEntry();
  const activeDraft = useRef<PackageDraftKey | null>(null);
  const live = useRef<PackageDraftFields>({ slug: "", draft: structuredClone(emptyPackage), section: "Overview" });
  const activation = useRef(0), catalogueRead = useRef(0), recoveryRead = useRef(0);
  const [authorized, setAuthorized] = useState(false), [recovery, setRecovery] = useState<Recovery | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false), [retentionError, setRetentionError] = useState("");
  const recoveryHeading = useRef<HTMLHeadingElement>(null);
  const [items, setItems] = useState<CatalogueItem[]>([]); const [loading, setLoading] = useState(true); const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null); const [editing, setEditing] = useState(false);
  const [editorFocusRequest, setEditorFocusRequest] = useState(0);
  const [draft, setDraft] = useState<PackageDraft>(structuredClone(emptyPackage)); const [slug, setSlug] = useState("");
  const [section, setSection] = useState<Section>("Overview"); const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [search, setSearch] = useState(""); const [truncated, setTruncated] = useState(false);
  const mutationLock = useRef(false);
  const editorElement = useRef<HTMLElement>(null); const actionBar = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null); const errorSummary = useRef<HTMLDivElement>(null); const createButton = useRef<HTMLButtonElement>(null);
  const revoke = useCallback((message: string) => {
    activation.current += 1; catalogueRead.current += 1; recoveryRead.current += 1;
    memory.clear(); activeDraft.current = null; setAuthorized(false); setRecovery(null); setItems([]); setSelected(null); setEditing(false); setDirty(false);
    setLoading(false); setLoadFailed(true); setBusy(false); setRecoveryBusy(false);
    setDraft(structuredClone(emptyPackage)); setSlug(""); live.current = { slug: "", draft: structuredClone(emptyPackage), section: "Overview" }; setError(message);
  }, [memory]);
  const checkRecovery = useCallback(async (entry: PackageDraftEntry): Promise<Recovery | null> => {
    const generation = activation.current, read = ++recoveryRead.current;
    setRecovery({ nonce: entry.nonce, kind: "checking" });
    try {
      const suffix = entry.packageId ? `/${encodeURIComponent(entry.packageId)}` : entry.fields && slugSchema.safeParse(entry.fields.slug).success ? `?draftSlug=${encodeURIComponent(entry.fields.slug)}` : "";
      const response = await fetch(`/api/travel-packages${suffix}`, { cache: "no-store" }); const body = await response.json();
      if (generation !== activation.current || read !== recoveryRead.current || memory.getSnapshot()?.nonce !== entry.nonce) return null;
      if ([401, 403, 404].includes(response.status)) {
        memory.clear(entry.nonce); setRecovery(null);
        if (response.status !== 404) revoke("Staff session or package access changed. Reload this workspace before continuing.");
        else setError("The retained copy was cleared because this package is no longer available.");
        return null;
      }
      if (!response.ok) throw Error();
      if (body.recoveryContext !== memory.context) { revoke("Staff session or access changed. The retained package copy was cleared. Reload this workspace before continuing."); return null; }
      memory.expire(); const current = memory.getSnapshot(); if (!current || current.nonce !== entry.nonce) { setRecovery(null); return null; }
      const item = body.package == null ? null : readPackageEditorItem(body.package);
      if (body.package != null && !item) throw Error();
      const kind = packageRecoveryKind(current, body.recoveryContext, item);
      if (kind === "denied" || kind === "expired") { memory.clear(entry.nonce); setRecovery(null); return null; }
      const checked = { nonce: entry.nonce, kind, item }; setRecovery(checked); return checked;
    } catch {
      if (generation === activation.current && read === recoveryRead.current && memory.getSnapshot()?.nonce === entry.nonce) setRecovery({ nonce: entry.nonce, kind: "unavailable" });
      return null;
    }
  }, [memory, revoke]);
  const load = useCallback(async () => {
    const generation = activation.current, read = ++catalogueRead.current;
    setLoading(true); setLoadFailed(false); setError("");
    try {
      const r = await fetch("/api/travel-packages", { cache: "no-store" }); const b = await r.json();
      if (generation !== activation.current || read !== catalogueRead.current) return;
      if ([401, 403].includes(r.status) || (r.ok && b.recoveryContext !== memory.context)) { revoke("Staff session or package access changed. Reload this workspace before continuing."); setLoadFailed(true); return; }
      if (!r.ok) throw new Error(b.error || "Could not load packages.");
      setAuthorized(true); setItems(b.packages); setTruncated(b.truncated);
      const entry = memory.getSnapshot(); if (entry && activeDraft.current?.nonce !== entry.nonce) await checkRecovery(entry);
    }
    catch (e) { if (generation === activation.current && read === catalogueRead.current) { setLoadFailed(true); setError(e instanceof Error ? e.message : "Could not load packages."); } }
    finally { if (generation === activation.current && read === catalogueRead.current) setLoading(false); }
  }, [memory, revoke, checkRecovery]);
  const resetWorkspace = useCallback(() => {
    activation.current += 1; catalogueRead.current += 1; recoveryRead.current += 1;
    setAuthorized(false); setItems([]); setEditing(false); setSelected(null); setDirty(false); setRecovery(null); setBusy(false); setRecoveryBusy(false); setRetentionError("");
    setError(""); setNotice(""); setSearch(""); setTruncated(false); setLoading(true);
    activeDraft.current = null; live.current = { slug: "", draft: structuredClone(emptyPackage), section: "Overview" }; setDraft(live.current.draft); setSlug(""); setSection("Overview");
  }, []);
  useLayoutEffect(() => {
    resetWorkspace(); memory.expire(); void load();
    // A cross-document BFCache return does not remount React/Activity. Remove
    // private fields before its snapshot, then require fresh access on pageshow.
    const hide = () => { flushSync(resetWorkspace); };
    const show = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      flushSync(() => { memory.leaveDocument(true); resetWorkspace(); });
      memory.expire(); void load();
    };
    window.addEventListener("pagehide", hide); window.addEventListener("pageshow", show);
    return () => { window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); activation.current += 1; catalogueRead.current += 1; recoveryRead.current += 1; };
  }, [load, memory, resetWorkspace]);
  useEffect(() => {
    if (!recovery) return;
    if (!retained) { setRecovery(null); void load(); return; }
    if (retained.nonce !== recovery.nonce) return;
    if (retained.phase === "submitting" && recovery.kind !== "pending" && !["checking", "unavailable"].includes(recovery.kind)) void checkRecovery(retained);
    if (retained.phase === "uncertain" && recovery.kind !== "unknown" && !["checking", "unavailable"].includes(recovery.kind)) void checkRecovery(retained);
    if (retained.phase === "editing" && ["pending", "unknown"].includes(recovery.kind)) void checkRecovery(retained);
  }, [retained, recovery, load, checkRecovery]);
  useEffect(() => { if (recovery && recovery.kind !== "checking") recoveryHeading.current?.focus(); }, [recovery]);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);
  useEffect(() => {
    const editor = editorElement.current; const actions = actionBar.current;
    if (!editing || !editor || !actions) return;
    // Wrapped actions/text resizing change the sticky bar's height. This only
    // changes focus-scroll clearance, never layout size, so it cannot resize-loop.
    const measure = () => editor.style.setProperty("--package-actions-height", `${Math.ceil(actions.getBoundingClientRect().height)}px`);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(actions); window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [editing]);
  useEffect(() => {
    if (!editorFocusRequest) return;
    // Commit the editor before focusing, then reveal its first fields below the fixed workspace header.
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [editorFocusRequest]);
  useEffect(() => {
    const confirmNavigation = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if ((!dirty && !busy) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download") || anchor.href === window.location.href || anchor.getAttribute("href")?.startsWith("#")) return;
      if (busy || !window.confirm("Discard unsaved package edits and leave this page?")) { event.preventDefault(); event.stopPropagation(); }
      else if (activeDraft.current) { memory.clear(activeDraft.current.nonce); activeDraft.current = null; setDirty(false); }
    };
    document.addEventListener("click", confirmNavigation, true);
    return () => document.removeEventListener("click", confirmNavigation, true);
  }, [dirty, busy, memory]);
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => { if (dirty || busy) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, busy]);
  const unresolved = Boolean(retained && (retained.phase !== "editing" || activeDraft.current?.nonce !== retained.nonce));
  const locked = !authorized || busy || recoveryBusy || unresolved;
  function beginEditor(item: Item | null, fields?: PackageDraftFields, key?: PackageDraftKey) {
    const next = fields ?? { slug: item?.slug ?? "", draft: structuredClone(item?.draft ?? emptyPackage), section: "Overview" as const };
    activeDraft.current = key ?? { nonce: globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}-${Math.random()}`, packageId: item?.id ?? null, revision: item?.revision ?? null };
    live.current = structuredClone(next); setSelected(item); setDraft(next.draft); setSlug(next.slug); setSection(next.section); setEditing(true); setDirty(Boolean(fields)); setRetentionError("");
    setEditorFocusRequest(request => request + 1);
  }
  function retainFields(next: PackageDraftFields) {
    live.current = next;
    if (activeDraft.current && !memory.retain(activeDraft.current, next)) setRetentionError("This temporary copy exceeds the recovery limit. Keep this page open and save or copy your edits before leaving.");
    else setRetentionError("");
  }
  function closeEditor() {
    if (mutationLock.current || retained?.phase === "submitting" || (dirty && !window.confirm("Discard your unsaved edits?"))) return;
    if (activeDraft.current) memory.clear(activeDraft.current.nonce);
    activeDraft.current = null; setEditing(false); setDirty(false); setSelected(null); setDraft(structuredClone(emptyPackage)); setSlug(""); setRetentionError("");
    createButton.current?.focus();
  }
  async function restoreDraft() {
    const entry = memory.getSnapshot(); if (!entry || recoveryBusy) return;
    const generation = activation.current; setRecoveryBusy(true);
    try {
      const checked = await checkRecovery(entry), latest = memory.getSnapshot();
      if (generation !== activation.current || checked?.kind !== "ready" || latest?.nonce !== entry.nonce || !latest.fields || latest.phase !== "editing") return;
      beginEditor(checked.item ?? null, latest.fields, { nonce: latest.nonce, packageId: latest.packageId, revision: latest.revision }); setRecovery(null);
      setNotice("Unsaved package edits restored. Review and save the draft when ready. Nothing has been saved or published automatically.");
    } finally { if (generation === activation.current) setRecoveryBusy(false); }
  }
  async function discardRecovery() {
    const entry = memory.getSnapshot(); if (!entry || entry.phase === "submitting" || recoveryBusy) return;
    if (!window.confirm(entry.phase === "uncertain" ? "Discard this retained copy? The previous action may have completed. Review the latest package or matching slug in the catalogue before creating or changing anything." : "Discard the retained unsaved package copy?")) return;
    memory.clear(entry.nonce); setRecovery(null); setDirty(false); activeDraft.current = null; void load();
  }
  async function open(meta: CatalogueItem | null) {
    if (locked || loading || (dirty && !window.confirm("Discard your unsaved edits?"))) return;
    const generation = activation.current;
    setBusy(true); setError("");
    try {
      let item: Item | null = null;
      if (meta) {
        const response = await fetch(`/api/travel-packages/${meta.id}`, { cache: "no-store" }); const body = await response.json();
        if (generation !== activation.current) return;
        if ([401, 403].includes(response.status) || (response.ok && body.recoveryContext !== memory.context)) { revoke("Staff session or package access changed. Reload this workspace before continuing."); return; }
        if (!response.ok) throw new Error(body.error || "Could not open this package."); item = readPackageEditorItem(body.package); if (!item) throw new Error("Could not verify this package. Please reload.");
      }
      if (generation !== activation.current) return;
      if (activeDraft.current) memory.clear(activeDraft.current.nonce);
      beginEditor(item); setNotice("");
    } catch (e) { if (generation === activation.current) setError(e instanceof Error ? e.message : "Could not open this package. Please retry."); }
    finally { if (generation === activation.current) setBusy(false); }
  }
  function update<K extends keyof PackageDraft>(key: K, value: PackageDraft[K]) { const next = { ...live.current, draft: { ...live.current.draft, [key]: value } }; retainFields(next); setDraft(next.draft); setDirty(true); setNotice(""); }
  function changeSection(next: Section) { if (locked) return; live.current = { ...live.current, section: next }; if (dirty) retainFields(live.current); setSection(next); }
  async function save(action: string) {
    if (locked || mutationLock.current || !activeDraft.current) return;
    if (["SAVE", "PUBLISH"].includes(action) && memory.getSnapshot()?.omittedImageUrls) { setError("Review the omitted image fields in Images and acknowledge your choices before saving or publishing."); changeSection("Images"); return; }
    const normalized = { ...draft, inclusions: draft.inclusions.map(s => s.trim()).filter(Boolean), exclusions: draft.exclusions.map(s => s.trim()).filter(Boolean) };
    if (["SAVE", "PUBLISH"].includes(action)) {
      const checked = validatePackage(normalized, action === "PUBLISH");
      if (checked.errors.length) { setError(checked.errors.join("\n")); return; }
    }
    const confirm: Record<string, string> = {
      PUBLISH: "Publish this version to the customer website? All fields except internal notes become public. This does not create bookable inventory.",
      UNPUBLISH: "Remove this package from the customer website? The editable draft will be retained.",
      ARCHIVE: "Archive this package and remove it from the customer website? You can restore it later.",
      RESTORE: "Restore this package as a private draft? It will not be published automatically.",
    };
    if (confirm[action] && !window.confirm(confirm[action])) return;
    const key = activeDraft.current, generation = activation.current;
    if (!memory.retain(key, live.current) || !memory.beginSubmit(key.nonce, action)) { setRetentionError("This action cannot be safely tracked. Keep a copy of your edits and reload the latest package before continuing."); return; }
    mutationLock.current = true; setBusy(true); setError(""); setNotice("");
    let acknowledged = false;
    try {
      const r = await fetch(`/api/travel-packages${selected ? `/${selected.id}` : ""}`, { method: selected ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, slug, draft: normalized, revision: selected?.revision, expectedRecoveryContext: memory.context }) });
      const b = await r.json();
      if (!r.ok) {
        if (r.status >= 500) throw new Error("unknown");
        memory.settle(key.nonce, "rejected");
        if ([401, 403, 404].includes(r.status)) {
          memory.clear(key.nonce);
          if (generation === activation.current) revoke("Staff session or permitted package changed. The local copy was cleared. Reload this workspace before continuing.");
        } else if (generation === activation.current) {
          setError(b.error || "The action was not applied. Check the fields and latest version.");
          if (r.status === 409) { activeDraft.current = null; setEditing(false); setDirty(false); const entry = memory.getSnapshot(); if (entry) await checkRecovery(entry); }
        }
        return;
      }
      const saved = packageWriteAcknowledgement(b, memory.context, key, slug);
      if (!saved) throw new Error("Malformed acknowledgement");
      acknowledged = true;
      // A held write response can belong to the previous cookie/session. Never
      // reveal it directly: verify current access and context with a fresh read.
      const latestResponse = await fetch(`/api/travel-packages/${encodeURIComponent(saved.id)}`, { cache: "no-store" });
      const latest = await latestResponse.json();
      if ([401, 403, 404].includes(latestResponse.status) || (latestResponse.ok && latest.recoveryContext !== memory.context)) {
        memory.clear(key.nonce);
        if (generation === activation.current) revoke("Staff session or access changed. Reload the workspace to review the completed action.");
        return;
      }
      const item = readPackageEditorItem(latest.package);
      if (!latestResponse.ok || !item || item.id !== saved.id || item.revision < saved.revision) throw new Error("Acknowledged action needs verification");
      memory.settle(key.nonce, "acknowledged");
      if (generation !== activation.current) return;
      setRecovery(null); setItems(all => [catalogueItem(item), ...all.filter(i => i.id !== item.id)]);
      beginEditor(item); setDirty(false);
      setNotice(action === "PUBLISH" ? "Published version is available to the website. Open the customer page to verify it." : action === "SAVE" ? "Draft saved. Any published version is unchanged." : action === "RESTORE" ? "Restored as a private draft." : "No longer publicly available from the catalogue. Your draft is retained.");
    } catch (e) {
      void e;
      memory.settle(key.nonce, acknowledged ? "unverified" : "uncertain");
      if (generation === activation.current) {
        activeDraft.current = null; setEditing(false); setDirty(false); setError(acknowledged ? "The action was acknowledged, but its latest state could not be verified. Do not repeat it. Review the latest package before continuing." : "The action outcome is unknown. It may have completed. Review the latest package before doing anything again; this copy cannot be resubmitted.");
        const entry = memory.getSnapshot(); if (entry) await checkRecovery(entry);
      }
    } finally { mutationLock.current = false; if (generation === activation.current) setBusy(false); }
  }
  const filtered = items.filter(i => `${i.title} ${i.destination} ${i.status}`.toLowerCase().includes(search.toLowerCase()));
  const field = (key: keyof PackageDraft, label: string, opts: { area?: boolean; type?: string; hint?: string; max?: number } = {}) => <Field label={label} hint={opts.hint}>{opts.area ? <textarea className="control min-h-28" maxLength={opts.max ?? 8000} value={String(draft[key])} onChange={e => update(key, e.target.value as never)} /> : <input className="control" type={opts.type ?? "text"} maxLength={opts.max ?? 1500} value={String(draft[key])} onChange={e => update(key, e.target.value as never)} />}</Field>;
  const publicationErrors = validatePackage({ ...draft, inclusions: draft.inclusions.filter(s => s.trim()), exclusions: draft.exclusions.filter(s => s.trim()) }, true).errors;
  return <div className="workspace-page package-studio package-workspace-polish" data-editing={editing}>
    <PageHeader eyebrow="Public catalogue" title="Travel packages" description="Build the draft here. Choose when customers see the published version." actions={<button ref={createButton} className={editing ? "btn-secondary" : "btn-primary"} disabled={locked || loading || loadFailed} onClick={() => open(null)}>+ Create package</button>} />
    {!editing && <div className="package-catalogue-summary" aria-label="Catalogue status">{[["Published", items.filter(i => i.status === "PUBLISHED").length], ["Private drafts", items.filter(i => i.status === "DRAFT").length], ["Archived", items.filter(i => i.status === "ARCHIVED").length]].map(([label, count]) => <div key={label} className="package-summary-item"><p>{label}</p><p className="package-summary-value">{loading || loadFailed ? "—" : count}</p></div>)}</div>}
    {error && <div ref={errorSummary} tabIndex={-1} role="alert" className="mb-4 whitespace-pre-line rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</div>}
    {notice && <div role="status" className="mb-4 rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">{notice}</div>}
    {retentionError && <p role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">{retentionError}</p>}
    {authorized && retained && recovery?.nonce === retained.nonce && <section aria-label="Retained package draft" data-recovery-state={recovery.kind} className="mb-5 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-5">
      <h2 ref={recoveryHeading} tabIndex={-1} className="text-lg font-semibold">Review your retained package copy</h2>
      {recovery.kind === "checking" ? <p role="status">Checking the current staff session, package access and saved revision…</p> : recovery.kind === "unavailable" ? <><p>The latest package could not be checked. Retained text stays hidden until access is confirmed.</p><button className="btn-secondary" disabled={recoveryBusy} onClick={() => void checkRecovery(retained)}>Retry package recovery check</button></> : <>
        {recovery.kind === "ready" && <p>Unsaved edits are available in this signed-in tab. Restore them only if you want to continue; nothing is saved or published automatically.</p>}
        {recovery.kind === "stale" && <p role="alert">The saved package changed, was archived, or this slug now belongs to a saved package. This old copy is read-only and cannot overwrite the latest version.</p>}
        {recovery.kind === "pending" && <p role="alert">The previous {retained.action?.toLowerCase()} action is still pending. Do not submit again. Wait for its result, then review the latest package.</p>}
        {recovery.kind === "unknown" && <p role="alert">{retained.acknowledged ? "The previous action was acknowledged, but its latest state has not been verified." : `The previous ${retained.action?.toLowerCase()} outcome is unknown and may have completed.`} This copy cannot be restored or resubmitted. Review the latest package or matching catalogue slug before discarding it.</p>}
        {recovery.item && <p className="font-medium">Latest saved package: {recovery.item.title} · revision {recovery.item.revision} · {recovery.item.status}</p>}
        {retained.omittedImageUrls && <p role="alert">Invalid or private image links were excluded from this temporary copy. Re-select those images after restoring; private preview links are never retained.</p>}
        <div className="flex flex-wrap gap-3">
          {recovery.kind === "ready" && retained.fields && <button className="btn-primary" disabled={recoveryBusy} onClick={() => void restoreDraft()}>Restore package edits</button>}
          <button className="btn-secondary" disabled={recoveryBusy} onClick={() => void checkRecovery(retained)}>Review latest package</button>
          <button className="btn-secondary" disabled={recoveryBusy || retained.phase === "submitting"} onClick={() => void discardRecovery()}>Discard retained package copy</button>
        </div>
        {retained.fields && recovery.kind !== "ready" && <details><summary className="cursor-pointer py-2 font-medium">Read retained text without applying it</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm">{JSON.stringify(retained.fields, null, 2)}</pre></details>}
        {!retained.fields && <p>The temporary text is no longer retained. The unresolved action still needs review.</p>}
      </>}
      <p className="text-sm text-slate-600">One copy stays only in this signed-in tab for 30 minutes after the last edit. Leaving or reloading this document clears the temporary text; unresolved actions still need review if this page returns from browser memory. Back and Forward do not save or publish anything.</p>
    </section>}
    <div className={`package-workspace grid gap-6 ${editing ? "xl:grid-cols-[280px_minmax(0,1fr)]" : ""}`}>
      <section aria-label="Package catalogue" className="package-catalogue min-w-0">
        <label className="field mb-4"><span className="field-label">Find a package</span><input className="control" type="search" placeholder="Title, destination or status" value={search} onChange={e => setSearch(e.target.value)} /></label>
        {truncated && <p className="mb-3 text-sm text-amber-800">Showing the 250 most recently updated packages.</p>}
        {loading ? <p role="status" className="p-6 text-slate-500">Loading your catalogue…</p> : loadFailed ? <EmptyState title="Catalogue unavailable" description="We could not load your packages. Retry before creating or editing content." action="Retry loading" onAction={() => void load()} /> : !items.length ? <EmptyState title="Your next great trip starts here" description="Create a private draft. Add itinerary, honest pricing and enquiry details before publishing." action="Create your first package" onAction={() => open(null)} /> : !filtered.length ? <EmptyState title="No matching packages" description="Try a different title, destination or status." /> : <div className={`grid gap-3 ${editing ? "" : "md:grid-cols-2 xl:grid-cols-3"}`}>{filtered.map(i => <button key={i.id} aria-current={selected?.id === i.id ? "true" : undefined} disabled={locked} onClick={() => open(i)} className={`package-catalogue-card rounded-2xl border bg-white p-5 text-left transition hover:border-teal-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 ${selected?.id === i.id ? "border-teal-600 ring-1 ring-teal-600" : "border-slate-200"}`}><Status tone={i.status === "PUBLISHED" ? "success" : "neutral"}>{i.status === "PUBLISHED" ? "Published" : i.status === "ARCHIVED" ? "Archived" : "Private draft"}</Status><h2 className="mt-3 break-words font-semibold text-slate-900">{i.title}</h2><p className="mt-1 text-sm text-slate-500">{i.destination || "Destination to add"} · {i.durationDays} days</p>{i.hasUnpublishedChanges && <p className="mt-3 text-xs font-medium text-amber-800">Unpublished changes</p>}<p className="mt-3 text-xs text-slate-500">/{i.slug}</p></button>)}</div>}
        {!loading && !loadFailed && error && !editing && <button className="btn-secondary mt-3" onClick={() => void load()}>Retry loading</button>}
      </section>
      {authorized && editing && <section ref={editorElement} className="package-editor min-w-0 rounded-2xl border border-slate-200 bg-white" aria-label="Package editor">
        <div className="package-editor-heading border-b border-slate-200 p-5">
          <div className="package-editor-identity"><div className="min-w-0"><h2 ref={heading} tabIndex={-1} className="scroll-mt-24 text-xl font-semibold">{selected ? selected.title : "New package"}</h2><p className="package-editor-purpose">Enquiry only · No instant booking</p></div><button className="btn-ghost" disabled={busy} onClick={closeEditor}>Close editor</button></div>
          {dirty && <p className="mt-3 text-sm text-slate-600">Unsaved edits: a temporary copy can be recovered after Back/Forward within this workspace, subject to a fresh access and version check. Leaving this document, reloading or signing out clears the text.</p>}
          {retained?.nonce === activeDraft.current?.nonce && retained?.omittedImageUrls && <p role="alert" className="mt-3 text-sm text-amber-800">Some image links were omitted from temporary recovery. Review the Images section before saving or publishing. <button className="underline font-medium" onClick={() => changeSection("Images")}>Review image fields</button></p>}
          <div className="package-version-context" role="group" aria-label="Package version status">
            <p className="package-draft-state"><span>Private draft</span>{" "}<strong>{dirty ? "Unsaved edits" : selected?.status === "ARCHIVED" ? "Archived" : selected ? "Saved" : "Not saved yet"}</strong>{selected && <span> · {dirty ? "Last saved revision" : "Revision"} {selected.revision}</span>}</p>
            <details className="package-publication"><summary>Website: {selected?.status === "PUBLISHED" ? "Published snapshot" : "Not published"}{selected?.status === "PUBLISHED" && (dirty || selected.hasUnpublishedChanges) ? " · Draft changes pending" : ""}</summary><p>{selected?.status === "PUBLISHED" ? "The website uses a separate approved snapshot, not the private draft revision above. Saving this draft leaves that snapshot unchanged. Republish when the updated content is ready for customers." : "Only an explicit publication makes this package public. Saving or restoring a draft does not publish it. A package enquiry is never an instant booking confirmation."}</p></details>
          </div>
          <div className="package-section-picker field"><label className="field-label" htmlFor="package-edit-section">Edit section</label><select id="package-edit-section" className="control" value={section} disabled={locked} onChange={e => changeSection(e.target.value as Section)}>{sections.map(s => <option key={s} value={s}>{s === "Pricing & dates" ? "Pricing" : s === "Terms & contact" ? "Terms" : s}</option>)}</select></div>
          <div role="group" aria-label="Editor sections" className="package-section-tabs mt-5 flex flex-wrap gap-2">{sections.map(s => <button key={s} className={section === s ? "btn-primary" : "btn-secondary"} aria-pressed={section === s} disabled={locked} onClick={() => changeSection(s)}>{s}</button>)}</div>
        </div>
        <fieldset disabled={locked || selected?.status === "ARCHIVED"} className="min-w-0 space-y-5 p-5 sm:p-6"><legend className="sr-only">{section}</legend>
          {section === "Overview" && <>
            <div className="grid gap-4 md:grid-cols-2">{field("title", "Package title", { max: 120 })}{field("destination", "Destination / region", { max: 120 })}</div>
            <Field label="Public URL slug" hint={selected?.publishedAt ? "Locked after first publication so customer links remain stable." : "Lowercase words and hyphens, e.g. kerala-backwaters-5-days."}><input className="control" value={slug} disabled={!!selected?.publishedAt} maxLength={100} onChange={e => { retainFields({ ...live.current, slug: e.target.value }); setSlug(e.target.value); setDirty(true); }} /></Field>
            {field("summary", "Short introduction", { area: true, max: 280, hint: "Up to 280 characters for the catalogue card." })}{field("description", "The experience", { area: true, hint: "Plain text only. Describe what makes this trip special without promising unconfirmed arrangements." })}
            <div className="grid gap-4 sm:grid-cols-2">{(["durationDays", "durationNights"] as const).map(k => <Field key={k} label={k === "durationDays" ? "Days" : "Nights"}><input className="control" type="number" min={k === "durationDays" ? 1 : 0} max={60} value={draft[k]} onChange={e => update(k, Number(e.target.value))} /></Field>)}</div>
            {field("internalNotes", "Internal notes — never published", { area: true, max: 6000, hint: "Private staff planning notes. Do not place private details in other fields." })}
          </>}
          {section === "Itinerary" && <>
            <div><h3 className="font-semibold">Day by day</h3><p className="mt-1 text-sm text-slate-500">A complete itinerary is required for publication. Changes to days do not remove existing entries.</p></div>
            {draft.itinerary.map((day, index) => <div key={index} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-end gap-3"><Field label="Day"><input className="control w-24" type="number" min={1} max={draft.durationDays} value={day.day} onChange={e => update("itinerary", draft.itinerary.map((it, n) => n === index ? { ...it, day: Number(e.target.value) } : it))} /></Field><button className="btn-ghost ml-auto" onClick={() => { update("itinerary", draft.itinerary.filter((_, n) => n !== index)); window.setTimeout(() => document.getElementById("add-itinerary-day")?.focus(), 0); }}>Remove day {day.day}</button></div><Field label="Day title"><input className="control" maxLength={160} value={day.title} onChange={e => update("itinerary", draft.itinerary.map((it, n) => n === index ? { ...it, title: e.target.value } : it))} /></Field><Field label="Plan and arrangements"><textarea className="control min-h-28" maxLength={2000} value={day.description} onChange={e => update("itinerary", draft.itinerary.map((it, n) => n === index ? { ...it, description: e.target.value } : it))} /></Field></div>)}
            <button id="add-itinerary-day" className="btn-secondary" disabled={draft.itinerary.length >= draft.durationDays} onClick={() => update("itinerary", [...draft.itinerary, { day: Array.from({ length: draft.durationDays }, (_, i) => i + 1).find(n => !draft.itinerary.some(i => i.day === n)) ?? 1, title: "", description: "" }])}>+ Add itinerary day</button>
            <div className="grid gap-4 md:grid-cols-2">{(["inclusions", "exclusions"] as const).map(k => <Field key={k} label={k === "inclusions" ? "What's included" : "What's not included"} hint="One item per line. Be specific about flights, meals, transfers and taxes."><textarea className="control min-h-40" value={draft[k].join("\n")} onChange={e => update(k, e.target.value.split("\n"))} /></Field>)}</div>
          </>}
          {section === "Pricing & dates" && <>
            <div className="rounded-xl bg-teal-50 p-4 text-sm text-teal-900">All published prices are starting estimates, not live quotes or inventory. Expired prices automatically become “Price on request”.</div>
            <div className="grid gap-4 md:grid-cols-2"><Field label="Pricing basis"><select className="control" value={draft.priceBasis} onChange={e => { update("priceBasis", e.target.value as PackageDraft["priceBasis"]); if (e.target.value === "ON_REQUEST") update("priceAmount", null); }}>{[["ON_REQUEST", "On request"], ["PER_PERSON", "Per person"], ["PER_COUPLE", "Per couple"], ["PER_GROUP", "Per group"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field><Field label="Currency"><select className="control" value={draft.currency} onChange={e => update("currency", e.target.value as PackageDraft["currency"])}>{["INR", "USD", "AED", "EUR", "GBP"].map(v => <option key={v}>{v}</option>)}</select></Field><Field label="Starting price" hint="Major currency units, e.g. 15000 INR, not paise."><input className="control" type="number" min="0.01" step="0.01" disabled={draft.priceBasis === "ON_REQUEST"} value={draft.priceAmount ?? ""} onChange={e => update("priceAmount", e.target.value ? Number(e.target.value) : null)} /></Field>{field("priceValidUntil", "Price valid until (UTC)", { type: "date", hint: "Valid through this date in UTC. Expired prices become on request." })}</div>
            {field("priceNotes", "Pricing assumptions", { area: true, max: 1500, hint: "Required with a price: occupancy, group size, hotel category, child rates and applicable supplements." })}<label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={draft.taxesIncluded} onChange={e => update("taxesIncluded", e.target.checked)} /> Displayed starting price includes applicable taxes</label>
            <Field label="Travel availability"><select className="control" value={draft.availability} onChange={e => update("availability", e.target.value as PackageDraft["availability"])}><option value="ON_REQUEST">On request</option><option value="SEASONAL">Seasonal</option><option value="UNAVAILABLE">Unavailable</option></select></Field><div className="grid gap-4 sm:grid-cols-2">{field("travelStart", "Travel window starts", { type: "date" })}{field("travelEnd", "Travel window ends", { type: "date" })}</div>{field("availabilityNotes", "Availability and date guidance", { area: true, max: 1500, hint: "Clarify blackout dates, departure arrangements and that all availability is confirmed by the team." })}
          </>}
          {section === "Terms & contact" && <>
            {field("terms", "Booking terms", { area: true, max: 6000 })}{field("cancellationPolicy", "Cancellation and changes", { area: true, max: 4000, hint: "Explain deadlines, supplier conditions and what the customer must confirm before paying." })}
            <h3 className="font-semibold">Public enquiry contact</h3><p className="text-sm text-slate-500">At least one is required. These contact details will be visible to customers. No booking or payment is taken by this catalogue.</p>
            <div className="grid gap-4 md:grid-cols-2">{field("contactEmail", "Enquiry email", { type: "email", max: 160 })}{field("contactPhone", "Phone", { type: "tel", hint: "International format: +919876543210", max: 24 })}{field("contactWhatsapp", "WhatsApp", { type: "tel", hint: "International format, with country code", max: 24 })}</div>
          </>}
          {section === "Images" && <>
            {retained?.nonce === activeDraft.current?.nonce && retained?.omittedImageUrls && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4"><p>Private or unsupported image links are not retained. Re-select the intended cover and gallery images, or consciously leave them empty to remove them. Saving and publishing stay blocked until you review these fields.</p><button className="btn-secondary mt-3" onClick={() => { if (activeDraft.current && memory.acknowledgeImages(activeDraft.current.nonce, live.current)) setError(""); else setError("Replace or remove unsupported image links before acknowledging the review."); }}>I reviewed the image fields</button></div>}
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Use approved public image URLs you have permission to use, not private CRM documents or signed links. Images are optional; the website uses a neutral visual when absent. {PACKAGE_IMAGE_HELP} Remote URLs are never fetched by the CRM server.</p>
            <PackageMediaLibrary key={selected?.id ?? "new"} packageId={selected?.id} disabled={locked || selected?.status === "ARCHIVED"} selectedCover={draft.coverImageUrl} galleryFull={draft.gallery.length >= 12} onCover={url => { update("coverImageUrl", url); update("coverImageAlt", ""); }} onGallery={url => update("gallery", [...draft.gallery, { url, alt: "" }])} />
            {field("coverImageUrl", "Cover image URL")}{field("coverImageAlt", "Cover image description", { max: 180, hint: "Describe the scene for customers using screen readers." })}
            {draft.gallery.map((img, i) => <div className="space-y-3 rounded-xl border border-slate-200 p-4" key={i}><Field label={`Gallery image ${i + 1} URL`}><input className="control" type="text" value={img.url} onChange={e => update("gallery", draft.gallery.map((v, n) => n === i ? { ...v, url: e.target.value } : v))} /></Field><Field label="Image description"><input className="control" maxLength={180} value={img.alt} onChange={e => update("gallery", draft.gallery.map((v, n) => n === i ? { ...v, alt: e.target.value } : v))} /></Field><button className="btn-ghost" onClick={() => { update("gallery", draft.gallery.filter((_, n) => n !== i)); window.setTimeout(() => document.getElementById("add-gallery-image")?.focus(), 0); }}>Remove image {i + 1}</button></div>)}<button id="add-gallery-image" className="btn-secondary" disabled={draft.gallery.length >= 12} onClick={() => update("gallery", [...draft.gallery, { url: "", alt: "" }])}>+ Add gallery image</button>
          </>}
          {section === "Preview" && <>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Text-only draft preview — not the published website. Image URLs and descriptions are listed below, but images are not rendered here. Internal notes are excluded. Review the final customer website after publication.</div>
            <p className="text-sm font-medium uppercase tracking-wide text-teal-700">{draft.destination || "Destination"} · {draft.durationDays} days / {draft.durationNights} nights</p><h3 className="text-3xl font-semibold">{draft.title || "Your package title"}</h3><p className="text-lg text-slate-600">{draft.summary}</p><p className="whitespace-pre-wrap text-slate-600">{draft.description}</p>
            <div className="rounded-xl bg-slate-50 p-5"><p className="text-xl font-semibold">{draft.priceBasis === "ON_REQUEST" ? "Price on request" : `From ${draft.currency} ${draft.priceAmount ?? "—"} ${draft.priceBasis.toLowerCase().replaceAll("_", " ")}`}</p><p className="mt-2 text-sm">{draft.priceNotes}</p><p className="mt-2 text-sm text-slate-500">Subject to confirmation · {draft.taxesIncluded ? "Taxes included" : "Check applicable taxes with the team"}</p></div>
            {[...draft.itinerary].sort((a, b) => a.day - b.day).map(day => <div key={day.day}><h4 className="font-semibold">Day {day.day} · {day.title}</h4><p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{day.description}</p></div>)}
            <div className="grid gap-5 md:grid-cols-2">{(["inclusions", "exclusions"] as const).map(k => <div key={k}><h4 className="font-semibold">{k === "inclusions" ? "Included" : "Not included"}</h4><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{draft[k].filter(Boolean).map((v, i) => <li key={i}>{v}</li>)}</ul></div>)}</div>
            <div className="rounded-xl border border-slate-200 p-4"><h4 className="font-semibold">Travel dates and availability</h4><p className="mt-2 text-sm">{draft.availability.replaceAll("_", " ")} · {draft.travelStart || "Start on request"} to {draft.travelEnd || "End on request"} (UTC date boundaries)</p><p className="mt-2 whitespace-pre-wrap text-sm">{draft.availabilityNotes}</p>{draft.priceValidUntil && <p className="mt-2 text-sm">Starting price valid through {draft.priceValidUntil} UTC</p>}</div>
            <details><summary className="cursor-pointer font-semibold">Images and descriptions ({(draft.coverImageUrl ? 1 : 0) + draft.gallery.length})</summary>{[...(draft.coverImageUrl ? [{ url: draft.coverImageUrl, alt: draft.coverImageAlt }] : []), ...draft.gallery].map((image, i) => <p key={i} className="mt-2 break-all text-sm">{image.alt || "Image description missing"} — {image.url}</p>)}</details>
            <details><summary className="cursor-pointer font-semibold">Terms and cancellation policy</summary><p className="mt-3 whitespace-pre-wrap text-sm">{draft.terms}</p><p className="mt-3 whitespace-pre-wrap text-sm">{draft.cancellationPolicy}</p></details><p className="text-sm">Enquiries: {[draft.contactEmail, draft.contactPhone, draft.contactWhatsapp && `WhatsApp ${draft.contactWhatsapp}`].filter(Boolean).join(" · ") || "Contact details required"}</p>
            <div className="rounded-xl border border-slate-200 p-4"><h4 className="font-semibold">Publish checklist</h4>{publicationErrors.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-900">{publicationErrors.map((e, i) => <li key={i}>{e}</li>)}</ul> : <p className="mt-2 text-sm text-teal-800">Required content is complete. Review accuracy, image rights and public contact details before publishing.</p>}</div>
          </>}
        </fieldset>
        {selected && selected.status !== "ARCHIVED" && <details className="package-secondary-actions">
          <summary>More actions</summary>
          <p>Hide this package from customers without deleting the draft.{dirty ? " Save or discard your unsaved edits first." : " Each action asks for confirmation."}</p>
          <div>{selected.status === "PUBLISHED" && <button className="btn-secondary" disabled={locked || dirty} title={dirty ? "Save or discard edits first" : undefined} onClick={() => void save("UNPUBLISH")}>Unpublish</button>}<button className="btn-secondary" disabled={locked || dirty} title={dirty ? "Save or discard edits first" : undefined} onClick={() => void save("ARCHIVE")}>Archive</button></div>
        </details>}
        <div ref={actionBar} className="flex flex-wrap items-center gap-2 rounded-b-2xl border-t border-slate-200 bg-slate-50 p-5">
          {selected?.status !== "ARCHIVED" ? <><button className="btn-primary" disabled={locked} onClick={() => void save("SAVE")}>{busy ? "Working…" : "Save draft"}</button><button className="btn-secondary" disabled={locked || !selected} onClick={() => void save("PUBLISH")}>{selected?.status === "PUBLISHED" ? "Republish changes" : "Publish to website"}</button>{!selected && <span className="text-xs text-slate-500">Save once before publishing.</span>}</> : <><p className="mr-auto text-sm text-slate-500">Archived and hidden from customers. Restore to edit.</p><button className="btn-primary" disabled={locked} onClick={() => void save("RESTORE")}>Restore as draft</button></>}
        </div>
      </section>}
    </div>
  </div>;
}
