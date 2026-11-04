"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon, { type IconName } from "@/components/Icon";

/** Adds the visa or quote service to the trip (once), then opens its form. */
export default function AddServiceButton({ tripId, service, label, icon }: { tripId: string; service: "VISA" | "QUOTE"; label: string; icon: IconName }) {
  const router = useRouter(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function go() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/trips/${tripId}/services`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ service }) });
      const d = await r.json();
      if (!r.ok || !d.href) throw Error(d.error ?? "Could not open the form.");
      router.push(d.href);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open the form."); setBusy(false); }
  }
  return <div className="flex flex-col">
    <button type="button" onClick={go} disabled={busy} className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm font-medium text-slate-800 hover:border-teal-600 hover:bg-teal-50"><Icon name={icon} size={16} className="shrink-0 text-teal-700" />{busy ? "Opening…" : label}</button>
    {error && <span role="alert" className="mt-1 text-xs text-rose-700">{error}</span>}
  </div>;
}
