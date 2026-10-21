"use client";

import { enumLabel } from "@/lib/labels";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "./Icon";

interface Hit {
  id: string; group: string; title: string; subtitle: string; context: string; href: string;
}
interface Resp {
  query: string;
  groups: { key: string; label: string; hits: Hit[] }[];
  exact?: Hit;
}

const GROUP_COLORS: Record<string, string> = {
  CUSTOMER: "bg-sky-50 text-sky-700 border-sky-200",
  EMPLOYEE: "bg-violet-50 text-violet-700 border-violet-200",
  VISA_CASE: "bg-amber-50 text-amber-700 border-amber-200",
  BOOKING: "bg-teal-50 text-teal-700 border-teal-200",
  PNR: "bg-teal-50 text-teal-700 border-teal-200",
  TICKET: "bg-teal-50 text-teal-700 border-teal-200",
  TRAVELLER: "bg-teal-50 text-teal-700 border-teal-200",
  DOCUMENT: "bg-orange-50 text-orange-700 border-orange-200",
  INVOICE: "bg-rose-50 text-rose-700 border-rose-200",
  RECEIPT: "bg-rose-50 text-rose-700 border-rose-200",
  SUPPLIER: "bg-slate-100 text-slate-700 border-slate-200",
  TASK: "bg-indigo-50 text-indigo-700 border-indigo-200",
};

export default function UniversalSearch({ dark = false }: { dark?: boolean }) {
  const router = useRouter();
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [q, setQ] = useState("");
  const [resp, setResp] = useState<Resp | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const flat = resp?.groups.flatMap((g) => g.hits) ?? [];
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    // Decided after mount so the server markup and the first client render agree — the server
    // always emits the non-Mac form, so a Mac never logs a hydration mismatch.
    const platform = navigator.platform || navigator.userAgent;
    setIsMac(/mac|iphone|ipad|ipod/i.test(platform));
  }, []);
  const shortcut = isMac ? "⌘K" : "Ctrl K";

  // Focus after React has committed the mobile panel's visible state. A rAF scheduled
  // from the keyboard event can run before that commit and focus a still-hidden input.
  useEffect(() => {
    if (mobileExpanded) inputRef.current?.focus();
  }, [mobileExpanded]);

  useEffect(() => {
    const controller = new AbortController();
    setResp(null); setError(""); setLoading(false);
    if (q.trim().length < 2) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!r.ok) throw new Error("Search unavailable");
        const result = await r.json();
        if (!controller.signal.aborted) setResp(result);
      } catch {
        if (!controller.signal.aborted) setError("Search is unavailable. Please try again.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => { clearTimeout(t); controller.abort(); };
  }, [q]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setMobileExpanded(false); }
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMobileExpanded(true); setOpen(true);
        inputRef.current?.focus(); // Also supports the shortcut when the panel is already open.
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function go(hit: Hit) {
    setOpen(false); setMobileExpanded(false);
    setQ("");
    setResp(null);
    router.push(hit.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); setMobileExpanded(false); if (mobileExpanded && window.innerWidth < 640) triggerRef.current?.focus(); return; }
    if (!flat.length) {
      if (e.key === "Enter" && resp?.exact) go(resp.exact);
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[active]) go(flat[active]);
      else if (resp?.exact) go(resp.exact);
    }
  }

  return (
    <div ref={boxRef} className="workspace-search relative w-full max-w-2xl">
      <button ref={triggerRef} type="button" className="workspace-search-trigger icon-button" aria-label="Search your workspace" aria-expanded={mobileExpanded} aria-controls="workspace-search-input-panel" onClick={() => { setMobileExpanded(true); setOpen(true); }}><Icon name="search" size={20} /></button>
      <div id="workspace-search-input-panel" data-expanded={mobileExpanded} className="workspace-search-input-panel relative">          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"><Icon name="search" size={18} /></span>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-label="Search your workspace"
          role="combobox" aria-expanded={open && q.trim().length >= 2} aria-controls="workspace-search-results"
          placeholder="Search customers, PNRs, cases, invoices…"
          className={dark
            ? "w-full bg-white/10 border border-white/15 rounded-lg pl-9 pr-16 py-2 text-sm text-white placeholder-slate-400 focus:ring-2 focus:ring-teal-400/50 focus:bg-white/15"
            : "w-full bg-white border border-slate-200 rounded-lg pl-9 pr-3 sm:pr-16 py-2 text-sm placeholder-slate-500 focus:ring-2 focus:ring-teal-500/30 focus:border-teal-200"}
        />
        <button type="button" className="workspace-search-close icon-button" aria-label="Close workspace search" onClick={() => { setMobileExpanded(false); setOpen(false); triggerRef.current?.focus(); }}><Icon name="close" size={18}/></button>
        <span className={`hidden sm:block absolute right-3 top-1/2 -translate-y-1/2 text-small rounded px-1.5 py-0.5 border ${dark ? "text-slate-300 border-white/20" : "text-slate-500 border-slate-200"}`}>{shortcut}</span>
      </div>

      {open && q.trim().length >= 2 && (
        <div id="workspace-search-results" className="workspace-search-results fixed left-3 right-3 sm:absolute sm:left-auto sm:right-auto z-50 mt-2 sm:w-full max-h-[70vh] overflow-y-auto tos-scroll bg-white border border-slate-200 rounded-xl shadow-2xl">
          {loading && <div className="px-4 py-3 text-sm text-slate-500">Searching…</div>}
          {error && <div role="alert" className="p-4 text-sm text-rose-700">{error}</div>}
          {!loading && resp && resp.groups.length === 0 && !resp.exact && (
            <div className="px-4 py-6 text-sm text-slate-500">No matches for “{resp.query}”</div>
          )}
          {resp?.exact && resp.groups.length === 0 && (
            <button onClick={() => go(resp.exact!)} className="w-full text-left px-4 py-3 hover:bg-slate-100">
              <span className="text-teal-700 text-xs font-semibold">EXACT MATCH — press Enter</span>
              <div className="text-sm text-slate-900">{resp.exact.title} <span className="text-slate-500">{resp.exact.subtitle}</span></div>
            </button>
          )}
          {resp?.groups.map((g) => (
            <div key={g.key}>
              <div className="px-4 pt-3 pb-1 text-small font-bold tracking-wider text-slate-500">{g.label}</div>
              {g.hits.map((h) => {
                const idx = flat.indexOf(h);
                return (
                  <button
                    key={g.key + h.id}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => go(h)}
                    className={`w-full text-left px-4 py-2.5 flex items-start gap-3 border-l-2 ${
                      idx === active ? "bg-slate-100 border-teal-500" : "border-transparent hover:bg-slate-100"
                    }`}
                  >
                    <span className={`text-small font-bold px-1.5 py-0.5 rounded border shrink-0 ${GROUP_COLORS[h.group] ?? "bg-slate-100 text-slate-700 border-slate-200"}`}>
                      {enumLabel(h.group)}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm text-slate-900 truncate">{h.title}</span>
                      <span className="block text-xs text-slate-500 truncate">{h.subtitle}{h.context ? ` · ${h.context}` : ""}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {resp && resp.groups.length > 0 && (
            <div className="px-4 py-2 text-small text-slate-500 border-t border-slate-200">↑↓ navigate · Enter open · Esc close</div>
          )}
        </div>
      )}
    </div>
  );
}
