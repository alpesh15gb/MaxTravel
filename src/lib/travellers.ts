import { ApiError } from "./guard";
import { date as parseDate } from "./transactions";

// Validation shared by the traveller create and edit routes.
//
// It lives here rather than in either route because Next.js only allows a route module to export HTTP
// handlers, and because both routes must agree exactly: the form posts to both, and a rule that
// existed on one and not the other is how the same traveller ends up with two different sets of
// passport dates depending on which screen saved it last.

/** Relationship to the customer, in the order the forms offer it. */
export const TRAVELLER_RELATIONS = ["SELF", "SPOUSE", "SON", "DAUGHTER", "FATHER", "MOTHER", "EMPLOYEE", "GROUP"] as const;

/** A birth date cannot be in the future: there is no real record it is ever right to hold. */
export function birthDate(value: unknown): Date | null {
  const d = value ? parseDate(value, "Date of birth") : null;
  if (d && d.getTime() > Date.now()) throw new ApiError(400, "Date of birth cannot be in the future.");
  return d;
}

/**
 * A passport that has already expired is ordinary data, not a mistake — it is exactly what most of
 * this table holds, and it is the record a visa renewal starts from. So the "must not be in the
 * past" rule only fires on a value that is actually changing, which is where a typo would be caught.
 * Re-saving a stored expiry unchanged has to keep working, or nobody could correct a traveller's
 * name or phone number until they also happened to fix their passport.
 */
export function passportExpiry(value: unknown, current?: Date | null): Date | null {
  const d = value ? parseDate(value, "Passport expiry") : null;
  const unchanged = Boolean(current && d && current.getTime() === d.getTime());
  if (d && !unchanged && d.getTime() < Date.now()) throw new ApiError(400, "Passport expiry cannot be a date that has already passed.");
  return d;
}

export function passportIssueDate(value: unknown): Date | null {
  return value ? parseDate(value, "Passport issue date") : null;
}

export function relation(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const r = String(value || "").trim();
  if (!r) return undefined;
  if (!(TRAVELLER_RELATIONS as readonly string[]).includes(r)) throw new ApiError(400, "Select a valid relation.");
  return r;
}