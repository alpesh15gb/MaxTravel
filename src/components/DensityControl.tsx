"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { applyDensity, DENSITY_OPTIONS, readDensity, type Density } from "@/lib/density";

/**
 * The density switch. One component, two presentations:
 *
 * - `segmented` — a labelled toggle group for a toolbar or a settings panel.
 * - `menu`      — items for a `role="menu"` popover. A menu may only contain menu items, groups and
 *                 separators, so these are real `menuitemradio` entries rather than buttons wearing
 *                 an `aria-pressed` inside a role they do not belong to.
 *
 * Either way it writes one attribute on <html>; nothing else in the app decides density.
 */
export default function DensityControl({ mode = "segmented", className = "" }: { mode?: "segmented" | "menu"; className?: string }) {
  // The attribute is already on <html> (the layout sets the default and an inline script applies the
  // stored choice before paint), so the initial state only has to match what the reader already sees.
  const [density, setDensity] = useState<Density>("comfortable");
  useEffect(() => setDensity(readDensity()), []);
  const choose = (value: Density) => { setDensity(value); applyDensity(value); };

  if (mode === "menu") {
    return <>
      <div className="border-t border-slate-100 px-3.5 pb-1 pt-3" role="group" aria-label="Row density">
        <div className="mb-1.5 text-micro font-semibold uppercase tracking-[.12em] text-slate-500">Row density</div>
        {DENSITY_OPTIONS.map(o => <button key={o.value} role="menuitemradio" aria-checked={density === o.value} className="menu-item" onClick={() => choose(o.value)}>
          <span className="flex w-4 shrink-0 justify-center text-teal-700">{density === o.value && <Icon name="check" size={16} />}</span>
          <span className="min-w-0 flex-1"><span className="block font-medium">{o.label}</span><span className="block text-small text-slate-500">{o.hint}</span></span>
        </button>)}
      </div>
    </>;
  }

  return <div className={`segmented ${className}`} role="group" aria-label="Row density">
    {DENSITY_OPTIONS.map(o => <button key={o.value} type="button" aria-pressed={density === o.value} title={o.hint} onClick={() => choose(o.value)}>{o.label}</button>)}
  </div>;
}
