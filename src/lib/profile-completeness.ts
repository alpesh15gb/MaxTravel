/** "Travel-ready" profile check shown on each traveller card. Pure: works on the master data sent to the page. */
export type CompletenessTraveller = {
  id: string; fullName: string; dateOfBirth: string; gender: string; nationality: string; relation?: string;
  details: Record<string, unknown>;
  legacyPassport: { expiryDate: string } | null;
  identities: { kind: string; primaryPassport: boolean; expiryDate: string; fileDocumentId: string | null }[];
};
export type CompletenessDocument = { travellerId: string | null; uploadedAt: string | null };

const has = (v: unknown) => typeof v === "string" ? v.trim().length > 0 : v != null && v !== false;

export function passportExpiry(t: CompletenessTraveller): string {
  const passport = t.identities.find(d => d.primaryPassport) ?? t.identities.find(d => d.kind === "PASSPORT");
  return passport?.expiryDate || t.legacyPassport?.expiryDate || "";
}

export function profileCompleteness(t: CompletenessTraveller, documents: CompletenessDocument[], customerContact?: { phone: string | null; email: string | null }): { filled: number; total: number; missing: string[] } {
  const self = t.relation === "SELF" && customerContact;
  const passport = Boolean(t.legacyPassport) || t.identities.some(d => d.kind === "PASSPORT" || d.primaryPassport);
  const uploaded = documents.some(d => d.travellerId === t.id && d.uploadedAt) || t.identities.some(d => d.fileDocumentId);
  const checks: [string, boolean][] = [
    ["Full name", has(t.fullName)],
    ["Date of birth", has(t.dateOfBirth)],
    ["Gender", has(t.gender)],
    ["Nationality", has(t.nationality)],
    ["Passport number", passport],
    ["Passport expiry", has(passportExpiry(t))],
    ["Phone or email", has(t.details.phone) || has(t.details.email) || Boolean(self && (has(customerContact.phone) || has(customerContact.email)))],
    ["Emergency contact name", has(t.details.emergencyName)],
    ["Emergency contact phone", has(t.details.emergencyPhone)],
    ["Identity document", uploaded],
  ];
  const missing = checks.filter(([, ok]) => !ok).map(([label]) => label);
  return { filled: checks.length - missing.length, total: checks.length, missing };
}

/** Expired, or expiring within 6 months of `today` (YYYY-MM-DD, India day). */
export function passportWarning(expiry: string, today: string): "EXPIRED" | "SOON" | null {
  if (!expiry) return null;
  if (expiry < today) return "EXPIRED";
  const [y, m, d] = today.split("-").map(Number);
  const limit = new Date(Date.UTC(y, m - 1 + 6, d)).toISOString().slice(0, 10);
  return expiry <= limit ? "SOON" : null;
}
