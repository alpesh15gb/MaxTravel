import Link from "next/link";
import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-header"><div className="min-w-0">{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</div>;
}

export function EmptyState({ icon = "compass", title, description, href, action, onAction }: { icon?: IconName; title: string; description: string; href?: string; action?: string; onAction?: () => void }) {
  // h2, not h3: an empty state is normally the first section heading under the page h1, and an h3
  // there skipped a level (an h1 -> h3 jump) on every module that had no records yet.
  return <div className="empty-state"><div className="empty-icon"><Icon name={icon} size={28} /></div><h2>{title}</h2><p>{description}</p>{action && (href ? <Link className="btn-primary" href={href}>{action}<Icon name="arrow" size={16} /></Link> : <button className="btn-primary" onClick={onAction}>{action}<Icon name="plus" size={16} /></button>)}</div>;
}

// Only three tones exist in the stylesheet, so the prop says so. `tone?: string` let call sites pass
// "teal", "ok", "warn" and "danger" — four names for two colours, none of which the CSS knew.
export type StatTone = "neutral" | "amber" | "rose";

export function StatCard({ label, value, note, icon = "dashboard", tone = "neutral" }: { label: string; value: ReactNode; note?: string; icon?: IconName; tone?: StatTone }) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}><Icon name={icon} size={19} /></span></div><div className="stat-value">{value}</div>{note && <div className="stat-note">{note}</div>}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

export function Status({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" | "info" }) {
  return <span className={`status status-${tone}`}><span className="status-dot" />{children}</span>;
}

export type ToastTone = "success" | "error";

/**
 * The single transient confirmation used across the workspace.
 *
 * One component so every module confirms, positions and behaves the same way, instead of each
 * screen hand-rolling its own panel with slightly different shadow, radius and wording.
 *
 * The tone matters as much as the wording: a failure announced in the same teal panel as a
 * success reads as good news at a glance, so errors get their own colour and an assertive
 * announcement instead of a polite one.
 */
export function Toast({ message, tone = "success" }: { message: string | null; tone?: ToastTone }) {
  if (!message) return null;
  const error = tone === "error";
  return <div role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"} className={`fixed bottom-5 right-5 z-50 max-w-sm rounded-xl border px-4 py-2.5 text-sm shadow-xl ${error ? "border-rose-300 bg-rose-50 text-rose-800" : "border-emerald-300 bg-white text-slate-900"}`}>{message}</div>;
}

/** Board/List switch used by every card board, so the control looks and behaves the same everywhere. */
export function ViewToggle<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; icon?: IconName }[]; onChange: (value: T) => void }) {
  return <div className="segmented" role="group" aria-label={label}>{options.map(o => <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.icon && <Icon name={o.icon} size={15} />}{o.label}</button>)}</div>;
}

/** The one search field used by every list toolbar. */
export function SearchInput({ label, placeholder, value, onChange, className = "" }: { label: string; placeholder: string; value: string; onChange: (value: string) => void; className?: string }) {
  return <div className={`relative min-w-[220px] flex-1 md:max-w-sm ${className}`}><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icon name="search" size={16} /></span><input type="search" aria-label={label} className="control w-full pl-9" placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} /></div>;
}

// White initials at 12px need 4.5:1. amber-600 (3.19:1), sky-600 (4.09:1) and emerald-600
// (3.77:1) failed that on their own fill, so those three use the next shade down, which measures
// 5.02:1, 5.93:1 and 5.48:1. The rest already pass.
const AVATAR_COLOURS = ["bg-blue-600", "bg-violet-600", "bg-emerald-700", "bg-amber-700", "bg-rose-600", "bg-sky-700", "bg-indigo-600", "bg-teal-700"];

/** A stable colour per person, so the same customer always gets the same avatar. */
export function avatarClass(name: string) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length];
}

export function initialsOf(name: string) {
  return name.split(" ").filter(Boolean).map(p => p[0]).slice(0, 2).join("").toUpperCase();
}
