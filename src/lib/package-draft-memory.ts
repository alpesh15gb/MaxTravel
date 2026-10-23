import { safePackageImage, validatePackage, type PackageDraft } from "./travel-packages";

/** Private, tab-lifetime copy. Never serialize this store to storage or telemetry. */
export const PACKAGE_DRAFT_TTL = 30 * 60 * 1000;
export const PACKAGE_DRAFT_MAX_BYTES = 250_000;
export const PACKAGE_EDITOR_SECTIONS = ["Overview", "Itinerary", "Pricing & dates", "Terms & contact", "Images", "Preview"] as const;
export type PackageEditorSection = typeof PACKAGE_EDITOR_SECTIONS[number];
export type PackageDraftFields = { slug: string; draft: PackageDraft; section: PackageEditorSection };
export type PackageDraftKey = { nonce: string; packageId: string | null; revision: number | null };
export type PackageDraftEntry = PackageDraftKey & { context: string; fields: PackageDraftFields | null; omittedImageUrls: boolean; updatedAt: number; phase: "editing" | "submitting" | "uncertain"; action: string | null; acknowledged: boolean };

const strings = { title: 120, destination: 120, summary: 280, description: 8000, priceNotes: 1500, priceValidUntil: 40, travelStart: 40, travelEnd: 40, availabilityNotes: 1500, terms: 6000, cancellationPolicy: 4000, coverImageAlt: 180, contactEmail: 160, contactPhone: 24, contactWhatsapp: 24, internalNotes: 6000 } as const;
/** Projection, not validation: incomplete edits can recover, extra/private fields cannot. */
export function projectPackageDraft(fields: PackageDraftFields) {
  try {
    if (typeof fields.slug !== "string" || fields.slug.length > 100 || !PACKAGE_EDITOR_SECTIONS.includes(fields.section)) return null;
    const source = fields.draft;
    const draft = {} as PackageDraft;
    for (const [key, max] of Object.entries(strings)) {
      const value = source[key as keyof typeof strings];
      if (typeof value !== "string" || value.length > max) return null;
      Object.assign(draft, { [key]: value });
    }
    for (const key of ["durationDays", "durationNights", "priceAmount"] as const) {
      const value = source[key];
      if (!(key === "priceAmount" && value === null) && (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 100_000_000)) return null;
      Object.assign(draft, { [key]: value });
    }
    if (!["INR", "USD", "AED", "EUR", "GBP"].includes(source.currency) || !["PER_PERSON", "PER_COUPLE", "PER_GROUP", "ON_REQUEST"].includes(source.priceBasis) || !["ON_REQUEST", "SEASONAL", "UNAVAILABLE"].includes(source.availability) || typeof source.taxesIncluded !== "boolean") return null;
    draft.currency = source.currency; draft.priceBasis = source.priceBasis; draft.availability = source.availability; draft.taxesIncluded = source.taxesIncluded;
    if (!Array.isArray(source.itinerary) || source.itinerary.length > 60 || !Array.isArray(source.gallery) || source.gallery.length > 12) return null;
    draft.itinerary = source.itinerary.map(day => {
      if (!Number.isFinite(day.day) || Math.abs(day.day) > 60 || typeof day.title !== "string" || day.title.length > 160 || typeof day.description !== "string" || day.description.length > 2000) throw Error();
      return { day: day.day, title: day.title, description: day.description };
    });
    for (const key of ["inclusions", "exclusions"] as const) {
      if (!Array.isArray(source[key]) || source[key].length > 50 || source[key].some(value => typeof value !== "string" || value.length > 500)) return null;
      draft[key] = [...source[key]];
    }
    let omittedImageUrls = false;
    const image = (value: string) => {
      if (typeof value !== "string" || value.length > 1500 || !safePackageImage(value)) { omittedImageUrls = true; return ""; }
      return value;
    };
    draft.coverImageUrl = image(source.coverImageUrl);
    draft.gallery = source.gallery.map(item => {
      if (typeof item.alt !== "string" || item.alt.length > 180) throw Error();
      return { url: image(item.url), alt: item.alt };
    });
    const projected = { slug: fields.slug, draft, section: fields.section };
    if (new TextEncoder().encode(JSON.stringify(projected)).length > PACKAGE_DRAFT_MAX_BYTES) return null;
    return { fields: projected, omittedImageUrls };
  } catch { return null; }
}

