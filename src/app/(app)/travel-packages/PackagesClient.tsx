"use client";
import PackageMediaLibrary from "./PackageMediaLibrary";
import "./packages-editor.css";
import { useEffect, useRef, useState } from "react";
import { EmptyState, Field, PageHeader, Status } from "@/components/ui";
import { emptyPackage, PACKAGE_IMAGE_HELP, validatePackage, type PackageDraft } from "@/lib/travel-packages";

type Item = { id: string; slug: string; title: string; status: string; revision: number; publishedAt: string | null; updatedAt: string; draft: PackageDraft; hasUnpublishedChanges: boolean };
type CatalogueItem = Omit<Item, "draft"> & { destination: string; durationDays: number };
const catalogueItem = ({ draft, ...meta }: Item): CatalogueItem => ({ ...meta, destination: draft.destination, durationDays: draft.durationDays });
const sections = ["Overview", "Itinerary", "Pricing & dates", "Terms & contact", "Images", "Preview"] as const;
type Section = typeof sections[number];
export default function PackagesClient() {
  const [items, setItems] = useState<CatalogueItem[]>([]); const [loading, setLoading] = useState(true); const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null); const [editing, setEditing] = useState(false);
  const [editorFocusRequest, setEditorFocusRequest] = useState(0);
  const [draft, setDraft] = useState<PackageDraft>(structuredClone(emptyPackage)); const [slug, setSlug] = useState("");
  const [section, setSection] = useState<Section>("Overview"); const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false); const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [search, setSearch] = useState(""); const [truncated, setTruncated] = useState(false);
  const mutationLock = useRef(false);
  const editorElement = useRef<HTMLElement>(null); const actionBar = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null); const errorSummary = useRef<HTMLDivElement>(null); const createButton = useRef<HTMLButtonElement>(null);
  async function load() {
    setLoading(true); setLoadFailed(false); setError("");
    try { const r = await fetch("/api/travel-packages", { cache: "no-store" }); const b = await r.json(); if (!r.ok) throw new Error(b.error || "Could not load packages."); setItems(b.packages); setTruncated(b.truncated); setUncertain(false); }
    catch (e) { setLoadFailed(true); setError(e instanceof Error ? e.message : "Could not load packages."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
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
      if (!dirty || !(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download") || anchor.href === window.location.href || anchor.getAttribute("href")?.startsWith("#")) return;
      if (!window.confirm("Discard unsaved package edits and leave this page?")) { event.preventDefault(); event.stopPropagation(); }
    };
    document.addEventListener("click", confirmNavigation, true);
    return () => document.removeEventListener("click", confirmNavigation, true);
  }, [dirty]);
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  async function open(meta: CatalogueItem | null) {
    if (busy || uncertain || (dirty && !window.confirm("Discard your unsaved edits?"))) return;
    setBusy(true); setError("");
    try {
      let item: Item | null = null;
      if (meta) {
        const response = await fetch(`/api/travel-packages/${meta.id}`, { cache: "no-store" }); const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not open this package."); item = body.package;
      }
      setSelected(item); setDraft(structuredClone(item?.draft ?? emptyPackage)); setSlug(item?.slug ?? ""); setEditing(true); setSection("Overview"); setDirty(false); setNotice("");
      setEditorFocusRequest(request => request + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open this package. Please retry."); }
    finally { setBusy(false); }
  }
  function update<K extends keyof PackageDraft>(key: K, value: PackageDraft[K]) { setDraft(d => ({ ...d, [key]: value })); setDirty(true); setNotice(""); }
  async function save(action: string) {
    if (busy || uncertain || mutationLock.current) return;
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
    mutationLock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch(`/api/travel-packages${selected ? `/${selected.id}` : ""}`, { method: selected ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, slug, draft: normalized, revision: selected?.revision }) });
      const b = await r.json();
      if (!r.ok) { if (r.status >= 500 || r.status === 409) setUncertain(true); throw new Error(b.error || "Could not complete the action."); }
      const item: Item = b.package; setItems(all => [catalogueItem(item), ...all.filter(i => i.id !== item.id)]); setSelected(item); setDraft(item.draft); setSlug(item.slug); setDirty(false);
      setNotice(action === "PUBLISH" ? "Published version is available to the website. Open the customer page to verify it." : action === "SAVE" ? "Draft saved. Any published version is unchanged." : action === "RESTORE" ? "Restored as a private draft." : "No longer publicly available from the catalogue. Your draft is retained.");
    } catch (e) {
      if (e instanceof TypeError || e instanceof SyntaxError) { setUncertain(true); setError("The response was interrupted. The action may have completed. Reload the catalogue and reopen this package before trying again."); }
      else setError(e instanceof Error ? e.message : "Could not complete the action. Reload to check its status before retrying.");
    } finally { mutationLock.current = false; setBusy(false); }
  }
  const filtered = items.filter(i => `${i.title} ${i.destination} ${i.status}`.toLowerCase().includes(search.toLowerCase()));
  const field = (key: keyof PackageDraft, label: string, opts: { area?: boolean; type?: string; hint?: string; max?: number } = {}) => <Field label={label} hint={opts.hint}>{opts.area ? <textarea className="control min-h-28" maxLength={opts.max ?? 8000} value={String(draft[key])} onChange={e => update(key, e.target.value as never)} /> : <input className="control" type={opts.type ?? "text"} maxLength={opts.max ?? 1500} value={String(draft[key])} onChange={e => update(key, e.target.value as never)} />}</Field>;
  const publicationErrors = validatePackage({ ...draft, inclusions: draft.inclusions.filter(s => s.trim()), exclusions: draft.exclusions.filter(s => s.trim()) }, true).errors;
  return <div className="workspace-page package-studio package-workspace-polish" data-editing={editing}>
    <PageHeader eyebrow="Public catalogue" title="Travel packages" description="Build the draft here. Choose when customers see the published version." actions={<button ref={createButton} className={editing ? "btn-secondary" : "btn-primary"} disabled={busy || uncertain || loading || loadFailed} onClick={() => open(null)}>+ Create package</button>} />
    {!editing && <div className="package-catalogue-summary" aria-label="Catalogue status">{[["Published", items.filter(i => i.status === "PUBLISHED").length], ["Private drafts", items.filter(i => i.status === "DRAFT").length], ["Archived", items.filter(i => i.status === "ARCHIVED").length]].map(([label, count]) => <div key={label} className="package-summary-item"><p>{label}</p><p className="package-summary-value">{loading || loadFailed ? "—" : count}</p></div>)}</div>}
    {error && <div ref={errorSummary} tabIndex={-1} role="alert" className="mb-4 whitespace-pre-line rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</div>}
    {notice && <div role="status" className="mb-4 rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">{notice}</div>}
    {uncertain && <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">Keep a copy of any unsaved edits, then reload and reopen the package to reconcile its latest version. <button className="btn-secondary mt-2" onClick={() => { if (!dirty || window.confirm("Reload latest state and discard local edits?")) { setEditing(false); setDirty(false); void load(); } }}>Reload catalogue</button></div>}
    <div className={`package-workspace grid gap-6 ${editing ? "xl:grid-cols-[280px_minmax(0,1fr)]" : ""}`}>
      <section aria-label="Package catalogue" className="package-catalogue min-w-0">
        <label className="field mb-4"><span className="field-label">Find a package</span><input className="control" type="search" placeholder="Title, destination or status" value={search} onChange={e => setSearch(e.target.value)} /></label>
        {truncated && <p className="mb-3 text-sm text-amber-800">Showing the 250 most recently updated packages.</p>}
        {loading ? <p role="status" className="p-6 text-slate-500">Loading your catalogue…</p> : loadFailed ? <EmptyState title="Catalogue unavailable" description="We could not load your packages. Retry before creating or editing content." action="Retry loading" onAction={() => void load()} /> : !items.length ? <EmptyState title="Your next great trip starts here" description="Create a private draft. Add itinerary, honest pricing and enquiry details before publishing." action="Create your first package" onAction={() => open(null)} /> : !filtered.length ? <EmptyState title="No matching packages" description="Try a different title, destination or status." /> : <div className={`grid gap-3 ${editing ? "" : "md:grid-cols-2 xl:grid-cols-3"}`}>{filtered.map(i => <button key={i.id} aria-current={selected?.id === i.id ? "true" : undefined} disabled={busy || uncertain} onClick={() => open(i)} className={`package-catalogue-card rounded-2xl border bg-white p-5 text-left transition hover:border-teal-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 ${selected?.id === i.id ? "border-teal-600 ring-1 ring-teal-600" : "border-slate-200"}`}><Status tone={i.status === "PUBLISHED" ? "success" : "neutral"}>{i.status === "PUBLISHED" ? "Published" : i.status === "ARCHIVED" ? "Archived" : "Private draft"}</Status><h2 className="mt-3 break-words font-semibold text-slate-900">{i.title}</h2><p className="mt-1 text-sm text-slate-500">{i.destination || "Destination to add"} · {i.durationDays} days</p>{i.hasUnpublishedChanges && <p className="mt-3 text-xs font-medium text-amber-800">Unpublished changes</p>}<p className="mt-3 text-xs text-slate-500">/{i.slug}</p></button>)}</div>}
        {!loading && !loadFailed && error && !editing && <button className="btn-secondary mt-3" onClick={() => void load()}>Retry loading</button>}
      </section>
      {editing && <section ref={editorElement} className="package-editor min-w-0 rounded-2xl border border-slate-200 bg-white" aria-label="Package editor">
        <div className="package-editor-heading border-b border-slate-200 p-5">
          <div className="package-editor-identity"><div className="min-w-0"><h2 ref={heading} tabIndex={-1} className="scroll-mt-24 text-xl font-semibold">{selected ? selected.title : "New package"}</h2><p className="package-editor-purpose">Enquiry only · No instant booking</p></div><button className="btn-ghost" disabled={busy} onClick={() => { if (!dirty || window.confirm("Discard your unsaved edits?")) { setEditing(false); setDirty(false); window.setTimeout(() => createButton.current?.focus(), 0); } }}>Close editor</button></div>
          <div className="package-version-context" role="group" aria-label="Package version status">
            <p className="package-draft-state"><span>Private draft</span>{" "}<strong>{dirty ? "Unsaved edits" : selected?.status === "ARCHIVED" ? "Archived" : selected ? "Saved" : "Not saved yet"}</strong>{selected && <span> · {dirty ? "Last saved revision" : "Revision"} {selected.revision}</span>}</p>
            <details className="package-publication"><summary>Website: {selected?.status === "PUBLISHED" ? "Published snapshot" : "Not published"}{selected?.status === "PUBLISHED" && (dirty || selected.hasUnpublishedChanges) ? " · Draft changes pending" : ""}</summary><p>{selected?.status === "PUBLISHED" ? "The website uses a separate approved snapshot, not the private draft revision above. Saving this draft leaves that snapshot unchanged. Republish when the updated content is ready for customers." : "Only an explicit publication makes this package public. Saving or restoring a draft does not publish it. A package enquiry is never an instant booking confirmation."}</p></details>
          </div>
          <label className="package-section-picker field"><span className="field-label">Edit section</span><select className="control" value={section} onChange={e => setSection(e.target.value as Section)}>{sections.map(s => <option key={s} value={s}>{s === "Pricing & dates" ? "Pricing" : s === "Terms & contact" ? "Terms" : s}</option>)}</select></label>
          <div role="group" aria-label="Editor sections" className="package-section-tabs mt-5 flex flex-wrap gap-2">{sections.map(s => <button key={s} className={section === s ? "btn-primary" : "btn-secondary"} aria-pressed={section === s} onClick={() => setSection(s)}>{s}</button>)}</div>
        </div>
        <fieldset disabled={busy || uncertain || selected?.status === "ARCHIVED"} className="min-w-0 space-y-5 p-5 sm:p-6"><legend className="sr-only">{section}</legend>
          {section === "Overview" && <>
            <div className="grid gap-4 md:grid-cols-2">{field("title", "Package title", { max: 120 })}{field("destination", "Destination / region", { max: 120 })}</div>
            <Field label="Public URL slug" hint={selected?.publishedAt ? "Locked after first publication so customer links remain stable." : "Lowercase words and hyphens, e.g. kerala-backwaters-5-days."}><input className="control" value={slug} disabled={!!selected?.publishedAt} maxLength={100} onChange={e => { setSlug(e.target.value); setDirty(true); }} /></Field>
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
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Use approved public image URLs you have permission to use, not private CRM documents or signed links. Images are optional; the website uses a neutral visual when absent. {PACKAGE_IMAGE_HELP} Remote URLs are never fetched by the CRM server.</p>
            <PackageMediaLibrary key={selected?.id ?? "new"} packageId={selected?.id} disabled={busy || uncertain || selected?.status === "ARCHIVED"} selectedCover={draft.coverImageUrl} galleryFull={draft.gallery.length >= 12} onCover={url => { update("coverImageUrl", url); update("coverImageAlt", ""); }} onGallery={url => update("gallery", [...draft.gallery, { url, alt: "" }])} />
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
          <div>{selected.status === "PUBLISHED" && <button className="btn-secondary" disabled={busy || uncertain || dirty} title={dirty ? "Save or discard edits first" : undefined} onClick={() => void save("UNPUBLISH")}>Unpublish</button>}<button className="btn-secondary" disabled={busy || uncertain || dirty} title={dirty ? "Save or discard edits first" : undefined} onClick={() => void save("ARCHIVE")}>Archive</button></div>
        </details>}
        <div ref={actionBar} className="flex flex-wrap items-center gap-2 rounded-b-2xl border-t border-slate-200 bg-slate-50 p-5">
          {selected?.status !== "ARCHIVED" ? <><button className="btn-primary" disabled={busy || uncertain} onClick={() => void save("SAVE")}>{busy ? "Working…" : "Save draft"}</button><button className="btn-secondary" disabled={busy || uncertain || !selected} onClick={() => void save("PUBLISH")}>{selected?.status === "PUBLISHED" ? "Republish changes" : "Publish to website"}</button>{!selected && <span className="text-xs text-slate-500">Save once before publishing.</span>}</> : <><p className="mr-auto text-sm text-slate-500">Archived and hidden from customers. Restore to edit.</p><button className="btn-primary" disabled={busy || uncertain} onClick={() => void save("RESTORE")}>Restore as draft</button></>}
        </div>
      </section>}
    </div>
  </div>;
}
