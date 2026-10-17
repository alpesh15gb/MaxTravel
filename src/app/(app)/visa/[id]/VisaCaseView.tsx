"use client";

import { enumLabel } from "@/lib/labels";
import { dateLabel, dateTimeLabel } from "@/lib/dates";
import { inrAmount } from "@/lib/money";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { Status } from "@/components/ui";
import Modal from "@/components/Modal";
import { openSignedFile } from "@/lib/openSignedFile";
import { useToast } from "@/lib/useToast";

const money = (n: number | null | undefined) => (n == null ? "—" : inrAmount(n));
const dt = (s: string | null | undefined) => (s ? dateTimeLabel(s) : "—");
const dOnly = (s: string | null | undefined) => (s ? dateLabel(s) : "—");
const dInput = (s: string | null | undefined) => (s ? new Date(s).toISOString().slice(0, 10) : "");

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

type Doc = {
  id: string; docNo: string; docType: string; status: string; traveller: string | null;
  uploadedAt: string | null; uploadSource: string | null; verificationStatus: string;
  verifiedBy: string | null; expiryDate: string | null; rejectionReason: string | null;
  hasFile: boolean; version: number;
  warnings: { type: string; message: string }[];
  extracted: Record<string, string> | null;
  extractionConfirmed: boolean;
};

type VC = {
  id: string; caseNo: string;
  customer: { id: string; name: string; code: string; phone: string };
  stage: { id: string; key: string; name: string };
  destination: string; visaType: string; visaCategory: string | null;
  travelDate: string | null; intendedStay: string | null;
  applicationDate: string | null; submissionDate: string | null; appointmentDate: string | null;
  biometricsDate: string | null; expectedDecisionDate: string | null; decisionDate: string | null;
  visaOutcome: string | null; visaValidityUntil: string | null;
  visaFee: number; serviceFee: number; sellingPrice: number; amountReceived: number;
  supplierId: string | null; supplier: string | null; owner: string; branch: string; internalNotes: string | null;
  travellers: { id: string; fullName: string; relation: string; passportNumber: string | null; passportExpiry: string | null; applicantType: string }[];
  documents: Doc[];
  history: { id: string; stage: string; note: string | null; by: string; at: string }[];
  tasks: { id: string; title: string; status: string; priority: string; owner: string; dueAt: string | null }[];
  checklist: { country: string; visaType: string; applicantType: string; version: number; items: { name: string; required: boolean; instructions: string | null }[] } | null;
};

type Stage = { id: string; key: string; name: string; seq: number };
type Perms = { edit: boolean; verify: boolean; send: boolean; record: boolean; money: boolean };

// Document states use the same tones as every other status badge in the app.
const docTone = (s: string): Tone => {
  if (["ACCEPTED"].includes(s)) return "success";
  if (["RECEIVED", "REQUESTED", "SUBMITTED"].includes(s)) return "info";
  if (["UNDER_REVIEW"].includes(s)) return "warning";
  if (["REJECTED", "REUPLOAD_REQUESTED"].includes(s)) return "danger";
  return "neutral";
};

