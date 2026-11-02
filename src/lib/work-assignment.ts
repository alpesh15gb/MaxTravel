/** Display eligibility without granting access; work-engine rechecks every write. */
export function assignmentUnavailable(
  person: { canWork: boolean; canReview: boolean; services: string[]; branchId: string | null; allBranches: boolean },
  service?: string,
  branchId?: string | null,
  review = false,
): string | null {
  if (!(review ? person.canReview : person.canWork)) return review ? "Review permission required" : "Operational role required";
  if (service && !person.services.includes(service)) return service === "VISA" ? "Visa access required" : "Ticketing access required";
  if (branchId && !person.allBranches && person.branchId !== branchId) return person.branchId ? "Different branch" : "Set a branch in staff profile";
  return null;
}
