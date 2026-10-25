"use client";

import { enumLabel } from "@/lib/labels";
import { dateLabel } from "@/lib/dates";
import { inrAmount } from "@/lib/money";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "@/components/Icon";
import { PageHeader, EmptyState, StatCard, Field, Status, SearchInput } from "@/components/ui";
import RecordEditor from "@/components/RecordEditor";
import ActionDialog from "@/components/ActionDialog";
import Modal from "@/components/Modal";

type Settlement = { id: string; amount: number; method: string; reference: string | null; note: string | null; settledOn: string; recordedBy: string; reversedOn: string | null; reversedBy: string | null; reversalReason: string | null };
type Due = { id: string; description: string; supplierInvoiceNo: string | null; bookingId: string | null; bookingNo: string | null; amount: number; paidAmount: number; paid: boolean; paidOn: string | null; dueDate: string; settlements: Settlement[] };
type BookingOption = { id: string; bookingNo: string; product: string; supplierId: string; customer: string; service: string };
type Supplier = { id: string; name: string; type: string; phone: string | null; city: string | null; paymentDueDays: number; visaCases: number; bookings: number; dues: Due[] };
const money = (n: number) => inrAmount(n);
const TYPES = ["AIRLINE", "HOTEL", "BOOKING_PLATFORM", "VISA_PROCESSOR", "CONSOLIDATOR", "CONSULTANT", "OTHER"];

