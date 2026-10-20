/** One applicability rule for initial intake and later applicant checklist changes. */
export function checklistMatches(checklist: {country: string; visaType: string}, destination: string, visaType: string) {
  const normalize = (value: string) => value.trim().toLowerCase();
  return normalize(checklist.country) === normalize(destination) && normalize(checklist.visaType) === normalize(visaType);
}

export function requirementApplies(travellerType: string, birth: Date | null, asOf: Date): boolean {
  if (travellerType === "ALL") return true;
  if (!birth) throw new Error("Record the applicant date of birth before applying age-specific requirements.");
  const adultDate = new Date(Date.UTC(birth.getUTCFullYear() + 18, birth.getUTCMonth(), birth.getUTCDate()));
  const minor = asOf < adultDate;
  return travellerType === "MINOR" ? minor : travellerType === "ADULT" ? !minor : true;
}

/** Agency appointments are entered in IST, independent of the staff browser timezone. */
export function appointmentInput(value: string | null | undefined) {
  return value ? new Date(new Date(value).getTime() + 330 * 60 * 1000).toISOString().slice(0, 16) : "";
}
export function appointmentValue(value: string) { return value ? `${value}:00+05:30` : ""; }
