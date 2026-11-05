"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "./Modal";
import { Field } from "./ui";

export type UploadRequirement = {
  id: string; docType: string; version: number; traveller: string | null;
  expiryDate: string | null; needsExpiry?: boolean; fileTypes?: string; maxSizeMb?: number;
};

export default function DocumentUpload({ document, onClose }: { document: UploadRequirement; onClose: () => void }) {
  const router = useRouter();
  const requestKey = useRef("");
  const [file, setFile] = useState<File | null>(null);
  const [expiry, setExpiry] = useState(document.expiryDate?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState("");
  const [masked, setMasked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const aadhaar = /aadha+a?r|aadhar/i.test(document.docType);
  const close = () => { if (!busy && !uncertain) onClose(); };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !file) return;
    requestKey.current ||= crypto.randomUUID();
    const body = new FormData();
    body.set("requestKey", requestKey.current);
    body.set("version", String(document.version));
    body.set("file", file);
    body.set("expiryDate", expiry);
    body.set("notes", notes);
    body.set("maskedAadhaarConfirmed", String(masked));
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/documents/${document.id}/upload`, { method: "POST", body });
      const result = await response.json();
      if (!response.ok) {
        setUncertain(response.status >= 500);
        if (response.status < 500) requestKey.current = "";
        setError(result.error || "Could not upload this file.");
        return;
      }
      router.refresh(); onClose();
    } catch {
      setUncertain(true);
      setError("The upload response was interrupted. Retry the same upload to confirm it without adding another file.");
    } finally { setBusy(false); }
  }

  return <Modal labelledBy="requirement-upload-title" onClose={close} busy={busy || uncertain} width="max-w-xl">
    <form onSubmit={submit} className="space-y-5">
      <div className="modal-sticky-header flex items-start justify-between gap-3"><div><h2 id="requirement-upload-title" className="text-xl font-semibold">Upload {document.docType}</h2><p className="mt-1 text-sm text-slate-600">{document.traveller || "Customer document"} · Saved directly to this requirement.</p></div><button type="button" className="btn-secondary" disabled={busy || uncertain} onClick={close}>Close</button></div>
      <fieldset disabled={busy || uncertain} className="space-y-4">
        <Field label="File *" hint={`${document.fileTypes || "PDF, JPG, PNG"} · up to ${document.maxSizeMb || 15} MB. Verification is required after upload.`}><input type="file" required accept=".pdf,.jpg,.jpeg,.png" onChange={event => setFile(event.target.files?.[0] || null)} /></Field>
        <Field label={`Expiry date${document.needsExpiry ? " *" : " (optional)"}`}><input type="date" required={document.needsExpiry} value={expiry} onChange={event => setExpiry(event.target.value)} /></Field>
        {aadhaar && <label className="flex gap-3 text-sm"><input type="checkbox" required checked={masked} onChange={event => setMasked(event.target.checked)} />I checked that the first eight Aadhaar digits are hidden.</label>}
        <Field label="Notes (optional)"><textarea rows={2} maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} /></Field>
      </fieldset>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="modal-sticky-footer flex justify-end"><button className="btn-primary" disabled={busy || !file}>{busy ? "Uploading…" : uncertain ? "Retry same upload" : "Upload document"}</button></div>
    </form>
  </Modal>;
}
