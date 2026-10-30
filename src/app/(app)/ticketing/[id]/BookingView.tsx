"use client";
import CaseReference from "@/components/CaseReference";

import { MANUAL_HOTEL_STATUSES, hotelStayProblem } from "@/lib/manual-hotel";
import { enumLabel } from "@/lib/labels";
import { bookingSourceLabel } from "@/lib/booking-policy";
import { dateLabel, dateTimeLabel } from "@/lib/dates";
import { inrAmount } from "@/lib/money";
import Link from "next/link";
import RecordSectionNav from "@/components/RecordSectionNav";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { Field, Status } from "@/components/ui";
import Modal from "@/components/Modal";
import { AuditTrailLink } from "@/components/AuditTrailLink";
import RecordEditor from "@/components/RecordEditor";
import { useToast } from "@/lib/useToast";
import { bookingCharge, isInFlightRefund, isWithdrawnBooking, netReceived, promisedTotal, refundedTotal } from "@/lib/receivables";

const money = (n: number | null | undefined) => (n == null ? "—" : inrAmount(n));
const dt = (s: string | null | undefined) => (s ? dateTimeLabel(s) : "—");
const dOnly = (s: string | null | undefined) => (s ? dateLabel(s) : "—");

type B = {
  serviceCase?:{id:string;caseNo:string}|null;
  id: string; bookingNo: string; product:string; hotelName:string|null; hotelCheckIn:string|null; hotelCheckOut:string|null; supplierId:string|null;
  customer: { id: string; name: string; code: string; phone: string };
  pnr: string | null; airline: string | null; gdsSource: string | null; supplier: string | null;
  cancellationSupplierCharge: number | null; cancellationAgencyFee: number | null; cancellationReason: string | null;
  status: string; sector: string | null; flightNo: string | null;
  travelDate: string | null; bookingDate: string; ticketingDeadline: string | null;
  fare: number; taxes: number; markup: number; serviceFee: number; sellingPrice: number; supplierCost: number; currency: string;
  owner: string; branch: string;
  travellers: { id: string; fullName: string; relation: string; passportNumber: string | null }[];
  tickets: { id: string; travellerId: string | null; ticketNo: string; passenger: string; issueDate: string | null; issuedBy: string | null; originalFare: number; status: string }[];
  payments: { id: string; receiptNo: string; amount: number; mode: string; receivedOn: string }[];
  refunds: { id: string; refundNo: string; amount: number; reason: string | null; status: string; requestedOn: string; paidOn: string | null }[];
  reissues: { id: string; reason: string; fareDifference: number; penalty: number; supplier: string | null; status: string; reissuedBooking: string | null; createdAt: string }[];
  reissueOf: { id: string; bookingNo: string; pnr: string | null } | null;
};

type Perms = { audit: boolean; invoice: boolean; edit: boolean; record: boolean; send: boolean; reissue: boolean; money: boolean; refund: boolean };
type SupplierOpt = { id: string; name: string };
type Tone = "neutral" | "success" | "warning" | "danger" | "info";

// Only statuses a person may set. REFUND_REQUESTED and REFUND_PENDING are gone: a refund is a record
// with its own pipeline, and offering them here let someone claim money was on its way back with no
// refund behind it and nothing recording what was owed. REFUNDED arrives on its own when a completed
// refund returns everything that came in.
const STATUSES = ["ENQUIRY", "QUOTE_SENT", "PNR_CREATED", "ON_HOLD", "PAYMENT_AWAITED", "TICKETED", "CANCELLED", "VOID" ];
const WITHDRAWING = ["CANCELLED", "VOID"];
const CLOSED = ["TICKETED", "CANCELLED", "VOID", "REFUNDED", "REISSUED"];

