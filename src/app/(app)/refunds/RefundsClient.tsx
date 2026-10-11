"use client";

import { enumLabel } from "@/lib/labels";
import { dateLabel } from "@/lib/dates";
import { inrFixed } from "@/lib/money";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, EmptyState, Field, Status } from "@/components/ui";
import ActionDialog from "@/components/ActionDialog";
import Modal from "@/components/Modal";
import { useToast } from "@/lib/useToast";

type R = {
  id: string; refundNo: string; customer: string; customerId: string; amount: number;
  reason: string | null; status: string; requestedOn: string;
  supplierSentOn: string | null; supplierReceivedOn: string | null; paidOn: string | null;
  booking: { bookingNo: string; id: string } | null;
};

const PIPELINE: Record<string, string | null> = {
  REQUESTED: "SUPPLIER_PENDING",
  SUPPLIER_PENDING: "SUPPLIER_RECEIVED",
  SUPPLIER_RECEIVED: "APPROVED",
  APPROVED: "PROCESSED",
  PROCESSED: "PAID",
  PAID: null,
  REJECTED: null,
};

// The order a refund travels through. REJECTED sits outside the line.
const STEPS = ["REQUESTED", "SUPPLIER_PENDING", "SUPPLIER_RECEIVED", "APPROVED", "PROCESSED", "PAID"] as const;
const STEP_LABEL: Record<string, string> = {
  REQUESTED: "Requested", SUPPLIER_PENDING: "Sent to supplier", SUPPLIER_RECEIVED: "Supplier replied",
  APPROVED: "Approved", PROCESSED: "Processed", PAID: "Paid",
};

const toneOf = (s: string): "neutral" | "success" | "warning" | "danger" | "info" => {
  if (s === "PAID") return "success";
  if (s === "REJECTED") return "danger";
  if (s === "REQUESTED" || s === "SUPPLIER_PENDING") return "warning";
  if (s === "SUPPLIER_RECEIVED" || s === "APPROVED" || s === "PROCESSED") return "info";
  return "neutral";
};

const money = (n: number) => inrFixed(n);
const dOnly = (s: string | null) => (s ? dateLabel(s) : "—");

