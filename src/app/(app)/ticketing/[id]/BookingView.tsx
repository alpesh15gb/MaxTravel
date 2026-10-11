"use client";

import { enumLabel } from "@/lib/labels";
import { dateLabel, dateTimeLabel } from "@/lib/dates";
import { inrAmount } from "@/lib/money";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { Field, Status } from "@/components/ui";
import Modal from "@/components/Modal";
import RecordEditor from "@/components/RecordEditor";
import { useToast } from "@/lib/useToast";
import { isInFlightRefund, isWithdrawnBooking, netReceived, promisedTotal, refundedTotal } from "@/lib/receivables";

const money = (n: number | null | undefined) => (n == null ? "—" : inrAmount(n));
const dt = (s: string | null | undefined) => (s ? dateTimeLabel(s) : "—");
const dOnly = (s: string | null | undefined) => (s ? dateLabel(s) : "—");

type B = {
  id: string; bookingNo: string;
  customer: { id: string; name: string; code: string; phone: string };
  pnr: string | null; airline: string | null; gdsSource: string | null; supplier: string | null;
  status: string; sector: string | null; flightNo: string | null;
  travelDate: string | null; bookingDate: string; ticketingDeadline: string | null;
  fare: number; taxes: number; markup: number; serviceFee: number; sellingPrice: number; supplierCost: number; currency: string;
  owner: string; branch: string;
  travellers: { id: string; fullName: string; relation: string; passportNumber: string | null }[];
  tickets: { id: string; ticketNo: string; passenger: string; issueDate: string | null; issuedBy: string | null; originalFare: number; status: string }[];
  payments: { id: string; receiptNo: string; amount: number; mode: string; receivedOn: string }[];
  refunds: { id: string; refundNo: string; amount: number; reason: string | null; status: string; requestedOn: string; paidOn: string | null }[];
  reissues: { id: string; reason: string; fareDifference: number; penalty: number; supplier: string | null; status: string; reissuedBooking: string | null; createdAt: string }[];
  reissueOf: { id: string; bookingNo: string; pnr: string | null } | null;
};

type Perms = { edit: boolean; record: boolean; send: boolean; reissue: boolean; money: boolean; refund: boolean };
type SupplierOpt = { id: string; name: string };
type Tone = "neutral" | "success" | "warning" | "danger" | "info";

// Only statuses a person may set. REFUND_REQUESTED and REFUND_PENDING are gone: a refund is a record
// with its own pipeline, and offering them here let someone claim money was on its way back with no
// refund behind it and nothing recording what was owed. REFUNDED arrives on its own when a completed
// refund returns everything that came in.
const STATUSES = ["ENQUIRY", "QUOTE_SENT", "PNR_CREATED", "ON_HOLD", "PAYMENT_AWAITED", "TICKETED", "CANCELLED", "VOID", "REISSUE_REQUESTED", "REISSUED"];
const WITHDRAWING = ["CANCELLED", "VOID"];
const CLOSED = ["TICKETED", "CANCELLED", "VOID", "REFUNDED", "REISSUED"];

const statusTone = (s: string): Tone => {
  if (s === "TICKETED") return "success";
  if (s === "CANCELLED" || s === "VOID") return "danger";
  if (s.startsWith("REFUND") || s === "REISSUE_REQUESTED") return "warning";
  if (s === "PNR_CREATED" || s === "PAYMENT_AWAITED" || s === "QUOTE_SENT") return "info";
  return "neutral";
};

