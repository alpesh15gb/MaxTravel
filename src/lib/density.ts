// Density is a mode, not an accident: one attribute on <html> drives --row-height, --row-pad,
// --card-pad, --field-height and --btn-height, so every table, card and toolbar follows it.
//
// The value is remembered per browser. There is no per-user preferences column yet, so "remembered
// for this person on this machine" is what this can honestly claim; a `user.density` column would
// make it follow the account, and the token layer above already reads from one attribute either way.
export type Density = "comfortable" | "compact";

export const DENSITY_KEY = "tos.density";
export const DEFAULT_DENSITY: Density = "comfortable";
export const DENSITY_OPTIONS: { value: Density; label: string; hint: string }[] = [
  { value: "comfortable", label: "Comfortable", hint: "44px rows and 16px card padding" },
  { value: "compact", label: "Compact", hint: "36px rows and 12px card padding" },
];

export function isDensity(value: unknown): value is Density {
  return value === "comfortable" || value === "compact";
}

/** The stored mode, or the default. Safe to call during render — it only touches the DOM in an effect. */
export function readDensity(): Density {
  if (typeof window === "undefined") return DEFAULT_DENSITY;
  try {
    const stored = window.localStorage.getItem(DENSITY_KEY);
    return isDensity(stored) ? stored : DEFAULT_DENSITY;
  } catch {
    // Storage can be blocked (private mode, hardened browser). The default is the honest fallback.
    return DEFAULT_DENSITY;
  }
}

/** Writes the attribute the stylesheet reads, and remembers the choice. */
export function applyDensity(density: Density): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.density = density;
  try {
    window.localStorage.setItem(DENSITY_KEY, density);
  } catch {
    // Remembering is a nicety; the attribute above is the part that changes the screen.
  }
}