const statusTone = (s: string): Tone => {
  if (s === "TICKETED" || s === "CONFIRMED") return "success";
  if (s === "CANCELLED" || s === "VOID") return "danger";
  if (s.startsWith("REFUND") || s === "REISSUE_REQUESTED") return "warning";
  if (s === "PNR_CREATED" || s === "PAYMENT_AWAITED" || s === "QUOTE_SENT") return "info";
  return "neutral";
};

export default function BookingView({ b, perms, suppliers, passengerOptions }: { b: B; perms: Perms; suppliers: SupplierOpt[]; passengerOptions: { id: string; fullName: string }[] }) {
  const hotel=b.product==="HOTEL",statuses=hotel?MANUAL_HOTEL_STATUSES:STATUSES;
  const router = useRouter();
  const { show, toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [showPassengers, setShowPassengers] = useState(false);
  const [showTickets, setShowTickets] = useState(false);
  const [showHotelConfirmation,setShowHotelConfirmation]=useState(false);
  const [cancelTo, setCancelTo] = useState<string | null>(null);
  const [extendHrs, setExtendHrs] = useState("24");
  const [showReissue, setShowReissue] = useState(false);

  const paid = b.payments.reduce((s, p) => s + p.amount, 0);
  const refunded = refundedTotal(b.refunds);
  const netPaid = netReceived(paid, b.refunds);
  const refundsInFlight = b.refunds.filter((r) => isInFlightRefund(r.status));
  // A withdrawn sale owes nothing further; otherwise the customer owes the price minus what we kept.
  const withdrawn = isWithdrawnBooking(b.status);
  const outstanding = Math.max(0, bookingCharge(b) - netPaid);
  // What cancelling this booking would still owe: money we hold, less anything a refund already
  // promised back. Positive means cancelling without answering this question writes off real money.
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
    } catch { show("Response not received. Refresh to check whether the change saved before retrying.", "error"); }
    finally { setBusy(false); }
  }

  return (
    <div className="workspace-page"><CaseReference record={b.serviceCase}/>
      <Link href="/ticketing" className="mb-3 inline-flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-teal-700"><Icon name="plane" size={15} />All bookings</Link>

      {/* Booking header */}
      <section className="panel mb-4 p-4" aria-label="Booking record">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="eyebrow">Booking workspace</div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{b.bookingNo}</h1>
              {b.pnr && <span className="max-w-full break-all rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs text-slate-700">{hotel?"Supplier reference":"PNR"} {b.pnr}</span>}
              <Status tone={urgent ? "danger" : warn ? "warning" : statusTone(b.status)}>{enumLabel(b.status)}</Status>
              {refundsInFlight.length > 0
                ? <Status tone="warning">refund in progress · {money(refundsInFlight.reduce((s, r) => s + r.amount, 0))}</Status>
                : refunded > 0 ? <Status>{money(refunded)} refunded</Status> : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
              <Link href={`/customers/${b.customer.id}`} className="font-medium text-slate-900 hover:text-teal-700">{b.customer.name}</Link>
              <span>({b.customer.code})</span>
              <span className="min-w-0 [overflow-wrap:anywhere]">· {hotel?b.hotelName??"Hotel not entered":b.airline??"—"} {b.sector ? `· ${b.sector}` : ""} · {b.owner} · {b.branch}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <AuditTrailLink entity="Booking" entityId={b.id} allowed={perms.audit} />
            {perms.edit && !withdrawn && (hotel ? <RecordEditor title="Edit hotel stay" buttonLabel="Edit hotel stay" endpoint={`/api/bookings/${b.id}`} values={{hotelName:b.hotelName,hotelCheckIn:b.hotelCheckIn?.slice(0,10)??"",hotelCheckOut:b.hotelCheckOut?.slice(0,10)??"",pnr:b.pnr,sector:b.sector,supplierId:b.supplierId??"",gdsSource:b.gdsSource,...(perms.record&&perms.money&&!b.payments.length?{fare:b.fare,taxes:b.taxes,markup:b.markup,serviceFee:b.serviceFee,supplierCost:b.supplierCost}:{})}} fields={[{key:"hotelName",label:"Hotel name",maxLength:200},{key:"hotelCheckIn",label:"Check-in date",type:"date"},{key:"hotelCheckOut",label:"Check-out date",type:"date"},{key:"pnr",label:"Supplier confirmation reference",maxLength:100},{key:"sector",label:"Destination"},{key:"supplierId",label:"Supplier",type:"select",options:[{value:"",label:"No supplier linked"},...suppliers.map(s=>({value:s.id,label:s.name}))]},{key:"gdsSource",label:"Booking source"},...(perms.record&&perms.money&&!b.payments.length?[{key:"fare",label:"Room charge",type:"number" as const},{key:"taxes",label:"Taxes",type:"number" as const},{key:"markup",label:"Markup",type:"number" as const},{key:"serviceFee",label:"Service fee",type:"number" as const},{key:"supplierCost",label:"Supplier cost",type:"number" as const}]:[])]}/> : <RecordEditor title="Edit booking" buttonLabel="Edit booking" endpoint={`/api/bookings/${b.id}`} values={{pnr:b.pnr,airline:b.airline,sector:b.sector,flightNo:b.flightNo,gdsSource:b.gdsSource,travelDate:b.travelDate?.slice(0,10)??"",ticketingDeadline:b.ticketingDeadline?new Date(new Date(b.ticketingDeadline).getTime()-new Date(b.ticketingDeadline).getTimezoneOffset()*60000).toISOString().slice(0,16):"",fare:b.fare,taxes:b.taxes,markup:b.markup,serviceFee:b.serviceFee,supplierCost:b.supplierCost}} fields={[{key:"pnr",label:"Actual PNR"},{key:"airline",label:"Airline"},{key:"sector",label:"Route / sector"},{key:"flightNo",label:"Flight number"},{key:"gdsSource",label:"Booking source"},{key:"travelDate",label:"Travel date",type:"date"},{key:"ticketingDeadline",label:"Ticketing deadline",type:"datetime-local"},...(perms.record&&!b.tickets.length&&!b.payments.length?[{key:"fare",label:"Base fare",type:"number" as const},{key:"taxes",label:"Taxes",type:"number" as const},{key:"markup",label:"Markup",type:"number" as const},{key:"serviceFee",label:"Service fee",type:"number" as const},{key:"supplierCost",label:"Supplier cost",type:"number" as const}]:[])]}/>)}

            {perms.edit && !withdrawn && (
              <select
                value={b.status}
                aria-label="Booking status" disabled={busy}
                onChange={(e) => {
                  const next = e.target.value;
                  // Cancelling or voiding a booking that still holds customer money raises a refund,
                  // so it is a decision to confirm, not a dropdown tick.
                  if (WITHDRAWING.includes(next)) setCancelTo(next);
                  else if (hotel && next === "CONFIRMED") setShowHotelConfirmation(true);
                  else if (next === "TICKETED") setShowTickets(true);
                  else post("/api/bookings/status", { bookingId: b.id, status: next }, "Status updated");
                }}
                className="control h-9 text-xs"
              >
                {!statuses.includes(b.status) && <option value={b.status}>{enumLabel(b.status)}</option>}
                {statuses.filter(s => !((b.tickets.length || hotel&&b.status==="CONFIRMED") && ["ENQUIRY", "QUOTE_SENT", "PNR_CREATED", "ON_HOLD", "PAYMENT_AWAITED"].includes(s))).map((s) => <option key={s} value={s}>{enumLabel(s)}</option>)}
              </select>
            )}
          </div>
        </div>
      </section>

      <RecordSectionNav label="Booking sections" sections={[{id:"booking-travel",label:hotel?"Stay details":"Flight tickets"},...(perms.money?[{id:"booking-money",label:"Payments & refunds"},{id:"booking-pricing",label:"Price & charges"}]:[]),{id:"booking-facts",label:"Booking facts"},{id:"booking-travellers",label:hotel?"Guests":"Passengers"}]}/>
      <div className="record-next-step"><span>Next step</span><strong>{b.gdsSource==="TRIPJACK_API"?"Use Online bookings for supplier actions":withdrawn?"Review cancellation settlement and any outstanding refund":hotel&&b.status!=="CONFIRMED"?"Check the stay details before recording supplier confirmation":!hotel&&!b.tickets.length?"Record airline-issued tickets when available":"Review travel details and the current customer balance"}</strong></div>
      {b.gdsSource === "TRIPJACK_API" ? <div className="panel mb-4 p-4 text-sm text-slate-600">This booking is managed by the booking platform. <Link className="font-semibold text-teal-700 underline" href="/online-bookings">Open online bookings for live status, cancellation and refunds</Link>.</div> : <div className="mb-4 flex flex-wrap gap-2">
        {perms.record && outstanding > 0 && <Link className="btn-secondary" href={`/payments?action=record&customer=${b.customer.id}&booking=${b.id}`}>Record payment</Link>}
        {perms.invoice && !withdrawn && <Link className="btn-secondary" href={`/payments?action=invoice&customer=${b.customer.id}&booking=${b.id}`}>Create invoice</Link>}
        {perms.money && <Link className="btn-secondary" href={`/customers/${b.customer.id}?tab=payments`}>View receipts & invoices</Link>}
        {!hotel && perms.edit && !withdrawn && !["TICKETED", "REISSUED"].includes(b.status) && <button type="button" disabled={busy} className="btn-primary" onClick={() => setShowTickets(true)}>Record actual tickets</button>}
      </div>}

      {hotel && b.gdsSource!=="TRIPJACK_API" && <section className="panel mb-4 space-y-3 p-4"><h2 className="font-semibold">Hotel stay · manual agency record</h2><p className="text-sm text-slate-600">Record details already agreed with the hotel or supplier. This CRM does not reserve a room, issue a voucher or contact the supplier.</p>{perms.edit&&!withdrawn&&b.status!=="CONFIRMED"&&<button className="btn-primary" onClick={()=>setShowHotelConfirmation(true)}>Record supplier confirmation</button>}<Link className="btn-secondary" href={`/ticketing/${b.id}/stay`}>Open stay record</Link></section>}
      {/* Deadline banner */}
      {!hotel && b.ticketingDeadline && open && (
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
                  <button type="button" disabled={busy} onClick={() => post("/api/bookings/extend-deadline", { bookingId: b.id, hours: Number(extendHrs) }, "✓ Deadline extended")} className="font-semibold text-teal-700 hover:underline">Extend</button>
                </span>
              )}
              {perms.edit && <button type="button" disabled={busy} onClick={() => setShowTickets(true)} className="btn-secondary min-h-8 px-3 py-1.5 text-xs">Record actual tickets</button>}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {!hotel && perms.reissue && b.tickets.length > 0 && !["CANCELLED", "VOID", "REFUNDED"].includes(b.status) && (
            <button type="button" onClick={() => setShowReissue(true)} className="w-full rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-xs text-slate-500 hover:border-orange-300 hover:text-orange-700">
              + Request Reissue for a ticket on this booking
            </button>
          )}

          {hotel ? <section className="panel space-y-3 p-5"><h2 id="booking-travel" tabIndex={-1} className="font-semibold">Stay details</h2><KV k="Hotel" v={b.hotelName??"Not entered"}/><KV k="Check-in" v={dOnly(b.hotelCheckIn)}/><KV k="Check-out" v={dOnly(b.hotelCheckOut)}/><KV k="Supplier confirmation reference" v={b.pnr??"Not entered"}/><p className="text-sm text-slate-600">{b.gdsSource==="TRIPJACK_API"?"Stay details synced from the booking platform. Use Online bookings for supplier status and current documents.":b.status==="CONFIRMED"?"Supplier confirmation recorded by the agency. Verify changes directly with the supplier.":"Current record is not a confirmed hotel reservation. Review its status and supplier evidence."}</p></section> : <section className="panel p-5">
            <h2 id="booking-travel" tabIndex={-1} className="mb-4 text-micro font-semibold uppercase tracking-[.12em] text-slate-500">Tickets</h2>
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
                          {r.status === "REQUESTED" && <button type="button" disabled={busy} onClick={() => post("/api/reissues/status", { reissueId: r.id, status: "IN_PROGRESS" }, "✓ Reissue in progress")} className="btn-secondary min-h-7 px-2 py-0.5 text-small">Start</button>}
                          <button type="button" disabled={busy} onClick={() => post("/api/reissues/status", { reissueId: r.id, status: "DONE" }, "✓ Reissue completed")} className="btn-primary min-h-7 px-2 py-0.5 text-small">Complete</button>
                          <button type="button" disabled={busy} onClick={() => post("/api/reissues/status", { reissueId: r.id, status: "REJECTED" }, "Reissue rejected")} className="min-h-7 rounded-lg border border-rose-200 bg-rose-50 px-2 py-0.5 text-small text-rose-700">Reject</button>
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
          </section>}

          <section className="panel p-5">
            <h2 id="booking-money" tabIndex={-1} className="mb-4 text-micro font-semibold uppercase tracking-[.12em] text-slate-500">Payments{perms.money ? ` · ${money(netPaid)} net received against ${money(bookingCharge(b))}${refunded > 0 ? ` · ${money(refunded)} refunded` : ""}` : ""}</h2>
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
                {withdrawn ? "The original sale was withdrawn. Any recorded cancellation charges determine the remaining settlement." : "Refunds record money returned; they do not change the agreed sale. Use explicit cancellation terms to adjust the amount owed."}
              </p>
            </section>
          )}
        </div>

        <aside className="min-w-0 space-y-5">
          {WITHDRAWING.includes(b.status) && <section className="panel space-y-2.5 p-5">
            <h2 className="text-micro font-semibold uppercase tracking-[.12em] text-slate-500">Cancellation settlement</h2>
            {!perms.money ? <p className="text-xs text-slate-500">Settlement amounts are restricted for your role.</p> : b.cancellationSupplierCharge === null || b.cancellationAgencyFee === null ? <p className="text-xs leading-5 text-amber-800">Legacy cancellation: supplier charges and agency fees were not recorded. Do not infer a zero charge or profit from this record; ask accounts to reconcile the terms.</p> : <>
              <KV k="Supplier cancellation charge" v={money(b.cancellationSupplierCharge)} />
              <KV k="Agency cancellation fee" v={money(b.cancellationAgencyFee)} />
              <KV k="Agreed cancellation total" v={money(bookingCharge(b))} strong />
              <KV k="Net customer receipts" v={money(netPaid)} />
              <KV k="Refunds in progress" v={money(promisedTotal(b.refunds))} />
              <KV k="Still to collect" v={money(outstanding)} />
            </>}
            {b.cancellationReason && <p className="text-xs leading-5 text-slate-600">{b.cancellationReason}</p>}
            <p className="text-small text-slate-500">CRM records only. Supplier cancellation and money transfers must be completed in the appropriate external systems.</p>
          </section>}
          <section className="panel space-y-2.5 p-5">
            <h2 id="booking-pricing" tabIndex={-1} className="text-micro font-semibold uppercase tracking-[.12em] text-slate-500">{withdrawn ? "Original fare breakdown (historical)" : "Fare breakdown"}</h2>
            {perms.money ? <>
              <KV k={hotel?"Room charge":"Base fare"} v={money(b.fare)} />
              <KV k={b.reissueOf ? "Airline penalty" : "Taxes"} v={money(b.taxes)} />
              <KV k="Markup" v={money(b.markup)} />
              <KV k="Service fee" v={money(b.serviceFee)} />
              <KV k="Selling price" v={money(b.sellingPrice)} strong />
              <KV k="Supplier cost" v={costKnown ? money(b.supplierCost) : "Not entered"} />
              {!withdrawn && <KV k={costKnown ? "Known-cost booking margin" : "Recorded markup & service fee"} v={money(margin)} />}
              {!withdrawn && !costKnown && <p className="text-small leading-4 text-slate-500">Supplier cost is not recorded. Markup and service fees alone do not establish the booking margin or net profit.</p>}
            </> : <p className="text-xs text-slate-500">Fare and margin figures are restricted for your role.</p>}
            <KV k="Currency" v={b.currency} />
          </section>
          <section className="panel space-y-2.5 p-5">
            <h2 id="booking-facts" tabIndex={-1} className="text-micro font-semibold uppercase tracking-[.12em] text-slate-500">Booking facts</h2>
            <KV k="Booking source" v={bookingSourceLabel(b.gdsSource)} />
            <KV k="Supplier" v={b.supplier ?? "—"} />
            {!hotel&&<KV k="Flight" v={b.flightNo ?? "—"} />}
            <KV k={hotel?"Record created":"Booked"} v={dOnly(b.bookingDate)} />
            {!hotel&&<KV k="Ticketing deadline" v={dt(b.ticketingDeadline)} />}
            {!hotel&&<KV k="Travel date" v={dOnly(b.travelDate)} />}
            <KV k="Owner" v={b.owner} />
            <KV k="Branch" v={b.branch} />
          </section>
          <section className="panel p-5">
            <h2 id="booking-travellers" tabIndex={-1} className="mb-3 text-micro font-semibold uppercase tracking-[.12em] text-slate-500">{hotel?"Guests":"Passengers"}</h2>
            {perms.edit && !withdrawn && !b.tickets.length && <button type="button" className="btn-secondary mb-3" onClick={() => setShowPassengers(true)}>{hotel?"Edit guests":"Edit passengers"}</button>}
            {!b.travellers.length && <p className="mb-3 text-xs text-amber-800">{hotel?"Add guests to keep this stay record complete.":"Add passengers before recording flight tickets."}</p>}
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

      {hotel&&showHotelConfirmation&&<HotelConfirmationForm b={b} onClose={()=>setShowHotelConfirmation(false)}/>}
      {showPassengers && <PassengerForm b={b} options={passengerOptions} onClose={() => setShowPassengers(false)} />}
      {!hotel && showTickets && <TicketForm b={b} onClose={() => setShowTickets(false)} />}
      {cancelTo && (
        <CancelForm
          b={b}
          status={cancelTo}
          netPaid={netPaid}
          promised={promisedTotal(b.refunds)}
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

function HotelConfirmationForm({b,onClose}:{b:B;onClose:()=>void}){
 const router=useRouter();const [ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const problem=hotelStayProblem({...b,hotelCheckIn:b.hotelCheckIn?new Date(b.hotelCheckIn):null,hotelCheckOut:b.hotelCheckOut?new Date(b.hotelCheckOut):null},true);
 return <Modal label="Record hotel supplier confirmation" onClose={onClose} busy={busy} width="max-w-lg"><form className="space-y-4" onSubmit={async e=>{e.preventDefault();if(busy||problem||!ack)return;setBusy(true);setError("");try{const response=await fetch("/api/bookings/status",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({bookingId:b.id,status:"CONFIRMED",confirmationRecorded:true,confirmationSnapshot:{hotelName:b.hotelName,pnr:b.pnr,supplierId:b.supplierId,hotelCheckIn:b.hotelCheckIn,hotelCheckOut:b.hotelCheckOut}})});const data=await response.json();if(!response.ok)throw Error(data.error??"Confirmation was not recorded.");onClose();router.refresh();}catch(e){setError(e instanceof Error?e.message:"Response not received. Refresh to check the recorded stay before retrying.");}finally{setBusy(false);}}}><h2 className="text-xl font-semibold">Record hotel supplier confirmation</h2><p className="text-sm">This records confirmation already received from the hotel or supplier. It does not book a room, charge money, contact the supplier or issue a voucher.</p><div className="space-y-2 text-sm"><KV k="Hotel" v={b.hotelName??"Not entered"}/><KV k="Check-in" v={dOnly(b.hotelCheckIn)}/><KV k="Check-out" v={dOnly(b.hotelCheckOut)}/><KV k="Supplier confirmation reference" v={b.pnr??"Not entered"}/><KV k="Linked supplier" v={b.supplier??"No supplier linked"}/></div>{problem&&<p role="alert" className="form-error">{problem} Close this dialog and use Edit hotel stay.</p>}<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>I have verified the actual supplier confirmation for this stay.</label>{error&&<p role="alert" className="form-error">{error}</p>}<div className="flex flex-wrap justify-end gap-2"><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy||!!problem||!ack}>{busy?"Saving…":"Record confirmed stay"}</button></div></form></Modal>;
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
            setErr("Response not received. Check the reissue chain before retrying to avoid a duplicate request.");
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
  const [tickets, setTickets] = useState(b.travellers.filter(t => !b.tickets.some(x => x.status === "OK" && x.travellerId === t.id)).map(t => ({ travellerId: t.id, name: t.fullName, ticketNo: "", originalFare: "" })));
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { const r = await fetch("/api/bookings/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookingId: b.id, status: "TICKETED", tickets }) }); const d = await r.json().catch(() => ({})); if (!r.ok) { setError(d.error ?? "Could not record these tickets. Nothing was saved."); return; } onClose(); router.refresh(); }
    catch { setError("Response not received. Refresh and check the ticket records before retrying; your ticket numbers are still here."); } finally { setBusy(false); }
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
function CancelForm({ b, status, netPaid, promised, canRefund, onClose, onDone }: {
  b: B; status: string; netPaid: number; promised: number; canRefund: boolean;
  onClose: () => void; onDone: () => void;
}) {
  const [supplierCharge, setSupplierCharge] = useState("");
  const [agencyFee, setAgencyFee] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const charges = Math.round((Number(supplierCharge) + Number(agencyFee)) * 100) / 100;
  const refundDue = Math.max(0, Math.round((netPaid - charges - promised) * 100) / 100);
  const additionalOwed = Math.max(0, Math.round((charges - netPaid) * 100) / 100);
  const conflictsWithPromises = promised > Math.max(0, Math.round((netPaid - charges) * 100) / 100);
  const entered = supplierCharge !== "" && agencyFee !== "" && Number.isFinite(charges) && Number(supplierCharge) >= 0 && Number(agencyFee) >= 0;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const r = await fetch("/api/bookings/status", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: b.id, status, cancellationSupplierCharge: Number(supplierCharge), cancellationAgencyFee: Number(agencyFee), cancellationReason: reason, refundAmount: refundDue }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "Could not save cancellation terms. Nothing was changed."); return; }
      onDone();
    } catch { setError("Response not received. Refresh and check cancellation and refund status before retrying."); }
    finally { setBusy(false); }
  }
  return <Modal labelledBy="cancel-form-title" onClose={onClose} width="max-w-lg" busy={busy}>
    <form onSubmit={submit} className="space-y-5">
      <h2 id="cancel-form-title" className="text-xl font-semibold">{status === "VOID" ? "Void" : "Cancel"} {b.bookingNo}</h2>
      <p className="text-xs leading-6 text-slate-600">Enter the actual agreed supplier charge and agency fee, including zero where applicable. These replace the original sale amount for the cancellation settlement. No charges are assumed.</p>
      {!canRefund && <p role="alert" className="form-error">Cancellation allocates customer money and requires refund permission, even when no refund is due. Ask an authorized manager or accounts colleague.</p>}
      <div className="form-grid">
        <Field label="Supplier cancellation charge (INR) *"><input type="number" min="0" max="100000000" step="0.01" required value={supplierCharge} onChange={e => setSupplierCharge(e.target.value)} placeholder="Enter actual charge, or 0" /></Field>
        <Field label="Agency cancellation fee (INR) *"><input type="number" min="0" max="100000000" step="0.01" required value={agencyFee} onChange={e => setAgencyFee(e.target.value)} placeholder="Enter actual fee, or 0" /></Field>
      </div>
      <Field label="Cancellation reason / agreed terms *"><textarea required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} placeholder="Record the supplier terms and customer agreement." /></Field>
      {permsMoneySummary()}
      {entered && conflictsWithPromises && <p role="alert" className="form-error">Existing refunds promise more than these cancellation terms leave refundable. Ask accounts to reconcile or reject the earlier refund promises before saving new terms.</p>}
      <p className="text-xs leading-5 text-slate-500">Saving records the agreed cancellation in the CRM and raises any calculated refund in the approval pipeline. It does not cancel with the airline or transfer funds. Reconcile supplier payables and supplier refunds separately against the actual supplier statement.</p>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Back</button><button className="btn-primary" disabled={busy || !canRefund || !entered || conflictsWithPromises || !reason.trim()}>{busy ? "Saving…" : "Save cancellation terms"}</button></div>
    </form>
  </Modal>;
  function permsMoneySummary() {
    if (!canRefund) return null;
    return <div className="space-y-2 rounded-xl bg-slate-50 p-4">
      <KV k="Net customer money held" v={money(netPaid)} />
      <KV k="Refunds already in progress" v={money(promised)} />
      {entered ? <><KV k="Total cancellation charges" v={money(charges)} strong /><KV k="New refund to request" v={money(refundDue)} /><KV k="Additional amount to collect" v={money(additionalOwed)} /></> : <p className="text-xs text-slate-500">Enter both actual charge amounts to preview the settlement.</p>}
    </div>;
  }
}