export default function BookingView({ b, perms, suppliers }: { b: B; perms: Perms; suppliers: SupplierOpt[] }) {
  const router = useRouter();
  const { show, toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [showTickets, setShowTickets] = useState(false);
  const [cancelTo, setCancelTo] = useState<string | null>(null);
  const [extendHrs, setExtendHrs] = useState("24");
  const [showReissue, setShowReissue] = useState(false);

  const paid = b.payments.reduce((s, p) => s + p.amount, 0);
  const refunded = refundedTotal(b.refunds);
  const netPaid = netReceived(paid, b.refunds);
  const refundsInFlight = b.refunds.filter((r) => isInFlightRefund(r.status));
  // A withdrawn sale owes nothing further; otherwise the customer owes the price minus what we kept.
  const withdrawn = isWithdrawnBooking(b.status);
  const outstanding = withdrawn ? 0 : b.sellingPrice - netPaid;
  // What cancelling this booking would still owe: money we hold, less anything a refund already
  // promised back. Positive means cancelling without answering this question writes off real money.
  const owedOnCancel = Math.max(0, Math.round((netPaid - promisedTotal(b.refunds)) * 100) / 100);
  // Margin is only knowable once the supplier cost is filled in. Until then the honest figure is
  // our own markup plus service fee — showing selling price − 0 would report the whole ticket as profit.
  const costKnown = b.supplierCost > 0;
  const margin = costKnown ? b.sellingPrice - b.supplierCost : b.markup + b.serviceFee;
  const deadlineLeft = b.ticketingDeadline ? (new Date(b.ticketingDeadline).getTime() - Date.now()) / 3600000 : null;
  const open = !CLOSED.includes(b.status);
  const urgent = deadlineLeft != null && deadlineLeft <= 8 && open;
  const warn = deadlineLeft != null && deadlineLeft <= 24 && !urgent && open;

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
      }
    } catch { show("Connection failed. Nothing was changed — please try again.", "error"); }
    finally { setBusy(false); }
  }

  return (
    <div className="workspace-page">
      <Link href="/ticketing" className="mb-3 inline-flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-teal-700"><Icon name="plane" size={15} />All bookings</Link>

      {/* Booking header */}
      <section className="panel mb-4 p-4" aria-label="Booking record">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="eyebrow">Booking workspace</div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{b.bookingNo}</h1>
              {b.pnr && <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs text-slate-700">PNR {b.pnr}</span>}
              <Status tone={urgent ? "danger" : warn ? "warning" : statusTone(b.status)}>{enumLabel(b.status)}</Status>
              {refundsInFlight.length > 0
                ? <Status tone="warning">refund in progress · {money(refundsInFlight.reduce((s, r) => s + r.amount, 0))}</Status>
                : refunded > 0 ? <Status>{money(refunded)} refunded</Status> : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
              <Link href={`/customers/${b.customer.id}`} className="font-medium text-slate-900 hover:text-teal-700">{b.customer.name}</Link>
              <span>({b.customer.code})</span>
              <span>· {b.airline ?? "—"} {b.sector ? `· ${b.sector}` : ""} · {b.owner} · {b.branch}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {perms.edit && <RecordEditor title="Edit booking" buttonLabel="Edit booking" endpoint={`/api/bookings/${b.id}`} values={{pnr:b.pnr,airline:b.airline,sector:b.sector,flightNo:b.flightNo,gdsSource:b.gdsSource,travelDate:b.travelDate?.slice(0,10)??"",ticketingDeadline:b.ticketingDeadline?new Date(new Date(b.ticketingDeadline).getTime()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):"",fare:b.fare,taxes:b.taxes,markup:b.markup,serviceFee:b.serviceFee,supplierCost:b.supplierCost}} fields={[{key:"pnr",label:"Actual PNR"},{key:"airline",label:"Airline"},{key:"sector",label:"Route / sector"},{key:"flightNo",label:"Flight number"},{key:"gdsSource",label:"Booking source"},{key:"travelDate",label:"Travel date",type:"date"},{key:"ticketingDeadline",label:"Ticketing deadline",type:"datetime-local"},...(perms.record&&!b.tickets.length&&!b.payments.length?[{key:"fare",label:"Base fare",type:"number" as const},{key:"taxes",label:"Taxes",type:"number" as const},{key:"markup",label:"Markup",type:"number" as const},{key:"serviceFee",label:"Service fee",type:"number" as const},{key:"supplierCost",label:"Supplier cost",type:"number" as const}]:[])]}/>}
            {perms.edit && (
              <select
                value={b.status}
                aria-label="Booking status" disabled={busy}
                onChange={(e) => {
                  const next = e.target.value;
                  // Cancelling or voiding a booking that still holds customer money raises a refund,
                  // so it is a decision to confirm, not a dropdown tick.
                  if (WITHDRAWING.includes(next) && owedOnCancel > 0) setCancelTo(next);
                  else if (next === "TICKETED") setShowTickets(true);
                  else post("/api/bookings/status", { bookingId: b.id, status: next }, "Status updated");
                }}
                className="control h-9 text-xs"
              >
                {STATUSES.map((s) => <option key={s} value={s}>{enumLabel(s)}</option>)}
              </select>
            )}
          </div>
        </div>
      </section>

      {/* Deadline banner */}
      {b.ticketingDeadline && open && (
        <div className={`mb-5 rounded-2xl border px-5 py-4 ${urgent ? "border-rose-200 bg-rose-50/70" : warn ? "border-amber-200 bg-amber-50/70" : "border-sky-200 bg-sky-50/70"}`}>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="min-w-0">
              <div className={`text-sm font-semibold ${urgent ? "text-rose-700" : warn ? "text-amber-800" : "text-sky-800"}`}>
                {urgent ? "URGENT: " : ""}PNR {b.pnr ?? b.bookingNo} expires {dt(b.ticketingDeadline)}
              </div>
              <div className="mt-0.5 text-xs text-slate-600">
                {b.customer.name}{perms.money ? <> · Selling {money(b.sellingPrice)} · Received {money(netPaid)}{refunded > 0 ? ` after ${money(refunded)} refunded` : ""} · Outstanding <span className="font-semibold text-amber-800">{money(outstanding)}</span></> : " · Receipts restricted for your role"}
              </div>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <a href={`tel:${b.customer.phone}`} className="btn-secondary min-h-8 px-3 py-1.5 text-xs">Call Customer</a>
              {perms.send && <button type="button" onClick={() => post("/api/whatsapp/send", { customerId: b.customer.id, template: "PNR_EXPIRY", bookingId: b.id }, "Payment reminder logged—not sent")} className="btn-secondary min-h-8 px-3 py-1.5 text-xs">WhatsApp Payment Reminder</button>}
              {perms.record && <button type="button" onClick={() => (location.href = `/payments?action=record&customer=${b.customer.id}&booking=${b.id}`)} className="btn-secondary min-h-8 px-3 py-1.5 text-xs">Record Payment</button>}
              {perms.edit && (
                <span className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs">
                  +<input aria-label="Hours to extend" value={extendHrs} onChange={(e) => setExtendHrs(e.target.value)} className="w-10 bg-transparent text-center" />
                  h
                  <button type="button" onClick={() => post("/api/bookings/extend-deadline", { bookingId: b.id, hours: Number(extendHrs) }, "✓ Deadline extended")} className="font-semibold text-teal-700 hover:underline">Extend</button>
                </span>
              )}
              {perms.edit && <button type="button" disabled={busy} onClick={() => setShowTickets(true)} className="btn-primary min-h-8 px-3 py-1.5 text-xs">Record actual tickets</button>}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {perms.reissue && b.tickets.length > 0 && !["CANCELLED", "VOID", "REFUNDED"].includes(b.status) && (
            <button type="button" onClick={() => setShowReissue(true)} className="w-full rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-xs text-slate-500 hover:border-orange-300 hover:text-orange-700">
              + Request Reissue for a ticket on this booking
            </button>
          )}

          <section className="panel p-5">
            <h2 className="mb-4 text-micro font-semibold uppercase tracking-[.12em] text-slate-500">Tickets</h2>
            {b.tickets.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500"><tr><th className="px-3 py-2 text-left font-medium">Ticket no.</th><th className="px-3 py-2 text-left font-medium">Passenger</th><th className="px-3 py-2 text-left font-medium">Issued</th><th className="px-3 py-2 text-left font-medium">By</th><th className="px-3 py-2 text-right font-medium">Fare</th><th className="px-3 py-2 text-left font-medium">Status</th></tr></thead>
                  <tbody>
                    {b.tickets.map((t) => (
                      <tr key={t.id} className="border-t border-slate-100">
                        <td className="px-3 py-2.5 font-mono">{t.ticketNo}</td>
                        <td className="px-3 py-2.5">{t.passenger}</td>
                        <td className="px-3 py-2.5 text-slate-500">{dOnly(t.issueDate)}</td>
                        <td className="px-3 py-2.5 text-slate-500">{t.issuedBy ?? "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{perms.money ? money(t.originalFare) : "Restricted"}</td>
                        <td className="px-3 py-2.5"><Status tone={t.status === "OK" ? "success" : "neutral"}>{t.status}</Status></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="text-sm text-slate-500">No ticket records yet. Enter the actual airline-issued ticket numbers; this app does not issue tickets.</div>}

            {(b.reissues.length > 0 || b.reissueOf) && (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h4 className="text-micro font-semibold uppercase tracking-[.12em] text-slate-500">Reissue chain</h4>
                  {perms.reissue && b.reissues.some((r) => ["REQUESTED", "IN_PROGRESS"].includes(r.status)) && (
                    <div className="flex flex-wrap gap-1.5">
                      {b.reissues.filter((r) => ["REQUESTED", "IN_PROGRESS"].includes(r.status)).map((r) => (
                        <span key={r.id} className="flex gap-1">
                          {r.status === "REQUESTED" && <button type="button" onClick={() => post("/api/reissues/status", { reissueId: r.id, status: "IN_PROGRESS" }, "✓ Reissue in progress")} className="btn-secondary min-h-7 px-2 py-0.5 text-small">Start</button>}
                          <button type="button" onClick={() => post("/api/reissues/status", { reissueId: r.id, status: "DONE" }, "✓ Reissue completed")} className="btn-primary min-h-7 px-2 py-0.5 text-small">Complete</button>
                          <button type="button" onClick={() => post("/api/reissues/status", { reissueId: r.id, status: "REJECTED" }, "Reissue rejected")} className="min-h-7 rounded-lg border border-rose-200 bg-rose-50 px-2 py-0.5 text-small text-rose-700">Reject</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {b.reissueOf && (
                  <div className="mb-2 text-xs text-slate-500">
                    ↩ Reissue of <Link href={`/ticketing/${b.reissueOf.id}`} className="font-medium text-teal-700 hover:underline">{b.reissueOf.bookingNo}</Link>
                    {b.reissueOf.pnr ? ` (PNR ${b.reissueOf.pnr})` : ""}
                  </div>
                )}
                {b.reissues.map((r) => (
                  <div key={r.id} className="mb-2 rounded-xl bg-slate-50 px-4 py-3 text-xs">
                    <div className="flex justify-between gap-3"><span className="font-medium">{r.reason}</span><Status tone={r.status === "DONE" ? "success" : r.status === "REJECTED" ? "danger" : "info"}>{r.status}</Status></div>
                    <div className="mt-1 text-slate-500">
                      {perms.money ? <>fare diff {money(r.fareDifference)} · penalty {money(r.penalty)}</> : "Financial details restricted"}{r.supplier ? ` · via ${r.supplier}` : ""}
                      {r.reissuedBooking && <> · <Link href={`/ticketing/${r.reissuedBooking}`} className="text-teal-700 hover:underline">reissued booking</Link></>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel p-5">
            <h2 className="mb-4 text-micro font-semibold uppercase tracking-[.12em] text-slate-500">Payments{perms.money ? ` · ${money(paid)} of ${money(b.sellingPrice)}${refunded > 0 ? ` · ${money(refunded)} refunded` : ""}` : ""}</h2>
            {!perms.money ? <div className="text-sm text-slate-500">Receipts are restricted for your role.</div> : b.payments.length ? (
              <div className="divide-y divide-slate-100">
                {b.payments.map((p) => (
                  <div key={p.id} className="flex flex-wrap justify-between gap-3 py-2.5 text-xs">
                    <span className="font-mono">{p.receiptNo}</span>
                    <span className="font-medium tabular-nums">{money(p.amount)}</span>
                    <span className="text-slate-500">{p.mode} · {dt(p.receivedOn)}</span>
                  </div>
                ))}
              </div>
            ) : <div className="text-sm text-slate-500">No payments recorded against this booking.</div>}
          </section>

          {b.refunds.length > 0 && (
            <section className="panel p-5">
              <h2 className="mb-4 text-micro font-semibold uppercase tracking-[.12em] text-slate-500">Refunds</h2>
              <div className="divide-y divide-slate-100">
                {b.refunds.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-xs">
                    <span className="font-mono">{r.refundNo}</span>
                    <span className="font-medium tabular-nums">{money(r.amount)}</span>
                    <span className="text-slate-500">{enumLabel(r.status)}{r.reason ? ` · ${r.reason}` : ""}</span>
                    <span className="text-slate-500">{r.paidOn ? `returned ${dOnly(r.paidOn)}` : `requested ${dOnly(r.requestedOn)}`}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 border-t border-slate-100 pt-3 text-small leading-5 text-slate-500">
                Receipts {money(paid)} · refunded {money(refunded)} · net received <span className="font-semibold text-slate-700">{money(netPaid)}</span>.{" "}
                {withdrawn ? "This sale was withdrawn, so nothing further is collectible." : "A partly refunded booking stays exactly as sold; only a completed refund that returns every receipt withdraws it."}
              </p>
            </section>
          )}
        </div>

        <aside className="min-w-0 space-y-5">
          <section className="panel space-y-2.5 p-5">
            <h2 className="text-micro font-semibold uppercase tracking-[.12em] text-slate-500">Fare breakdown</h2>
            {perms.money ? <>
              <KV k="Base fare" v={money(b.fare)} />
              <KV k={b.reissueOf ? "Airline penalty" : "Taxes"} v={money(b.taxes)} />
              <KV k="Markup" v={money(b.markup)} />
              <KV k="Service fee" v={money(b.serviceFee)} />
              <KV k="Selling price" v={money(b.sellingPrice)} strong />
              <KV k="Supplier cost" v={costKnown ? money(b.supplierCost) : "Not entered"} />
              <KV k={costKnown ? "Margin" : "Margin (set supplier cost)"} v={money(margin)} />
              {!costKnown && <p className="text-small leading-4 text-slate-500">Indicative margin from markup and service fee. Enter the supplier cost for the true margin.</p>}
            </> : <p className="text-xs text-slate-500">Fare and margin figures are restricted for your role.</p>}
            <KV k="Currency" v={b.currency} />
          </section>
          <section className="panel space-y-2.5 p-5">
            <h2 className="text-micro font-semibold uppercase tracking-[.12em] text-slate-500">Booking facts</h2>
            <KV k="GDS / source" v={b.gdsSource ?? "—"} />
            <KV k="Supplier" v={b.supplier ?? "—"} />
            <KV k="Flight" v={b.flightNo ?? "—"} />
            <KV k="Booked" v={dOnly(b.bookingDate)} />
            <KV k="Ticketing deadline" v={dt(b.ticketingDeadline)} />
            <KV k="Travel date" v={dOnly(b.travelDate)} />
            <KV k="Owner" v={b.owner} />
            <KV k="Branch" v={b.branch} />
          </section>
          <section className="panel p-5">
            <h2 className="mb-3 text-micro font-semibold uppercase tracking-[.12em] text-slate-500">Passengers</h2>
            <div className="space-y-3">
              {b.travellers.map((t) => (
                <div key={t.id} className="text-xs">
                  <span className="font-medium text-slate-900">{t.fullName}</span> <span className="text-slate-500">({t.relation})</span>
                  <div className="text-slate-500">passport {t.passportNumber ?? "—"}</div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {showTickets && <TicketForm b={b} onClose={() => setShowTickets(false)} />}
      {cancelTo && (
        <CancelForm
          b={b}
          status={cancelTo}
          owed={owedOnCancel}
          canRefund={perms.refund}
          onClose={() => setCancelTo(null)}
          onDone={() => { setCancelTo(null); router.refresh(); }}
        />
      )}
      {showReissue && <ReissueForm b={b} suppliers={suppliers} onClose={() => setShowReissue(false)} />}
      {toast}
    </div>
  );
}

function ReissueForm({ b, suppliers, onClose }: { b: B; suppliers: SupplierOpt[]; onClose: () => void }) {
  const [form, setForm] = useState({
    originalTicketId: b.tickets[0]?.id ?? "", reason: "Date change",
    fareDifference: "", penalty: "", serviceFee: "", pnr: b.pnr ?? "", sector: b.sector ?? "",
    travelDate: b.travelDate ? new Date(b.travelDate).toISOString().slice(0, 10) : "",
    supplierId: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <Modal labelledBy="reissue-form-title" onClose={onClose} width="max-w-lg" busy={busy}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await fetch("/api/reissues", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...form, fareDifference: Number(form.fareDifference) || 0, penalty: Number(form.penalty) || 0, serviceFee: Number(form.serviceFee) || 0, supplierId: form.supplierId || null }),
            });
            const d = await r.json().catch(() => ({}));
            if (r.ok) { onClose(); location.href = `/ticketing/${d.reissueBookingId}`; }
            else setErr(d.error ?? "Could not create the reissue. Your details are still here.");
          } catch {
            setErr("Connection failed. Nothing was created — please try again.");
          } finally { setBusy(false); }
        }}
        className="space-y-4"
      >
        <h2 id="reissue-form-title" className="text-lg font-semibold">Request Reissue — {b.bookingNo}</h2>
        <div className="form-grid">
          <Field label="Original ticket *">
            <select value={form.originalTicketId} onChange={(ev) => setForm({ ...form, originalTicketId: ev.target.value })}>
              {b.tickets.map((t) => <option key={t.id} value={t.id}>{t.ticketNo} — {t.passenger} ({t.status})</option>)}
            </select>
          </Field>
          <Field label="Reason *"><input value={form.reason} onChange={(ev) => setForm({ ...form, reason: ev.target.value })} required /></Field>
          <Field label="New travel date"><input type="date" value={form.travelDate} onChange={(ev) => setForm({ ...form, travelDate: ev.target.value })} /></Field>
          <Field label="Fare difference ₹"><input type="number" value={form.fareDifference} onChange={(ev) => setForm({ ...form, fareDifference: ev.target.value })} /></Field>
          <Field label="Airline penalty ₹"><input type="number" value={form.penalty} onChange={(ev) => setForm({ ...form, penalty: ev.target.value })} /></Field>
          <Field label="Service fee ₹"><input type="number" value={form.serviceFee} onChange={(ev) => setForm({ ...form, serviceFee: ev.target.value })} /></Field>
          <Field label="Supplier">
            <select value={form.supplierId} onChange={(ev) => setForm({ ...form, supplierId: ev.target.value })}>
              <option value="">— keep original —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="PNR"><input value={form.pnr} onChange={(ev) => setForm({ ...form, pnr: ev.target.value })} /></Field>
          <Field label="Sector"><input value={form.sector} onChange={(ev) => setForm({ ...form, sector: ev.target.value })} /></Field>
        </div>
        {err && <div role="alert" className="form-error">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Create reissue request"}</button>
        </div>
      </form>
    </Modal>
  );
}

function TicketForm({ b, onClose }: { b: B; onClose: () => void }) {
  const router = useRouter();
  const [tickets, setTickets] = useState(b.travellers.filter(t => !b.tickets.some(x => x.status === "OK" && x.passenger === t.fullName)).map(t => ({ travellerId: t.id, name: t.fullName, ticketNo: "", originalFare: "" })));
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { const r = await fetch("/api/bookings/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingId: b.id, status: "TICKETED", tickets }) }); const d = await r.json().catch(() => ({})); if (!r.ok) { setError(d.error ?? "Could not record these tickets. Nothing was saved."); return; } onClose(); router.refresh(); }
    catch { setError("Connection failed. Nothing was saved — your ticket numbers are still here."); } finally { setBusy(false); }
  }
  return (
    <Modal labelledBy="ticket-form-title" onClose={onClose} width="max-w-xl" busy={busy}>
      <form onSubmit={submit} className="space-y-5">
        <h2 id="ticket-form-title" className="text-xl font-semibold">Record airline-issued tickets</h2>
        <p className="text-xs leading-6 text-slate-500">Enter the real ticket numbers from your airline or GDS. Saving records them locally and marks this booking ticketed; it does not issue or charge for a ticket.</p>
        {tickets.map((t, i) => (
          <div key={t.travellerId} className="space-y-3 rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold">{t.name}</h3>
            <div className="form-grid">
              <Field label="Actual ticket number *"><input required pattern="[0-9]{3}-?[0-9]{10}" placeholder="13-digit airline ticket number" value={t.ticketNo} onChange={e => setTickets(tickets.map((x, j) => j === i ? { ...x, ticketNo: e.target.value } : x))} /></Field>
              <Field label="Ticket fare (INR)"><input type="number" min="0" step="0.01" value={t.originalFare} onChange={e => setTickets(tickets.map((x, j) => j === i ? { ...x, originalFare: e.target.value } : x))} /></Field>
            </div>
          </div>
        ))}
        {error && <div role="alert" className="form-error">{error}</div>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Record & mark ticketed"}</button></div>
      </form>
    </Modal>
  );
}

/**
 * Cancelling a booking that still holds the customer's money.
 *
 * The money has to go somewhere the agency can still see. Setting CANCELLED on its own removed the
 * booking from receivables and left the refund owed recorded nowhere at all, so this asks for the
 * amount and raises that refund as part of the same save.
 */
function CancelForm({ b, status, owed, canRefund, onClose, onDone }: {
  b: B; status: string; owed: number; canRefund: boolean;
  onClose: () => void; onDone: () => void;
}) {
  const [amount, setAmount] = useState(String(owed));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const returned = Number(amount) || 0;
  const retained = Math.round((owed - returned) * 100) / 100;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/bookings/status", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: b.id, status, refundAmount: returned }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "Could not update this booking. Nothing was saved."); return; }
      onDone();
    } catch { setError("Connection failed. Nothing was saved — please try again."); }
    finally { setBusy(false); }
  }

  return (
    <Modal labelledBy="cancel-form-title" onClose={onClose} width="max-w-lg" busy={busy}>
      <form onSubmit={submit} className="space-y-5">
        <h2 id="cancel-form-title" className="text-xl font-semibold">
          {status === "VOID" ? "Void" : "Cancel"} {b.bookingNo}
        </h2>
        <p className="text-xs leading-6 text-slate-500">
          This booking holds <strong className="font-semibold text-slate-900">{money(owed)}</strong> of customer money that
          no refund has promised back yet. Marking it {status === "VOID" ? "void" : "cancelled"} takes it out of
          receivables, so raise the refund here — it goes to the Refunds desk and is paid through the normal approval pipeline.
        </p>
        {!canRefund && (
          <p role="alert" className="form-error">
            You do not have permission to raise refunds, so this cannot be cancelled from here. Ask a manager or
            accounts colleague to cancel it once the money position is agreed.
          </p>
        )}
        {canRefund && (
          <>
            <Field label="Refund owed to the customer *" hint={`Up to ${money(owed)}.`}>
              <input type="number" min="0.01" max={owed} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <p className="text-xs leading-6 text-slate-500">
              {returned > owed
                ? "That is more than this booking still holds."
                : retained > 0
                  ? <>You are retaining <strong className="font-semibold text-slate-900">{money(retained)}</strong>. A retained amount needs no refund record, so record why in the customer&rsquo;s notes.</>
                  : <>The full amount is being returned to the customer.</>}
            </p>
          </>
        )}
        {error && <div role="alert" className="form-error">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Back</button>
          <button className="btn-primary" disabled={busy || !canRefund || returned > owed}>
            {busy ? "Saving…" : status === "VOID" ? "Void booking" : "Cancel booking"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function KV({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4 text-xs">
      <span className="text-slate-500">{k}</span>
      <span className={strong ? "font-semibold text-slate-900" : "text-right text-slate-700"}>{v}</span>
    </div>
  );
}
