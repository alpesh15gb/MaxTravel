import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
const date = text(10).refine(v => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v), "Use a valid date.");
// Display-only URLs: never fetched by the CRM server, never private upload URLs.
export const PACKAGE_IMAGE_HELP = "Use an approved images.unsplash.com/photo- URL, pix8.agoda.net/hotelImages/ URL or i.travelapi.com/lodging/ URL. Private documents and arbitrary image hosts are not supported.";
export function safePackageImage(value: string) {
  if (!value) return true;
  if (value.includes("#") || /[\\\x00-\x20\x7f]/.test(value) || /%(2e|2f|5c|25)/i.test(value)) return false;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port || u.hash || !value.startsWith(`https://${u.hostname}/`)) return false;
    if (u.hostname === "images.unsplash.com" && /^\/photo-[a-zA-Z0-9-]+$/.test(u.pathname)) {
      const seen = new Set<string>();
      for (const [key, val] of u.searchParams) {
        if (seen.has(key)) return false; seen.add(key);
        if (key === "auto" ? val !== "format" : key === "fit" ? !["crop", "max", "clip"].includes(val) : key === "w" || key === "h" ? !/^\d+$/.test(val) || Number(val) < 1 || Number(val) > 4000 : key === "q" ? !/^\d+$/.test(val) || Number(val) < 1 || Number(val) > 100 : true) return false;
      }
      return true;
    }
    return !value.includes("?") && !u.search && ((u.hostname === "pix8.agoda.net" && u.pathname.startsWith("/hotelImages/")) || (u.hostname === "i.travelapi.com" && u.pathname.startsWith("/lodging/"))) && !value.includes("/../") && !value.includes("/./");
  } catch { return false; }
}
const imageUrl = text(1500).refine(safePackageImage, PACKAGE_IMAGE_HELP);
const phone = text(24).refine(v => !v || /^\+[1-9]\d{6,14}$/.test(v), "Use international format, e.g. +919876543210.");
export const packageContentSchema = z.object({
  title: text(120).min(3, "Enter a title of at least 3 characters."),
  destination: text(120), summary: text(280), description: text(8000),
  durationDays: z.number().int().min(1).max(60), durationNights: z.number().int().min(0).max(60),
  priceAmount: z.number().finite().positive().max(100000000).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001, "Use at most two decimal places.").nullable(),
  currency: z.enum(["INR", "USD", "AED", "EUR", "GBP"]),
  priceBasis: z.enum(["PER_PERSON", "PER_COUPLE", "PER_GROUP", "ON_REQUEST"]),
  priceNotes: text(1500), priceValidUntil: date, taxesIncluded: z.boolean(),
  availability: z.enum(["ON_REQUEST", "SEASONAL", "UNAVAILABLE"]),
  travelStart: date, travelEnd: date, availabilityNotes: text(1500),
  itinerary: z.array(z.object({ day: z.number().int().min(1).max(60), title: text(160), description: text(2000) }).strict()).max(60),
  inclusions: z.array(text(500).min(1)).max(50), exclusions: z.array(text(500).min(1)).max(50),
  terms: text(6000), cancellationPolicy: text(4000),
  coverImageUrl: imageUrl, coverImageAlt: text(180),
  gallery: z.array(z.object({ url: imageUrl, alt: text(180) }).strict()).max(12),
  contactEmail: text(160).refine(v => !v || z.email().safeParse(v).success, "Enter a valid email."),
  contactPhone: phone, contactWhatsapp: phone,
}).strict();
export type PackageContent = z.infer<typeof packageContentSchema>;
export type PackageDraft = PackageContent & { internalNotes: string };
export type PublicTravelPackage = PackageContent & { id: string; slug: string; publishedAt: string };
export const slugSchema = z.string().min(3).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens.");
export function validatePackage(input: unknown, publish = false, today = new Date().toISOString().slice(0, 10)) {
  const result = packageContentSchema.extend({ internalNotes: text(6000) }).safeParse(input);
  if (!result.success) return { errors: result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`), data: null };
  const d = result.data; const errors: string[] = [];
  if (d.durationNights > d.durationDays) errors.push("Nights cannot exceed the number of days.");
  if (d.priceBasis === "ON_REQUEST" && d.priceAmount !== null) errors.push("On-request pricing must not include a displayed amount.");
  if (d.priceBasis !== "ON_REQUEST" && d.priceAmount === null) errors.push("Enter a starting price or choose on-request pricing.");
  if (d.travelStart && d.travelEnd && d.travelStart > d.travelEnd) errors.push("Travel end must be on or after travel start.");
  if (new Set(d.itinerary.map(i => i.day)).size !== d.itinerary.length || d.itinerary.some(i => i.day > d.durationDays)) errors.push("Itinerary days must be unique and within the trip duration.");
  if (publish) {
    for (const key of ["destination", "summary", "description", "terms", "cancellationPolicy", "availabilityNotes"] as const) if (!d[key]) errors.push(`${key}: Required before publishing.`);
    if (!d.contactEmail && !d.contactPhone && !d.contactWhatsapp) errors.push("Add at least one public enquiry contact.");
    if (d.itinerary.some(day => !day.title || !day.description)) errors.push("Complete every itinerary day title and description before publishing.");
    if (d.gallery.some(image => !image.url || !image.alt)) errors.push("Complete every gallery image URL and description before publishing.");
    if (d.itinerary.length !== d.durationDays) errors.push("Add an itinerary entry for every day before publishing.");
    if (!d.inclusions.length || !d.exclusions.length) errors.push("List both inclusions and exclusions before publishing.");
    if (d.coverImageUrl && !d.coverImageAlt) errors.push("Describe the cover image for accessibility.");
    if (d.availability === "SEASONAL" && (!d.travelStart || !d.travelEnd)) errors.push("Seasonal packages need a travel date range.");
    if (d.travelEnd && d.travelEnd < today) errors.push("The travel period has expired. Update it before publishing.");
    if (d.priceBasis !== "ON_REQUEST" && (!d.priceNotes || !d.priceValidUntil || d.priceValidUntil < today)) errors.push("Displayed starting prices need pricing notes and a current price-valid-until date.");
  }
  return { errors, data: errors.length ? null : d };
}
// Explicit field projection strips private notes and all database/audit metadata.
export function publicPackage(content: PackageDraft | PackageContent, meta: { id: string; slug: string; publishedAt: Date | string }, today = new Date().toISOString().slice(0, 10)): PublicTravelPackage {
  const { internalNotes: _private, ...fields } = content as PackageDraft;
  void _private;
  const clean = packageContentSchema.parse(fields);
  if (clean.priceValidUntil && clean.priceValidUntil < today) { clean.priceAmount = null; clean.priceBasis = "ON_REQUEST"; }
  if (clean.travelEnd && clean.travelEnd < today) clean.availability = "UNAVAILABLE";
  return { ...clean, id: meta.id, slug: meta.slug, publishedAt: new Date(meta.publishedAt).toISOString() };
}
export const emptyPackage: PackageDraft = {
  title: "", destination: "", summary: "", description: "", durationDays: 1, durationNights: 0,
  priceAmount: null, currency: "INR", priceBasis: "ON_REQUEST", priceNotes: "", priceValidUntil: "", taxesIncluded: false,
  availability: "ON_REQUEST", travelStart: "", travelEnd: "", availabilityNotes: "",
  itinerary: [], inclusions: [], exclusions: [], terms: "", cancellationPolicy: "",
  coverImageUrl: "", coverImageAlt: "", gallery: [], contactEmail: "", contactPhone: "", contactWhatsapp: "", internalNotes: "",
};

export function packageSummary(item: PublicTravelPackage) {
  const { id, slug, title, destination, summary, durationDays, durationNights, priceAmount, currency, priceBasis, priceNotes, priceValidUntil, taxesIncluded, availability, travelStart, travelEnd, availabilityNotes, coverImageUrl, coverImageAlt, publishedAt } = item;
  return { id, slug, title, destination, summary, durationDays, durationNights, priceAmount, currency, priceBasis, priceNotes, priceValidUntil, taxesIncluded, availability, travelStart, travelEnd, availabilityNotes, coverImageUrl, coverImageAlt, publishedAt };
}
