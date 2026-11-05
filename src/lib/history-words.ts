import { enumLabel } from "./labels";

const REF_KIND: Record<string, string> = { BK: "Booking", ON: "Booking", VC: "Visa", INV: "Invoice", RCP: "Payment", RF: "Refund", DOC: "Document", CN: "Credit note" };
const TASK_WORDS: Record<string, string> = { CREATED: "created", ASSIGN: "assigned", CANCEL: "cancelled", START: "started", COMPLETE: "completed", SUBMIT: "submitted for review", WAIT: "waiting", APPROVE: "approved", RETURN: "returned", REOPEN: "reopened", WAIVE: "waived", EDIT: "edited" };
const RECORD = /^([A-Z]{2,4})-([\w-]+?)(?: · ([^:]+))?: (.+)$/;
const TASK = /^([A-Z ]{3,}) · (.+)$/;

const stateWords = (s: string) => { const t = s.trim().replaceAll("_", " "); return t ? t[0].toUpperCase() + t.slice(1) : t; };

/** Max ID events store short codes ("RF-1 · supplier_pending: status"). This is how they read to people. */
export function readableEvent(summary: string): string {
  const r = RECORD.exec(summary);
  if (r) {
    const [, kind, rest, state, verb] = r, name = `${REF_KIND[kind] ?? kind} ${kind}-${rest}`, v = verb.trim().toLowerCase();
    if (v === "status") return `${name} status changed to ${stateWords(state ?? "")}`.trim();
    if (v === "stage") return `${name} moved to ${stateWords(state ?? "")}`.trim();
    if (v === "create") return `${name} created`;
    if (v === "record") return `${name} recorded`;
    if (v === "edit") return `${name} changed`;
    if (v === "supplier cost") return `${name} supplier cost updated`;
    return `${name} ${v}`;
  }
  const t = TASK.exec(summary);
  if (t && TASK_WORDS[t[1].trim().replaceAll(" ", "_")]) return `To-do ${TASK_WORDS[t[1].trim().replaceAll(" ", "_")]}: ${t[2]}`;
  return summary;
}

/** The record an event is about, in the same form audit rows use, so the two can be matched. */
export function eventRef(summary: string): string | null {
  const r = RECORD.exec(summary);
  if (r) return `${r[1]}-${r[2]}`;
  const t = TASK.exec(summary);
  return t && TASK_WORDS[t[1].trim().replaceAll(" ", "_")] ? `“${t[2]}”` : null;
}

/** "PNR_CREATED" → "PNR created"; other text is left alone. */
export const codeWords = (v: unknown) => { const s = String(v ?? "—"); return /^[A-Z]+(?:_[A-Z]+)*$/.test(s) ? enumLabel(s) : s; };
