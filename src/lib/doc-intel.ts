// Document intelligence pipeline.
//
// Architecture: `extractSuggestions` is the seam where a real OCR/LLM provider
// plugs in. It returns SUGGESTIONS ONLY — the UI requires an employee to confirm
// critical values before they touch operational data (see
// /api/documents/confirm-extraction). Never write extracted values directly to
// Traveller or VisaCase records.

export interface PassportSuggestion {
  fullName?: string;
  passportNumber?: string;
  dateOfBirth?: string;
  nationality?: string;
  gender?: string;
  issueDate?: string;
  expiryDate?: string;
  placeOfIssue?: string;
}

export interface DocWarning {
  type: "PASSPORT_EXPIRY_CLOSE_TO_TRAVEL" | "NAME_MISMATCH" | "DUPLICATE_DOCUMENT" | "EXPIRED_DOCUMENT" | "WRONG_TRAVELLER" | "INCOMPLETE_DOCUMENT";
  message: string;
  field?: string;
}

export interface ExtractionResult {
  values: PassportSuggestion;
  warnings: DocWarning[];
  provider: string;
}

/** No OCR provider is configured. Never fabricate identity fields from file names or hashes. */
export function extractSuggestions(): ExtractionResult {
  return { values: {}, warnings: [], provider: "not-configured" };
}

/** Cross-check helpers used at confirm-time and by the review UI. */
export function passportExpiryWarning(expiry: Date | string, travel?: Date | string | null): DocWarning | null {
  if (!travel) return null;
  const daysToTravel = (new Date(travel).getTime() - Date.now()) / 86400000;
  const daysToExpiry = (new Date(expiry).getTime() - Date.now()) / 86400000;
  if (daysToExpiry < 0) {
    return { type: "EXPIRED_DOCUMENT", message: `Passport expired ${Math.abs(Math.round(daysToExpiry))} days ago.` };
  }
  if (daysToExpiry < daysToTravel + 180) {
    return {
      type: "PASSPORT_EXPIRY_CLOSE_TO_TRAVEL",
      message: `Passport expires ${Math.round(daysToExpiry)}d from now; travel is in ${Math.round(daysToTravel)}d. Many destinations require 6+ months validity.`,
    };
  }
  return null;
}

export function nameMismatchWarning(passportName: string, bookingName?: string | null): DocWarning | null {
  if (!bookingName) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  if (norm(passportName) !== norm(bookingName)) {
    return { type: "NAME_MISMATCH", message: `Passport name “${passportName}” ≠ booking name “${bookingName}”. Check ticket reissue requirements.` };
  }
  return null;
}
