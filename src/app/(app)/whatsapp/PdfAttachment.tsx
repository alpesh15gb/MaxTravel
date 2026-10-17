"use client";
import { useEffect, useRef, useState } from "react";
export type PdfSelection = { id: string; filename: string; url: string; confirmed: boolean };
export default function PdfAttachment({ customerId, disabled, value, onChange, onUploading }: { customerId: string; disabled: boolean; value: PdfSelection | null; onChange: (value: PdfSelection | null) => void; onUploading: (busy:boolean)=>void }) {
  const [uploading, setUploading] = useState(false), [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  return <div className="space-y-2 rounded-xl border border-slate-200 p-3">
    <label className="block text-xs font-semibold">Attach ticket, voucher or receipt PDF
      <input className="mt-2 block w-full text-xs" type="file" accept="application/pdf,.pdf" disabled={disabled || uploading} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
        setError(""); onChange(null);
        if (file.size > 5 * 1024 * 1024 || !file.name.toLowerCase().endsWith(".pdf")) { setError("Choose a PDF up to 5 MB."); return; }
        const abort = new AbortController(); controller.current = abort; setUploading(true); onUploading(true);
        try {
          const response = await fetch(`/api/whatsapp/attachments?customerId=${encodeURIComponent(customerId)}`, { method: "POST", headers: { "Content-Type": "application/pdf", "x-pdf-filename": encodeURIComponent(file.name) }, body: file, signal: abort.signal });
          const data = await response.json(); if (!response.ok) throw new Error(data.error || "PDF upload failed.");
          if (!abort.signal.aborted) onChange({ id: data.id, filename: data.filename, url: data.url, confirmed: false });
        } catch (error) { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : "PDF upload failed."); }
        finally { if (!abort.signal.aborted) {setUploading(false);onUploading(false);} }
      }} />
    </label>
    {uploading && <p role="status" className="text-xs text-slate-500">Preparing private PDF…</p>}
    {value && <><div className="flex flex-wrap items-center gap-3 text-xs"><a className="font-semibold text-teal-700 underline" href={value.url} target="_blank" rel="noopener noreferrer">Download and review {value.filename}</a><button type="button" className="text-slate-500 underline" disabled={disabled} onClick={() => onChange(null)}>Remove attachment</button></div>
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" disabled={disabled} checked={value.confirmed} onChange={event => onChange({ ...value, confirmed: event.target.checked })} />I reviewed this PDF and confirmed it belongs to this customer.</label></>}
    <p className="text-xs text-slate-500">Private PDF, up to 5 MB. Outside the reply window, select an approved utility template with a document header.</p>
    {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
  </div>;
}