function KV({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex min-w-0 justify-between gap-4 text-xs">
      <span className="text-slate-500">{k}</span>
      <span className={`min-w-0 [overflow-wrap:anywhere] ${strong ? "font-semibold text-slate-900" : "text-right text-slate-700"}`}>{v}</span>
    </div>
  );
}

function PassengerForm({ b, options, onClose }: { b: B; options: { id: string; fullName: string }[]; onClose: () => void }) {
  const router = useRouter();
  const [selected, setSelected] = useState(b.travellers.map(t => t.id));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <Modal labelledBy="booking-passengers-title" onClose={onClose} busy={busy} width="max-w-lg"><form className="space-y-4" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(`/api/bookings/${b.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ travellerIds: selected }) });
      const data = await response.json();
      if (!response.ok) { setError(data.error ?? "Could not save passengers."); return; }
      onClose(); router.refresh();
    } catch { setError("Response not received. Check the passenger list before retrying."); }
    finally { setBusy(false); }
  }}><h2 id="booking-passengers-title" className="text-lg font-semibold">{b.product==="HOTEL"?"Hotel guests":"Booking passengers"}</h2>
    <p className="text-xs text-slate-600">Select travellers from this customer&rsquo;s profile. Passenger changes do not change the agreed fare.</p>
    {options.map(t => <label key={t.id} className="flex items-center gap-2 rounded border p-3 text-sm"><input type="checkbox" checked={selected.includes(t.id)} onChange={e => setSelected(current => e.target.checked ? [...current, t.id] : current.filter(id => id !== t.id))} />{t.fullName}</label>)}
    <Link className="block text-sm text-teal-700 underline" href={`/customers/${b.customer.id}?tab=travellers`}>Add a missing traveller in the customer&rsquo;s workspace</Link>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !selected.length}>{busy ? "Saving…" : b.product==="HOTEL"?"Save guests":"Save passengers"}</button></div>
  </form></Modal>;
}