export function createPackageDraftMemory(context: string, now = Date.now) {
  let entry: PackageDraftEntry | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  const clear = (nonce?: string) => { if (entry && (!nonce || nonce === entry.nonce)) { entry = null; emit(); } };
  return {
    context, getSnapshot: () => entry,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, clear,
    leaveDocument(persisted: boolean) {
      // BFCache keeps this JS heap alive. Never keep form text across documents,
      // but do not make an unresolved write retryable merely by traversing Back.
      if (!persisted || entry?.phase === "editing") { clear(); return; }
      if (entry?.fields) { entry = { ...entry, fields: null }; emit(); }
    },
    retain(key: PackageDraftKey, fields: PackageDraftFields) {
      if (!context || !key.nonce || (key.packageId === null ? key.revision !== null : !key.packageId || !Number.isInteger(key.revision) || Number(key.revision) < 1) || (entry && (entry.nonce !== key.nonce || entry.phase !== "editing"))) return false;
      const projected = projectPackageDraft(fields);
      if (!projected) { if (entry) { entry = { ...entry, fields: null }; emit(); } return false; }
      entry = { ...key, context, ...projected, omittedImageUrls: projected.omittedImageUrls || Boolean(entry?.omittedImageUrls), phase: "editing", action: null, acknowledged: false, updatedAt: now() }; emit(); return true;
    },
    acknowledgeImages(nonce: string, fields: PackageDraftFields) {
      if (entry?.nonce !== nonce || entry.phase !== "editing") return false;
      const projected = projectPackageDraft(fields);
      if (!projected || projected.omittedImageUrls) return false;
      entry = { ...entry, ...projected, updatedAt: now() }; emit(); return true;
    },
    beginSubmit(nonce: string, action: string) {
      if (entry?.nonce !== nonce || entry.phase !== "editing" || (["SAVE", "PUBLISH"].includes(action) && entry.omittedImageUrls) || !["SAVE", "PUBLISH", "UNPUBLISH", "ARCHIVE", "RESTORE"].includes(action)) return false;
      entry = { ...entry, phase: "submitting", action }; emit(); return true;
    },
    settle(nonce: string, outcome: "acknowledged" | "rejected" | "uncertain" | "unverified") {
      if (entry?.nonce !== nonce) return;
      if (outcome === "acknowledged") { clear(nonce); return; }
      entry = { ...entry, phase: outcome === "rejected" ? "editing" : "uncertain", action: outcome === "rejected" ? null : entry.action, acknowledged: outcome === "unverified" }; emit();
    },
    expire() {
      if (!entry || now() - entry.updatedAt < PACKAGE_DRAFT_TTL) return;
      if (entry.phase === "editing") clear(entry.nonce);
      else if (entry.fields) { entry = { ...entry, fields: null }; emit(); }
    },
  };
}
export type PackageDraftMemory = ReturnType<typeof createPackageDraftMemory>;
export function packageRecoveryKind(entry: PackageDraftEntry, context: string, item: { id: string; revision: number; status: string } | null): "denied" | "pending" | "unknown" | "expired" | "stale" | "ready" {
  if (context !== entry.context || (entry.packageId !== null && item?.id !== entry.packageId)) return "denied";
  if (entry.phase === "submitting") return "pending";
  if (entry.phase === "uncertain") return "unknown";
  if (!entry.fields) return "expired";
  if (entry.packageId === null ? item !== null : item?.revision !== entry.revision || item?.status === "ARCHIVED") return "stale";
  return "ready";
}

/** A malformed 2xx is not an acknowledgement: never clear the duplicate-write barrier. */
export type PackageEditorItem = { id: string; slug: string; title: string; status: string; revision: number; publishedAt: string | null; updatedAt: string; draft: PackageDraft; hasUnpublishedChanges: boolean };
export function readPackageEditorItem(value: unknown): PackageEditorItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id || typeof item.slug !== "string" || typeof item.title !== "string" || !["DRAFT", "PUBLISHED", "ARCHIVED"].includes(String(item.status)) || !Number.isInteger(item.revision) || Number(item.revision) < 1 || (item.publishedAt !== null && typeof item.publishedAt !== "string") || typeof item.updatedAt !== "string" || typeof item.hasUnpublishedChanges !== "boolean") return null;
  const checked = validatePackage(item.draft);
  if (!checked.data) return null;
  return { id: item.id, slug: item.slug, title: item.title, status: String(item.status), revision: Number(item.revision), publishedAt: item.publishedAt as string | null, updatedAt: item.updatedAt, hasUnpublishedChanges: item.hasUnpublishedChanges, draft: checked.data };
}
export function packageWriteAcknowledgement(body: unknown, context: string, key: PackageDraftKey, submittedSlug: string) {
  if (!body || typeof body !== "object" || !("recoveryContext" in body) || body.recoveryContext !== context || !("package" in body)) return null;
  const item = readPackageEditorItem(body.package);
  return item && (key.packageId === null ? item.slug === submittedSlug : item.id === key.packageId) && item.revision === (key.revision ?? 0) + 1 ? item : null;
}
