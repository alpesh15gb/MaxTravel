"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field } from "./ui";
import Modal from "./Modal";

type Value = string | number | boolean | null;
export type EditorField = { key: string; label: string; type?: "text" | "email" | "tel" | "number" | "date" | "datetime-local" | "textarea" | "select" | "checkbox"; required?: boolean; options?: { value: string; label: string }[]; maxLength?: number };

/**
 * The shared inline record editor used across every module.
 *
 * It now renders through `Modal` rather than owning its own `<dialog>`, so there is exactly one
 * place that decides how a dialog opens, traps focus, dismisses, and protects in-flight work. The
 * dialog is conditionally mounted rather than always-present-but-closed, which is what lets Modal
 * guarantee a fresh `showModal()` and no stale form state on reopen.
 */
export default function RecordEditor({ title, endpoint, values, fields, buttonLabel = "Edit", method = "POST" }: { title: string; endpoint: string; values: Record<string, Value>; fields: EditorField[]; buttonLabel?: string; method?: string }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(values);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setError(body.error ?? "Could not save."); return; }
      setOpen(false);
      router.refresh();
    } catch { setError("Connection failed. Your changes are preserved; please retry."); }
    finally { setBusy(false); }
  }

  return <>
    <button type="button" className="btn-secondary text-xs" onClick={() => { setForm(values); setError(""); setOpen(true); }}>{buttonLabel}</button>
    {open && <Modal label={title} onClose={() => setOpen(false)} width="max-w-lg" busy={busy}>
      <form onSubmit={save} className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={() => setOpen(false)}>×</button>
        </div>
        {fields.map(f => <Field key={f.key} label={f.label}>{f.type === "select" ? <select required={f.required} value={String(form[f.key] ?? "")} onChange={e => setForm({ ...form, [f.key]: e.target.value })}>{f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : f.type === "textarea" ? <textarea rows={3} maxLength={f.maxLength ?? 5000} value={String(form[f.key] ?? "")} onChange={e => setForm({ ...form, [f.key]: e.target.value })} /> : f.type === "checkbox" ? <input type="checkbox" checked={Boolean(form[f.key])} onChange={e => setForm({ ...form, [f.key]: e.target.checked })} /> : <input type={f.type ?? "text"} required={f.required} maxLength={f.maxLength ?? 150} min={f.type === "number" ? 0 : undefined} step={f.type === "number" ? "0.01" : undefined} value={String(form[f.key] ?? "")} onChange={e => setForm({ ...form, [f.key]: e.target.value })} />}</Field>)}
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </Modal>}
  </>;
}
