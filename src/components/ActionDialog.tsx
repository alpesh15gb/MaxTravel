"use client";
import { useState } from "react";
import { Field } from "./ui";
import Modal from "./Modal";

/**
 * The in-app replacement for window.confirm and window.prompt.
 *
 * Native browser dialogs cannot be styled, they block the whole page, and some embedded browsers
 * and webviews drop prompt() entirely — so the button looks broken and the decision is never
 * taken. This keeps the decision inside the workspace, states the consequence next to the button,
 * and shows a validation problem in place instead of discarding what the person typed.
 *
 * The frame comes from `Modal`, so Escape, focus trapping, the backdrop and the in-flight guard
 * behave exactly as they do in every other dialog in the app.
 */
export default function ActionDialog({
  title,
  description,
  fieldLabel,
  fieldType = "text",
  fieldPlaceholder,
  fieldHint,
  required = false,
  initialValue = "",
  requiredMessage = "Enter a value to continue.",
  confirmLabel = "Confirm",
  tone = "primary",
  busy = false,
  error = "",
  onConfirm,
  onClose,
}: {
  title: string;
  description?: string;
  fieldLabel?: string;
  fieldType?: "text" | "number" | "textarea";
  fieldPlaceholder?: string;
  fieldHint?: string;
  required?: boolean;
  initialValue?: string;
  requiredMessage?: string;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  error?: string;
  onConfirm: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [problem, setProblem] = useState("");
  const message = problem || error;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (required && !value.trim()) {
      setProblem(requiredMessage);
      return;
    }
    setProblem("");
    onConfirm(value.trim());
  }

  return <Modal label={title} onClose={onClose} width="max-w-md" busy={busy}>
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      {description && <p className="text-sm leading-6 text-slate-600">{description}</p>}
      {fieldLabel && (
        <Field label={fieldLabel} hint={fieldHint}>
          {fieldType === "textarea" ? (
            <textarea
              autoFocus
              rows={3}
              maxLength={500}
              placeholder={fieldPlaceholder}
              value={value}
              onChange={(e) => { setValue(e.target.value); setProblem(""); }}
            />
          ) : (
            <input
              autoFocus
              type={fieldType}
              step={fieldType === "number" ? "0.01" : undefined}
              min={fieldType === "number" ? 0 : undefined}
              placeholder={fieldPlaceholder}
              value={value}
              onChange={(e) => { setValue(e.target.value); setProblem(""); }}
            />
          )}
        </Field>
      )}
      {message && <div role="alert" className="form-error">{message}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className={tone === "danger" ? "btn-danger" : "btn-primary"} disabled={busy}>
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </form>
  </Modal>;
}