export default function SuppliersClient({ suppliers, focus, canManage, canViewBookings, bookings }: { canViewBookings: boolean; suppliers: Supplier[]; focus: string | null; canManage: boolean; bookings: BookingOption[] }) {
  const router = useRouter();
  const [formType, setFormType] = useState<"supplier" | "due" | "edit" | "">("");
  const [editingDue, setEditingDue] = useState<Due | null>(null);
  const [q, setQ] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState("");
  const [busy, setBusy] = useState(false);
  // Acknowledgement and refreshed server props arrive separately. Never open another
  // money form from the old Due snapshot between those two events.
  const [pendingBalance, setPendingBalance] = useState<{ dueId: string; paidAmount: number; settlementId: string; reversed: boolean } | null>(null);
  const mutationInFlight = useRef(false);
  const awaitingBalance = useRef(false);
  const moneyLocked = () => mutationInFlight.current || awaitingBalance.current;
  const moneyBusy = busy || pendingBalance !== null;
  useEffect(() => {
    if (!pendingBalance) return;
    const due = suppliers.flatMap(supplier => supplier.dues).find(item => item.id === pendingBalance.dueId);
    const settlement = due?.settlements.find(item => item.id === pendingBalance.settlementId);
    if (due && settlement && Math.round(due.paidAmount * 100) === Math.round(pendingBalance.paidAmount * 100) && Boolean(settlement.reversedOn) === pendingBalance.reversed) {
      awaitingBalance.current = false;
      setPendingBalance(null);
    }
  }, [suppliers, pendingBalance]);
  const [settleTarget, setSettleTarget] = useState<Due | null>(null);
  const [reverseTarget, setReverseTarget] = useState<{ due: Due; settlement: Settlement } | null>(null);
  const report = (message: string, error = false) => { setNotice(error ? "" : message); setNoticeError(error ? message : ""); };
  const dues = suppliers.flatMap((supplier) => supplier.dues.filter((due) => !due.paid));
  const overdue = dues.filter((due) => new Date(due.dueDate).getTime() < Date.now());

  async function recordSettlement(payload: { dueId: string; amount: number; method: string; settledOn: string; reference: string; note: string; requestKey: string }) {
    if (moneyLocked()) return false;
    mutationInFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/suppliers/dues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { report(data.error ?? "Could not record the supplier payment.", true); return false; }
      const expectedBalance = { dueId: payload.dueId, paidAmount: data.due.paidAmount, settlementId: data.settlement.id, reversed: Boolean(data.settlement.reversedOn) };
      awaitingBalance.current = true;
      setPendingBalance(expectedBalance);
      report("Payment recorded against the payable. No funds were transferred.");
      router.refresh();
      return true;
    } catch { report("Connection failed. Please try again.", true); return false; }
    finally { mutationInFlight.current = false; setBusy(false); }
  }

  async function reverseSettlement(reason: string) {
    if (!reverseTarget || moneyLocked()) return;
    mutationInFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/suppliers/dues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reverse", dueId: reverseTarget.due.id, settlementId: reverseTarget.settlement.id, reason }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { report(data.error ?? "Could not reverse the settlement.", true); return; }
      awaitingBalance.current = true;
      setPendingBalance({ dueId: reverseTarget.due.id, paidAmount: data.paidAmount, settlementId: reverseTarget.settlement.id, reversed: true });
      setReverseTarget(null);
      report("Settlement reversed. The original payment record remains in the audit history.");
      router.refresh();
    } catch { report("Connection failed. Please try again.", true); }
    finally { mutationInFlight.current = false; setBusy(false); }
  }

  function openForm(kind: "supplier" | "due" | "edit", due?: Due) { setEditingDue(due ?? null); setFormType(kind); }

  return <div className="workspace-page">
    <PageHeader title="Suppliers & payables" description="Track airline, hotel, platform and service partners, with booking-linked obligations and a complete settlement history." actions={canManage ? <><button className="btn-secondary" disabled={!suppliers.length} onClick={() => openForm("due")}>Add payable</button><button className={suppliers.length ? "btn-primary" : "btn-secondary"} onClick={() => openForm("supplier")}><Icon name="plus" size={16} />New supplier</button></> : undefined} />
    <div className="summary-strip"><StatCard label="Suppliers" value={suppliers.length} icon="suppliers" /><StatCard label="Open payables" value={money(dues.reduce((sum, due) => sum + due.amount - due.paidAmount, 0))} icon="wallet" note="Remaining balance on open payables" /><StatCard label="Overdue payables" value={overdue.length} icon="clock" tone={overdue.length ? "rose" : "neutral"} /></div>
    {notice && <div role="status" className="form-success mb-4">{notice}</div>}{noticeError && <div role="alert" className="form-error mb-4">{noticeError}</div>}
    {pendingBalance && <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">Updating payable balances and payment history. Money actions are paused until the saved change is confirmed on this page. If this takes too long, <button type="button" className="font-semibold underline" onClick={() => window.location.reload()}>Reload balances</button>. Reloading does not record another payment.</div>}
    <div className="mb-5"><SearchInput label="Filter suppliers" placeholder="Search suppliers…" value={q} onChange={setQ} /></div>
    {!suppliers.length ? <EmptyState icon="suppliers" title="No suppliers yet" description="Add real suppliers so your bookings, visa cases and payables stay connected." action={canManage ? "Add your first supplier" : undefined} onAction={() => openForm("supplier")} /> : <div className="space-y-4">
      {suppliers.filter((supplier) => `${supplier.name} ${supplier.city ?? ""}`.toLowerCase().includes(q.toLowerCase())).map((supplier) => {
        const open = supplier.dues.filter((due) => !due.paid);
        const paid = supplier.dues.filter((due) => due.paid);
        const openBalance = open.reduce((sum, due) => sum + due.amount - due.paidAmount, 0);
        return <article key={supplier.id} className={`panel p-5 ${focus === supplier.id ? "ring-2 ring-teal-200" : ""}`}>
          <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex gap-3"><span className="rounded-xl bg-teal-50 p-3 text-teal-700"><Icon name="suppliers" /></span><div><h2 className="font-semibold">{supplier.name}</h2><p className="mt-1 text-xs text-slate-500">{enumLabel(supplier.type)} · {supplier.city ?? "City not set"}</p><p className="mt-2 text-xs text-slate-500">{supplier.phone ?? "Phone not set"} · Payment terms {supplier.paymentDueDays} days</p></div></div><Status tone={open.length ? "warning" : "neutral"}>{open.length ? `${money(openBalance)} open` : "No open payables"}</Status></div>
          {canManage && <div className="mt-4"><RecordEditor title={`Edit ${supplier.name}`} buttonLabel="Edit supplier" endpoint={`/api/suppliers/${supplier.id}`} values={{ name: supplier.name, type: supplier.type, phone: supplier.phone ?? "", city: supplier.city ?? "", paymentDueDays: String(supplier.paymentDueDays) }} fields={[{ key: "name", label: "Supplier name", required: true }, { key: "type", label: "Supplier type", type: "select", options: TYPES.map((value) => ({ value, label: enumLabel(value) })) }, { key: "phone", label: "Phone", type: "tel" }, { key: "city", label: "City" }, { key: "paymentDueDays", label: "Payment terms (days)", type: "number" }]} /></div>}
          {!!open.length && <div className="mt-5 space-y-3 border-t border-slate-100 pt-4"><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open payables</h3>{open.map((due) => <PayableCard canViewBookings={canViewBookings} key={due.id} due={due} canManage={canManage} busy={moneyBusy} onPay={() => { if (!moneyLocked()) setSettleTarget(due); }} onEdit={() => { if (!moneyLocked()) openForm("edit", due); }} onReverse={(settlement) => { if (!moneyLocked()) setReverseTarget({ due, settlement }); }} />)}</div>}
          {!!paid.length && <details className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500"><summary className="cursor-pointer font-medium">Paid history ({paid.length})</summary><div className="mt-3 space-y-3">{paid.map((due) => <PayableCard canViewBookings={canViewBookings} key={due.id} due={due} canManage={canManage} busy={moneyBusy} onPay={() => { if (!moneyLocked()) setSettleTarget(due); }} onEdit={() => { if (!moneyLocked()) openForm("edit", due); }} onReverse={(settlement) => { if (!moneyLocked()) setReverseTarget({ due, settlement }); }} />)}</div></details>}
        </article>;
      })}
    </div>}
    {formType && <SupplierForm kind={formType} suppliers={suppliers} bookings={bookings} due={editingDue} onClose={() => { setFormType(""); setEditingDue(null); }} onSaved={() => { setFormType(""); setEditingDue(null); report(formType === "supplier" ? "Supplier added." : formType === "edit" ? "Payable updated." : "Payable added."); router.refresh(); }} />}
    {settleTarget && <SupplierSettlementDialog due={settleTarget} busy={busy} error={noticeError} onClose={() => { setSettleTarget(null); setNoticeError(""); }} onSubmit={recordSettlement} />}
    {reverseTarget && <ActionDialog title="Reverse supplier settlement" description={`Reverse ${money(reverseTarget.settlement.amount)} recorded on ${dateLabel(reverseTarget.settlement.settledOn)}. This updates the payable balance and keeps the original payment and reason in the record.`} fieldLabel="Reason for reversal *" fieldType="text" required confirmLabel="Reverse settlement" busy={busy} error={noticeError} onClose={() => { setReverseTarget(null); setNoticeError(""); }} onConfirm={(reason) => { if (reason.trim().length < 5) { report("Enter a reason of at least five characters.", true); return; } void reverseSettlement(reason); }} />}
  </div>;
}

function PayableCard({ due, canManage, canViewBookings, busy, onPay, onEdit, onReverse }: { due: Due; canManage: boolean; canViewBookings: boolean; busy: boolean; onPay: () => void; onEdit: () => void; onReverse: (settlement: Settlement) => void }) {
  const remaining = Math.round((due.amount - due.paidAmount) * 100) / 100;
  return <div className="rounded-xl bg-slate-50 p-3 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">{due.description}</p><p className="mt-1 text-slate-500">Due {dateLabel(due.dueDate)}{due.supplierInvoiceNo ? ` · Invoice ${due.supplierInvoiceNo}` : ""}{canViewBookings && due.bookingId && due.bookingNo ? <> · <Link className="text-teal-700 underline" href={`/ticketing/${due.bookingId}`}>Booking {due.bookingNo}</Link></> : due.bookingNo ? ` · Booking ${due.bookingNo}` : ""}{due.paidAmount > 0 ? ` · settled ${money(due.paidAmount)} of ${money(due.amount)}` : ""}</p></div><div className="flex items-center gap-3"><span className="font-semibold">{money(remaining)}</span>{canManage && !due.paid && <><button disabled={busy} onClick={onPay} className="btn-secondary text-xs">Record payment</button>{due.paidAmount === 0 && <button disabled={busy} onClick={onEdit} className="text-xs text-slate-500">Edit</button>}</>}</div></div>
    {!!due.settlements.length && <details className="mt-3 border-t border-slate-200 pt-2"><summary className="cursor-pointer font-medium text-slate-600">Payment history ({due.settlements.length})</summary><div className="mt-2 space-y-2">{due.settlements.map((settlement) => <div key={settlement.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-white p-3"><div><p className="font-medium text-slate-700">{money(settlement.amount)} · {enumLabel(settlement.method)} · {dateLabel(settlement.settledOn)}</p><p className="mt-1 text-slate-500">Recorded by {settlement.recordedBy}{settlement.reference ? ` · Ref ${settlement.reference}` : ""}{settlement.note ? ` · ${settlement.note}` : ""}</p>{settlement.reversedOn && <p className="mt-1 text-rose-700">Reversed {dateLabel(settlement.reversedOn)} by {settlement.reversedBy ?? "staff"}: {settlement.reversalReason}</p>}</div>{canManage && !settlement.reversedOn && <button disabled={busy} className="text-xs font-medium text-rose-700 hover:underline" onClick={() => onReverse(settlement)}>Reverse</button>}</div>)}</div></details>}
  </div>;
}

function SupplierSettlementDialog({ due, busy, error, onClose, onSubmit }: { due: Due; busy: boolean; error: string; onClose: () => void; onSubmit: (payload: { dueId: string; amount: number; method: string; settledOn: string; reference: string; note: string; requestKey: string }) => Promise<boolean> }) {
  const remaining = Math.round((due.amount - due.paidAmount) * 100) / 100;
  const [amount, setAmount] = useState(String(remaining));
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [settledOn, setSettledOn] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [requestKey] = useState(() => globalThis.crypto?.randomUUID?.() ?? `settlement-${Date.now()}-${Math.random()}`);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || Math.round(value * 100) > Math.round(remaining * 100)) return;
    if (await onSubmit({ dueId: due.id, amount: value, method, settledOn, reference, note, requestKey })) onClose();
  }
  return <Modal label="Record a supplier payment" onClose={onClose} width="max-w-xl" busy={busy}><form className="space-y-4" onSubmit={submit}><h2 className="text-xl font-semibold">Record supplier payment</h2><p className="text-sm leading-6 text-slate-500">{due.description} · balance {money(remaining)}. This stores an accounting record only; it does not transfer funds.</p><div className="form-grid"><Field label={`Amount (INR) · up to ${money(remaining)} *`}><input required type="number" min="0.01" max={remaining} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field><Field label="Payment method *"><select required value={method} onChange={(event) => setMethod(event.target.value)}>{["BANK_TRANSFER", "UPI", "NEFT", "CASH", "CARD", "CHEQUE", "OTHER"].map((value) => <option value={value} key={value}>{enumLabel(value)}</option>)}</select></Field><Field label="Payment date *"><input required type="date" value={settledOn} onChange={(event) => setSettledOn(event.target.value)} /></Field><Field label="Bank / supplier reference"><input aria-label="Bank / supplier reference" maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} /></Field></div><Field label="Note"><textarea rows={2} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></Field>{error && <div className="form-error" role="alert">{error}</div>}<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || Math.round(Number(amount) * 100) > Math.round(remaining * 100)}>{busy ? "Saving…" : "Record payment"}</button></div></form></Modal>;
}

function SupplierForm({ kind, suppliers, bookings, due, onClose, onSaved }: { kind: "supplier" | "due" | "edit"; suppliers: Supplier[]; bookings: BookingOption[]; due: Due | null; onClose: () => void; onSaved: () => void }) {
  const supplierForm = kind === "supplier";
  const [form, setForm] = useState({ name: supplierForm ? "" : "", type: "VISA_PROCESSOR", phone: "", city: "", contact: "", paymentDueDays: "15", supplierId: due ? suppliers.find((s) => s.dues.some((d) => d.id === due.id))?.id ?? "" : "", bookingId: due?.bookingId ?? "", supplierInvoiceNo: due?.supplierInvoiceNo ?? "", description: due?.description ?? "", amount: due ? String(due.amount) : "", dueDate: due?.dueDate.slice(0, 10) ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const field = (key: keyof typeof form, label: string, type = "text", required = false) => <Field label={label}><input type={type} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} required={required} min={type === "number" ? 0 : undefined} step={key === "amount" ? "0.01" : undefined} /></Field>;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const endpoint = supplierForm ? "/api/suppliers" : "/api/suppliers/dues";
    const payload = supplierForm ? form : kind === "edit" ? { ...form, action: "edit", dueId: due?.id } : form;
    try { const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const data = await response.json().catch(() => ({})); if (!response.ok) { setError(data.error ?? "Could not save."); return; } onSaved(); }
    catch { setError("Connection failed. Please try again."); }
    finally { setBusy(false); }
  }
  return <Modal label={supplierForm ? "New supplier" : kind === "edit" ? "Edit payable" : "New payable"} onClose={onClose} width="max-w-lg" busy={busy}><form className="space-y-4" onSubmit={submit}><h2 className="text-xl font-semibold">{supplierForm ? "Add a supplier" : kind === "edit" ? "Edit payable" : "Add a supplier payable"}</h2>
    {supplierForm ? <>{field("name", "Supplier name *", "text", true)}<Field label="Supplier type"><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>{TYPES.map((value) => <option value={value} key={value}>{enumLabel(value)}</option>)}</select></Field><div className="form-grid">{field("phone", "Phone", "tel")}{field("city", "City")}{field("contact", "Contact person")}{field("paymentDueDays", "Payment terms (days)", "number", true)}</div></> : <>
      <Field label="Supplier *"><select required disabled={kind === "edit"} value={form.supplierId} onChange={(event) => setForm({ ...form, supplierId: event.target.value })}><option value="">Select supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Related booking (optional)"><select value={form.bookingId} onChange={(event) => setForm({ ...form, bookingId: event.target.value })}><option value="">No booking linked</option>{bookings.filter((b) => b.supplierId === form.supplierId).map((b) => <option value={b.id} key={b.id}>{b.bookingNo} · {b.product} · {b.customer} · {b.service}</option>)}</select></Field>
      {field("supplierInvoiceNo", "Supplier invoice / bill number")}{field("description", "Description *", "text", true)}<div className="form-grid">{field("amount", "Amount (INR) *", "number", true)}{field("dueDate", "Due date *", "date", true)}</div><p className="text-xs leading-5 text-slate-500">Do not create a second payable for a TripJack booking already paid from the prepaid wallet.</p>
    </>}
    {error && <div className="form-error" role="alert">{error}</div>}<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div></form></Modal>;
}
