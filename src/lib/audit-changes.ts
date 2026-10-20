/** Explicit allowlist of field names only. Values (PII, document text, credentials) never enter this summary. */
export function changedFieldNames(before: Record<string, unknown>, after: Record<string, unknown>, allowed: readonly string[]): string[] {
  return allowed.filter(key => Object.prototype.hasOwnProperty.call(after,key) && before[key] !== after[key]);
}