// Shows how far a refund has travelled. Rejected refunds show a red stop instead of the line.
function Progress({ status }: { status: string }) {
  if (status === "REJECTED") return <Status tone="danger">Rejected</Status>;
  const at = STEPS.indexOf(status as (typeof STEPS)[number]);
  return (
    <ol aria-label={`Progress: ${STEP_LABEL[status] ?? status}`} className="flex items-center gap-1">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-1" title={STEP_LABEL[s]}>
          <span className={`h-2 w-2 rounded-full ${i <= at ? "bg-teal-600" : "bg-slate-200"}`} aria-hidden="true" />
          {i < STEPS.length - 1 && <span className={`h-px w-4 ${i < at ? "bg-teal-600" : "bg-slate-200"}`} aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

function RefundForm({ bookings, onClose }: { bookings: BookingOption[]; onClose: () => void }) {
  const router = useRouter(); const [bookingId, setBooking] = useState(""); const [amount, setAmount] = useState(""); const [reason, setReason] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const booking = bookings.find(b => b.id === bookingId);
  async function submit(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(""); try { const r = await fetch("/api/refunds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId: booking?.customerId, bookingId, amount: Number(amount), reason }) }); const d = await r.json().catch(() => ({})); if (!r.ok) { setError(d.error ?? "Could not request refund."); return; } onClose(); router.refresh(); } catch { setError("Connection failed. Please try again."); } finally { setBusy(false); } }
  return <Modal label="Request refund" onClose={onClose} width="max-w-lg" busy={busy}><form className="space-y-5" onSubmit={submit}><h2 className="text-xl font-semibold">Request a refund</h2><Field label="Booking *"><select required value={bookingId} onChange={e => { setBooking(e.target.value); setAmount(""); }}><option value="">Choose a booking</option>{bookings.filter(b => b.refundable > 0).map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select></Field>{booking && <p className="rounded-xl bg-teal-50 p-3 text-xs text-teal-800">Available recorded receipts: {money(booking.refundable)}</p>}<Field label="Requested amount (INR) *"><input required type="number" min="0.01" step="0.01" max={booking?.refundable} value={amount} onChange={e => setAmount(e.target.value)} /></Field><Field label="Reason *"><textarea required rows={3} value={reason} onChange={e => setReason(e.target.value)} /></Field>{!bookings.some(b => b.refundable > 0) && <p className="text-xs text-slate-500">No bookings have refundable recorded receipts yet.</p>}{error && <div role="alert" className="form-error">{error}</div>}<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Create refund request"}</button></div></form></Modal>;
}

type BookingOption = { id: string; customerId: string; label: string; refundable: number };

export default function RefundsClient({ refunds, focus, canManage, canExport, canApprove, bookings }: { refunds: R[]; focus: string | null; canManage: boolean; canExport?: boolean; canApprove: boolean; bookings: BookingOption[] }) {
  const router = useRouter();
  const { show, toast } = useToast();
  const [showNew, setShowNew] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<R | null>(null);
  const [rejectError, setRejectError] = useState("");
  const [busy, setBusy] = useState(false);

  async function advance(r: R) {
    if (busy) return;
    const next = PIPELINE[r.status];
    if (!next) return;
    const extra: Record<string, unknown> = {};
    if (next === "SUPPLIER_PENDING") extra.supplierSentOn = new Date().toISOString();
    if (next === "SUPPLIER_RECEIVED") extra.supplierReceivedOn = new Date().toISOString();
    if (next === "PAID") extra.paidOn = new Date().toISOString();
    setBusy(true);
    try {
      const res = await fetch("/api/refunds/update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refundId: r.id, status: next, ...extra }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok) {
        show(`${r.refundNo} → ${enumLabel(next)}`);
        router.refresh();
      } else {
        show(result.error ?? "Could not update refund.", "error");
      }
    } catch {
      show("Connection failed. The refund was not changed.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function reject(reason: string) {
    const r = rejectTarget;
    if (!r || busy) return;
    setBusy(true);
    setRejectError("");
    try {
      const res = await fetch("/api/refunds/update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refundId: r.id, status: "REJECTED", rejectionReason: reason }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Keep the dialog open so the reason already typed is not thrown away.
        setRejectError(result.error ?? "Could not reject refund.");
        return;
      }
      show(`${r.refundNo} rejected`);
      setRejectTarget(null);
      router.refresh();
    } catch {
      setRejectError("Connection failed. Your reason is still here — please retry.");
    } finally {
      setBusy(false);
    }
  }

  const pending = useMemo(() => refunds.filter(r => !["PAID", "REJECTED"].includes(r.status)), [refunds]);
  const closed = useMemo(() => refunds.filter(r => ["PAID", "REJECTED"].includes(r.status)), [refunds]);

  function renderRow(r: R) {
    const next = PIPELINE[r.status];
    return <li key={r.id} id={r.id} className={`grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_200px_auto] lg:items-center ${focus === r.id ? "bg-teal-50/60" : ""}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-xs text-slate-500">{r.refundNo}</span>
          <span className="text-sm font-semibold tabular-nums">{money(r.amount)}</span>
          <Link href={`/customers/${r.customerId}`} className="text-sm text-slate-700 hover:text-teal-700">{r.customer}</Link>
          {r.booking && <Link href={`/ticketing/${r.booking.id}`} className="text-xs text-slate-500 hover:text-teal-700">{r.booking.bookingNo}</Link>}
        </div>
        <div className="mt-1 text-xs text-slate-600">{r.reason}</div>
        <div className="mt-1 text-small text-slate-500">
          requested {dOnly(r.requestedOn)}
          {r.supplierSentOn ? ` · sent to supplier ${dOnly(r.supplierSentOn)}` : ""}
          {r.supplierReceivedOn ? ` · supplier received ${dOnly(r.supplierReceivedOn)}` : ""}
          {r.paidOn ? ` · paid ${dOnly(r.paidOn)}` : ""}
        </div>
      </div>
      {/* items-start: a flex column stretches its children, which turned the status badge into a
          full-width bar instead of a pill hugging its own label. */}
      <div className="flex flex-col items-start gap-2">
        <Status tone={toneOf(r.status)}>{enumLabel(r.status)}</Status>
        <Progress status={r.status} />
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        {canManage && next && (next !== "APPROVED" || canApprove) && (
          <button type="button" disabled={busy} onClick={() => advance(r)} className="btn-secondary min-h-8 px-3 py-1.5 text-xs">
            → {enumLabel(next)}
          </button>
        )}
        {canManage && !["PAID", "REJECTED"].includes(r.status) && (
          <button type="button" disabled={busy} onClick={() => { setRejectError(""); setRejectTarget(r); }} className="min-h-8 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:border-rose-300">
            Reject
          </button>
        )}
      </div>
    </li>;
  }

  return (
    <div className="workspace-page">
      <PageHeader title="Refunds" description="Refund requests recorded against bookings. No money is transferred by this app." actions={<>{canExport && <a href="/api/export?entity=refunds" className="btn-secondary">Export CSV</a>}{canManage && <button className={refunds.length ? "btn-primary" : "btn-secondary"} onClick={() => setShowNew(true)}>Request refund</button>}</>} />

      <div className="summary-strip">
        <div className="px-3 py-2.5"><div className="text-small font-medium text-slate-500">Pending</div><div className="mt-1 text-2xl font-semibold tabular-nums">{pending.length}</div></div>
        <div className="px-3 py-2.5"><div className="text-small font-medium text-slate-500">Awaiting closure</div><div className="mt-1 text-2xl font-semibold tabular-nums">{money(pending.reduce((s, r) => s + r.amount, 0))}</div></div>
      </div>

      {refunds.length === 0 && <EmptyState icon="refund" title="No refund requests yet" description="Create a request against a real booking with recorded receipts. Approval and payout stay separate, traceable steps." action={canManage ? "Request a refund" : undefined} onAction={() => setShowNew(true)} />}

      {pending.length > 0 && <section aria-label="Pending refunds" className="mb-6">
        <h2 className="mb-2 px-1 text-micro font-semibold uppercase tracking-[.14em] text-slate-600">In progress <span className="ml-1 tabular-nums text-slate-600">{pending.length}</span></h2>
        <ul className="panel divide-y divide-slate-100 overflow-hidden">{pending.map(renderRow)}</ul>
      </section>}

      {closed.length > 0 && <section aria-label="Closed refunds">
        <h2 className="mb-2 px-1 text-micro font-semibold uppercase tracking-[.14em] text-slate-600">Closed <span className="ml-1 tabular-nums text-slate-600">{closed.length}</span></h2>
        <ul className="panel divide-y divide-slate-100 overflow-hidden">{closed.map(renderRow)}</ul>
      </section>}

      {showNew && <RefundForm bookings={bookings} onClose={() => setShowNew(false)} />}

      {rejectTarget && <ActionDialog
        title={`Reject ${rejectTarget.refundNo}?`}
        description="The refund is closed as rejected and the reason is written to the audit trail. This cannot be undone from this screen."
        fieldLabel="Reason for rejection"
        fieldType="textarea"
        required
        requiredMessage="Give a reason — it is recorded on the audit trail."
        confirmLabel="Reject refund"
        tone="danger"
        busy={busy}
        error={rejectError}
        onClose={() => { if (!busy) { setRejectTarget(null); setRejectError(""); } }}
        onConfirm={reason => void reject(reason)}
      />}

      {toast}
    </div>
  );
}
