import type { Config } from "tailwindcss";

// One honest palette and one type scale, so the look is decided here instead of in 835 class names.
//
// `teal` was the previous name for the brand ramp and it holds *blue* values (#1a63c4) — kept as an
// alias for one release so existing `teal-*` utilities keep working, then deleted. New code uses
// `brand`. This is the only place a brand colour should be written down.
const brand = {
  50: "#eef5ff",
  100: "#dbeafd",
  200: "#bcd8fb",
  300: "#8fbff7",
  400: "#5aa0f0",
  500: "#3485e8",
  600: "#1f6fd6",
  700: "#1a63c4",
  800: "#1852a3",
  900: "#173f7a",
};

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand,
        /** @deprecated Use `brand` — this key holds the blue ramp and is removed in the next release. */
        teal: brand,
        background: "var(--bg-app)",
        foreground: "var(--text-primary)",
        navy: {
          900: "#0c1f33",
          800: "#102a43",
          700: "#16365a",
        },
        // Semantic roles read from the token layer, so a colour means the same thing everywhere.
        danger: "var(--danger)",
        warn: "var(--warn)",
        ok: "var(--ok)",
        info: "var(--info)",
      },
      // Role-based scale in rem. Nothing in the UI may be smaller than `xs` (13px), and the whole
      // scale follows the reader's font-size setting because every step is rem, not px.
      fontSize: {
        micro: ["0.75rem", { lineHeight: "1.35", letterSpacing: "0.06em" }],
        // The floor. Nothing in the product may be smaller, and it is reserved for a secondary line
        // beside something bigger — a meta row under a name, a hint under a field.
        small: ["0.8125rem", { lineHeight: "1.45" }],
        // `text-xs` was the app's 12px default and is written at 238 call sites. It is the default UI
        // size, not a footnote, so it moves to the body step rather than one notch above the previous
        // value: the whole product had been sitting a full two steps below a 1440px screen's reading
        // size. The name is kept because 238 sites already say it and a rename would be churn.
        xs: ["0.875rem", { lineHeight: "1.5" }],
        // Deliberately the same step as `xs` after that move: both read as body copy. Kept as its own
        // name so a later nudge of the default (`xs`) cannot drag explicitly-body text with it.
        sm: ["0.875rem", { lineHeight: "1.5" }],
        base: ["0.9375rem", { lineHeight: "1.55" }],
        title: ["1.25rem", { lineHeight: "1.3", letterSpacing: "-0.02em" }],
        kpi: ["1.5rem", { lineHeight: "1.2", letterSpacing: "-0.02em" }],
        display: ["2rem", { lineHeight: "1.2", letterSpacing: "-0.03em" }],
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "8px",
        md: "8px",
        lg: "10px",
        xl: "14px",
      },
      boxShadow: {
        // Elevation is for things that really float: popovers, dialogs, toasts, drag ghosts.
        "elev-1": "0 1px 2px rgba(12,31,51,.06), 0 8px 24px rgba(12,31,51,.08)",
        "elev-2": "0 2px 6px rgba(12,31,51,.08), 0 16px 40px rgba(12,31,51,.12)",
      },
    },
  },
  plugins: [],
};
export default config;