export default function VisaCaseView({ vc, stages, perms, suppliers }: {
  vc: VC; stages: Stage[]; perms: Perms; suppliers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { show, toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [stageId, setStageId] = useState(vc.stage.id);
  const [showEdit, setShowEdit] = useState(false);

  async function post(url: string, body: unknown, okMsg: string) {
    setBusy(true);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        show(d.status === "LOGGED" ? "Message logged—not sent. Open WhatsApp desk to send it." : okMsg);
        router.refresh();
      } else {
        show(d.error ?? "That change was not saved.", "error");
        setStageId(vc.stage.id);
      }
    } catch {
      show("Connection failed. Nothing was changed — please try again.", "error");
      setStageId(vc.stage.id);
    } finally { setBusy(false); }
  }

  const outstanding = vc.sellingPrice - vc.amountReceived;
  const currentIndex = stages.findIndex((x) => x.key === vc.stage.key);

  const byTraveller = useMemo(() => {
    const map = new Map<string, Doc[]>();
    for (const d of vc.documents) {
      const key = d.traveller ?? "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return map;
  }, [vc.documents]);

  return (
    <div className="workspace-page">
      {/* min-h-8 + padding: this measured 16px tall, under the 24px minimum target size. */}
      <Link href="/visa" className="mb-2 inline-flex min-h-8 items-center gap-2 py-1.5 text-xs font-medium text-slate-600 hover:text-teal-700"><Icon name="visa" size={15} />All visa cases</Link>

      {/* Dossier header */}
      <section className="panel mb-4 p-4" aria-label="Visa dossier">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="eyebrow">Visa dossier · {vc.destination}</div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{vc.caseNo}</h1>
              <Status tone="info">{vc.stage.name}</Status>
              {vc.visaOutcome && <Status tone={vc.visaOutcome === "APPROVED" ? "success" : "danger"}>{vc.visaOutcome}</Status>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
              <Link href={`/customers/${vc.customer.id}`} className="font-medium text-slate-900 hover:text-teal-700">{vc.customer.name}</Link>
              <span>({vc.customer.code})</span>
              <span>· {vc.destination} · {vc.visaType}{vc.visaCategory ? ` · ${vc.visaCategory}` : ""}</span>
              <span>· owner {vc.owner} · {vc.branch}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {perms.edit && (
              <>
                <button type="button" onClick={() => setShowEdit(true)} className="btn-secondary min-h-9 px-3 py-2 text-xs">Edit Case</button>
                <select
                  aria-label="Visa workflow stage" disabled={busy} value={stageId}
                  onChange={(e) => { setStageId(e.target.value); post(`/api/visa/cases/${vc.id}/stage`, { stageId: e.target.value }, "✓ Stage updated"); }}
                  className="control h-9 text-xs"
                >
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.seq}. {s.name}</option>)}
                </select>
              </>
            )}
            {perms.send && (
              <button type="button" onClick={() => post("/api/whatsapp/send", { customerId: vc.customer.id, template: "STATUS_UPDATE", visaCaseId: vc.id }, "Status update logged—not sent")} className="btn-primary min-h-9 px-3 py-2 text-xs">
                WhatsApp Update
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {/* Workflow stepper */}
          <section className="panel p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-micro font-semibold uppercase tracking-[.12em] text-slate-500">Workflow — {stages.length} stages</h2>
              {perms.edit && <span className="text-small text-slate-500">Select a stage to move this case</span>}
            </div>
            {/* Wraps instead of scrolling: the 16 chips fit in four rows, and a strip that scrolled sideways
                inside the page was a nested scroll region the reader had to discover. */}
            <div className="flex flex-wrap gap-1.5 pb-2">
              {stages.map((s, i) => {
                const current = s.key === vc.stage.key;
                const passed = i < currentIndex;
                const look = `inline-flex min-h-8 shrink-0 items-center rounded-lg border px-2.5 py-1 text-small ${
                  current ? "border-teal-300 bg-teal-50 font-semibold text-teal-800" :
                  passed ? "border-slate-200 bg-slate-100 text-slate-600" : "border-slate-200 bg-white text-slate-500"
                }`;
                if (!perms.edit) return <div key={s.id} className={look}>{s.name}</div>;
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={busy || current}
                    aria-current={current ? "step" : undefined}
                    title={current ? `Current stage: ${s.name}` : `Move case to ${s.name}`}
                    onClick={() => { setStageId(s.id); post(`/api/visa/cases/${vc.id}/stage`, { stageId: s.id }, "✓ Stage updated"); }}
                    className={`${look} ${current ? "" : "hover:border-teal-300 hover:text-teal-700"}`}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
            {vc.history.length > 0 && <details className="mt-3 border-t border-slate-100 pt-3">
              <summary className="cursor-pointer text-xs text-slate-500">Stage history · {vc.history.length} changes</summary>
              <ol className="mt-3 space-y-0">
                {vc.history.slice(0, 8).map((h, i) => (
                  <li key={h.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="mt-1.5 h-2 w-2 rounded-full bg-teal-600" />
                      {i < Math.min(vc.history.length, 8) - 1 && <div className="w-px flex-1 bg-slate-200" />}
                    </div>
                    <div className="pb-4">
                      <div className="text-xs text-slate-900">{h.stage}{h.note ? <span className="text-slate-500"> — {h.note}</span> : null}</div>
                      <div className="text-small text-slate-500">{h.by} · {dt(h.at)}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </details>}
          </section>

          {/* Documents by applicant */}
          <section className="panel p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-micro font-semibold uppercase tracking-[.12em] text-slate-500">Documents & Checklist</h2><a className="text-small text-teal-700" href={`/visa-requirements?case=${vc.id}`}>Manage applicant checklists</a>
              {vc.checklist && (
                <span className="text-small text-slate-500">Master: {vc.checklist.country} → {vc.checklist.visaType} → {vc.checklist.applicantType} · v{vc.checklist.version}</span>
              )}
            </div>
            <div className="space-y-6">
              {vc.travellers.map((t) => {
                const docs = byTraveller.get(t.fullName) ?? [];
                const done = docs.filter((d) => ["ACCEPTED", "SUBMITTED"].includes(d.status)).length;
                const total = docs.length;
                return (
                  <div key={t.id}>
                    <div className="mb-2.5 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{t.fullName}</span>
                      <Status>{t.applicantType}</Status>
                      <span className="text-small text-slate-500">Passport no. {t.passportNumber ?? "—"}{t.passportExpiry ? ` · exp ${dOnly(t.passportExpiry)}` : ""}</span>
                      {total > 0 && <Status tone={done === total ? "success" : "warning"}>{done}/{total} complete</Status>}
                    </div>
                    <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                      {docs.map((d) => (
                        <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-white px-4 py-3 text-xs">
                          <span className="w-40 shrink-0 truncate font-medium">{d.docType}</span>
                          <Status tone={docTone(d.status)}>{enumLabel(d.status)}</Status>
                          <span className="min-w-0 truncate text-slate-500">
                            {d.uploadedAt ? `${d.uploadSource ?? "staff"} · ${dt(d.uploadedAt)}` : "awaiting upload"}
                            {d.verifiedBy ? ` · ✓ ${d.verifiedBy}` : ""}
                            {d.expiryDate ? ` · exp ${dOnly(d.expiryDate)}` : ""}
                          </span>
                          <span className="ml-auto flex shrink-0 items-center gap-1.5">
                            {d.hasFile && (
                              <button
                                type="button"
                                onClick={async () => {
                                  const problem = await openSignedFile(
                                    () => fetch(`/api/documents/${d.id}/file`, { method: "POST" }),
                                    "Could not open this file. Ask an administrator to check document storage.",
                                  );
                                  if (problem) show(problem, "error");
                                }}
                                className="btn-secondary min-h-7 px-2.5 py-1 text-small"
                              >
                                View
                              </button>
                            )}
                            {perms.verify && (d.status === "RECEIVED" || d.status === "UNDER_REVIEW") && (
                              <>
                                <button type="button" onClick={() => post("/api/documents/verify", { documentId: d.id, decision: "ACCEPTED" }, "✓ Document accepted")} className="btn-primary min-h-7 px-2.5 py-1 text-small">Accept</button>
                                <button type="button" onClick={() => post("/api/documents/verify", { documentId: d.id, decision: "REJECTED", reason: "Quality/content issue" }, "Document rejected")} className="btn-secondary min-h-7 border-rose-200 px-2.5 py-1 text-small text-rose-700">Reject</button>
                              </>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                    {docWarnings(docs)}
                  </div>
                );
              })}
              {vc.documents.length === 0 && <div className="text-sm text-slate-500">No checklist attached — create case with a checklist to track documents.</div>}
            </div>
          </section>

          {vc.tasks.length > 0 && (
            <section className="panel p-5">
              <h2 className="mb-3 text-micro font-semibold uppercase tracking-[.12em] text-slate-500">Case tasks</h2>
              <div className="divide-y divide-slate-100">
                {vc.tasks.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-xs">
                    <span className="font-medium">{t.title}</span>
                    <span className="text-slate-500">{t.owner} · {t.priority}{t.dueAt ? ` · due ${dOnly(t.dueAt)}` : ""}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="min-w-0 space-y-5">
          <section className="panel space-y-2.5 p-5">
            <h2 className="text-micro font-semibold uppercase tracking-[.12em] text-slate-500">Money</h2>
            {perms.money ? <>
              <KV k="Visa fee" v={money(vc.visaFee)} />
              <KV k="Service fee" v={money(vc.serviceFee)} />
              <KV k="Selling price" v={money(vc.sellingPrice)} />
              <KV k="Received" v={money(vc.amountReceived)} />
              <KV k="Outstanding" v={money(outstanding)} strong={outstanding > 0} />
            </> : <p className="text-xs text-slate-500">Fee and receipt figures are restricted for your role.</p>}
            {perms.money && perms.record && outstanding > 0 && (
              <button type="button" onClick={() => (location.href = `/payments?action=record&customer=${vc.customer.id}&visaCase=${vc.id}`)} className="btn-secondary mt-2 w-full min-h-8 text-xs">
                Record Payment
              </button>
            )}
          </section>
          <section className="panel space-y-2.5 p-5">
            <h2 className="text-micro font-semibold uppercase tracking-[.12em] text-slate-500">Key dates</h2>
            <KV k="Travel date" v={dOnly(vc.travelDate)} />
            <KV k="Intended stay" v={vc.intendedStay ?? "—"} />
            <KV k="Application" v={dOnly(vc.applicationDate)} />
            <KV k="Submission" v={dOnly(vc.submissionDate)} />
            <KV k="Appointment" v={dt(vc.appointmentDate)} />
            <KV k="Biometrics" v={dOnly(vc.biometricsDate)} />
            <KV k="Expected decision" v={dOnly(vc.expectedDecisionDate)} />
            <KV k="Decision" v={dOnly(vc.decisionDate)} />
            <KV k="Visa valid until" v={dOnly(vc.visaValidityUntil)} />
          </section>
          <section className="panel space-y-2.5 p-5">
            <h2 className="text-micro font-semibold uppercase tracking-[.12em] text-slate-500">Assignment</h2>
            <KV k="Supplier" v={vc.supplier ?? "—"} />
            <KV k="Case owner" v={vc.owner} />
            <KV k="Branch" v={vc.branch} />
            {vc.internalNotes && <p className="border-t border-slate-100 pt-2.5 text-xs text-slate-500">{vc.internalNotes}</p>}
          </section>
        </aside>
      </div>

      {showEdit && (
        <EditCase vc={vc} suppliers={suppliers} canMoney={perms.money} onClose={() => setShowEdit(false)} />
      )}
      {toast}
    </div>
  );
}

function EditCase({ vc, suppliers, canMoney, onClose }: { vc: VC; suppliers: { id: string; name: string }[]; canMoney: boolean; onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState({
    visaCategory: vc.visaCategory ?? "", travelDate: dInput(vc.travelDate), intendedStay: vc.intendedStay ?? "",
    submissionDate: dInput(vc.submissionDate), appointmentDate: dInput(vc.appointmentDate),
    biometricsDate: dInput(vc.biometricsDate), expectedDecisionDate: dInput(vc.expectedDecisionDate),
    decisionDate: dInput(vc.decisionDate), visaValidityUntil: dInput(vc.visaValidityUntil),
    visaFee: String(vc.visaFee), serviceFee: String(vc.serviceFee), sellingPrice: String(vc.sellingPrice),
    supplierId: vc.supplierId ?? "", internalNotes: vc.internalNotes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <Modal labelledBy="edit-case-title" onClose={onClose} width="max-w-2xl" busy={busy}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const payload: Record<string, unknown> = { ...form, visaFee: Number(form.visaFee) || 0, serviceFee: Number(form.serviceFee) || 0, sellingPrice: Number(form.sellingPrice) || 0 };
          // Without finance visibility the fee fields are hidden, so never send them back — the
          // masked zeros must not overwrite the real fees.
          if (!canMoney) { delete payload.visaFee; delete payload.serviceFee; delete payload.sellingPrice; }
          try {
            const r = await fetch(`/api/visa/cases/${vc.id}/edit`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            const d = await r.json().catch(() => ({}));
            if (r.ok) { onClose(); router.refresh(); } else setErr(d.error ?? "Could not save this case. Your edits are still here.");
          } catch {
            setErr("Connection failed. Nothing was saved — please try again.");
          } finally { setBusy(false); }
        }}
        className="space-y-4"
      >
        <h2 id="edit-case-title" className="text-lg font-semibold">Edit {vc.caseNo}</h2>
        <p className="text-xs text-slate-500">All dates below are day-month-year (DD-MM-YYYY).</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Visa category"><input value={form.visaCategory} onChange={(e) => setForm({ ...form, visaCategory: e.target.value })} /></Field>
          <Field label="Travel date"><input type="date" value={form.travelDate} onChange={(e) => setForm({ ...form, travelDate: e.target.value })} /></Field>
          <Field label="Intended stay"><input value={form.intendedStay} onChange={(e) => setForm({ ...form, intendedStay: e.target.value })} /></Field>
          <Field label="Submission date"><input type="date" value={form.submissionDate} onChange={(e) => setForm({ ...form, submissionDate: e.target.value })} /></Field>
          <Field label="Appointment date"><input type="date" value={form.appointmentDate} onChange={(e) => setForm({ ...form, appointmentDate: e.target.value })} /></Field>
          <Field label="Biometrics date"><input type="date" value={form.biometricsDate} onChange={(e) => setForm({ ...form, biometricsDate: e.target.value })} /></Field>
          <Field label="Expected decision"><input type="date" value={form.expectedDecisionDate} onChange={(e) => setForm({ ...form, expectedDecisionDate: e.target.value })} /></Field>
          <Field label="Actual decision"><input type="date" value={form.decisionDate} onChange={(e) => setForm({ ...form, decisionDate: e.target.value })} /></Field>
          <Field label="Visa valid until"><input type="date" value={form.visaValidityUntil} onChange={(e) => setForm({ ...form, visaValidityUntil: e.target.value })} /></Field>
          {canMoney && <>
            <Field label="Visa fee ₹"><input type="number" value={form.visaFee} onChange={(e) => setForm({ ...form, visaFee: e.target.value })} /></Field>
            <Field label="Service fee ₹"><input type="number" value={form.serviceFee} onChange={(e) => setForm({ ...form, serviceFee: e.target.value })} /></Field>
            <Field label="Selling price ₹"><input type="number" value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} /></Field>
          </>}
        </div>
        <Field label="Supplier / processing partner">
          <select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
            <option value="">— none —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Internal notes">
          <textarea rows={2} value={form.internalNotes} onChange={(e) => setForm({ ...form, internalNotes: e.target.value })} />
        </Field>
        {err && <div role="alert" className="form-error">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}</label>;
}

function docWarnings(docs: Doc[]) {
  const withW = docs.filter((d) => d.warnings?.length);
  if (!withW.length) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {withW.map((d) =>
        d.warnings.map((w, i) => (
          <div key={d.id + i} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-small text-amber-800">
            ⚠ {d.docType}: {w.message}
          </div>
        ))
      )}
    </div>
  );
}

function KV({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4 text-xs">
      <span className="text-slate-500">{k}</span>
      <span className={strong ? "font-semibold text-amber-700" : "text-right text-slate-900"}>{v}</span>
    </div>
  );
}
