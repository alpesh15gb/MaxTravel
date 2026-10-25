"use client";

import { enumLabel } from "@/lib/labels";
import { dateLabel, dateTimeLabel } from "@/lib/dates";
import { inrAmount } from "@/lib/money";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Customer360 as Data } from "@/lib/customer360";
import Icon from "@/components/Icon";
import { EmptyState, Status, avatarClass, initialsOf, type ToastTone } from "@/components/ui";
import Modal from "@/components/Modal";
import { useToast } from "@/lib/useToast";
import { openSignedFile } from "@/lib/openSignedFile";
import CustomerSalesHistory from "@/components/CustomerSalesHistory";
import RecordEditor from "@/components/RecordEditor";

const money = (n: number | null | undefined) => (n == null ? "—" : inrAmount(n));
const dt = (s: string | null | undefined) => (s ? dateTimeLabel(s) : "—");
const dOnly = (s: string | null | undefined) => (s ? dateLabel(s) : "—");

export type Perms = {
  sensitive: boolean; send: boolean; record: boolean; createVisa: boolean;
  createTicket: boolean; createTask: boolean; requestDocs: boolean;
  addTraveller?: boolean; editTraveller?: boolean; export?: boolean;
  invoice?: boolean; finance?: boolean; visibleTabs?: string[]; editCustomer?: boolean;
};

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const TABS = [
  ["overview", "Overview"], ["travellers", "Travellers"], ["visa", "Visa Cases"], ["tickets", "Tickets"],
  ["trips", "Trips"], ["documents", "Documents"], ["payments", "Payments"], ["refunds", "Refunds"],
  ["whatsapp", "WhatsApp"], ["tasks", "Tasks"], ["notes", "Notes"], ["activity", "Activity Timeline"],
] as const;

// One tone per meaning, shared with the rest of the app's status badges.
const toneOf = (s: string): Tone => {
  if (["ACTIVE", "PAID", "APPROVED", "TICKETED", "CONFIRMED", "ACCEPTED", "VERIFIED", "DONE"].includes(s)) return "success";
  if (["LEAD", "REQUESTED", "RECEIVED", "SUBMITTED", "OPEN", "IN_PROGRESS"].includes(s)) return "info";
  if (["PARTIAL", "UNDER_REVIEW", "PENDING", "HIGH"].includes(s)) return "warning";
  if (["UNPAID", "REJECTED", "REUPLOAD_REQUESTED", "URGENT", "CANCELLED"].includes(s)) return "danger";
  return "neutral";
};

export default function Customer360View({ data, perms, initialTab, permsExtra, owners, secondaryActions }: { secondaryActions?: ReactNode; data: Data; perms: Perms; initialTab?: string; permsExtra?: Partial<Perms>; owners: { id: string; name: string }[] }) {
  const p = { ...perms, ...(permsExtra ?? {}) };
  const [tab, setTab] = useState<string>(
    initialTab && TABS.some(([key]) => key === initialTab && (!p.visibleTabs || p.visibleTabs.includes(key)))
      ? initialTab
      : "overview"
  );
  const [modal, setModal] = useState<null | "payment" | "task" | "upload" | "wa" | "traveller" | { travellerEdit: Data["travellers"][number] }>(null);
  const { show, toast } = useToast();
  const c = data.customer;

  function wa() { location.assign(`/whatsapp?customer=${c.id}`); }

  return (
    <div className="workspace-page">
      <Link href="/customers" className="mb-3 inline-flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-teal-700"><Icon name="customers" size={15} />All customers</Link>

      {/* Client record header: identity on the left, actions on the right */}
      <section className="panel customer-record mb-3" aria-label="Customer record">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className={`avatar h-10 w-10 text-sm ${avatarClass(c.name)}`} aria-hidden="true">{initialsOf(c.name)}</span>
            <div className="min-w-0">
              
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
                <Status tone={toneOf(c.status)}>{c.status}</Status>
                <Status>{enumLabel(c.type)}</Status>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                <span className="font-mono text-xs text-slate-700">{c.code}</span>
                <span className="inline-flex items-center gap-1.5"><Icon name="phone" size={14} />{c.phone}</span>
                {c.email ? <span className="inline-flex items-center gap-1.5"><Icon name="mail" size={14} />{c.email}</span> : null}
                <span className="inline-flex items-center gap-1.5"><Icon name="pin" size={14} />{c.city}</span>
                <span>Branch {c.branch}</span>
                {c.manager ? <span>RM: <span className="font-medium text-slate-700">{c.manager.name}</span></span> : null}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 xl:justify-end">
            {p.editCustomer && <RecordEditor title="Edit customer" buttonLabel="Edit customer" endpoint={`/api/customers/${c.id}`} values={{name:c.name,phone:c.phone,email:c.email,city:c.city,address:c.address,companyName:c.companyName,type:c.type,status:c.status,assignedToId:c.manager?.id??"",handoverWork:false}} fields={[{key:"name",label:"Customer name",required:true},{key:"phone",label:"Phone",type:"tel",required:true},{key:"email",label:"Email",type:"email"},{key:"city",label:"City"},{key:"address",label:"Address",type:"textarea"},{key:"companyName",label:"Company"},{key:"type",label:"Customer type",type:"select",options:["INDIVIDUAL","CORPORATE","SUB_AGENT"].map(value=>({value,label:value.replaceAll("_"," ")}))},{key:"status",label:"Relationship status",type:"select",options:["ACTIVE","LEAD","INACTIVE"].map(value=>({value,label:value}))},...(owners.length?[{key:"assignedToId",label:"Relationship manager",type:"select" as const,options:owners.map(o=>({value:o.id,label:o.name}))},{key:"handoverWork",label:"Hand over open enquiries, existing bookings, visa cases and open tasks",type:"checkbox" as const}]:[])]}/>}
            {perms.record && <QuickBtn primary onClick={() => location.assign(`/payments?action=record&customer=${c.id}`)}>Record payment</QuickBtn>}
            {(perms.send || perms.createVisa || perms.createTicket || perms.createTask || perms.requestDocs || p.invoice) && <details className="customer-tools" onClick={e => { if ((e.target as HTMLElement).closest("button")) e.currentTarget.removeAttribute("open"); }} onKeyDown={e => { if (e.key === "Escape") { e.currentTarget.removeAttribute("open"); e.currentTarget.querySelector("summary")?.focus(); } }}>
              <summary className="btn-secondary">Customer actions<Icon name="chevronDown" size={14} /></summary>
              <div className="customer-tool-list">
                {perms.send && <QuickBtn onClick={wa}>Open WhatsApp desk</QuickBtn>}
                {perms.createVisa && <QuickBtn onClick={() => location.assign(`/visa/new?customer=${c.id}`)}>Create Visa Case</QuickBtn>}
                {perms.createTicket && <QuickBtn onClick={() => location.assign(`/ticketing/new?customer=${c.id}`)}>Create Ticket Booking</QuickBtn>}
                {perms.createTask && <QuickBtn onClick={() => setModal("task")}>Create Task</QuickBtn>}
                {perms.requestDocs && <QuickBtn onClick={requestDocs}>Request Documents</QuickBtn>}
                {perms.requestDocs && <QuickBtn onClick={() => setModal("upload")}>Share upload link</QuickBtn>}
                {p.invoice && <QuickBtn onClick={() => location.assign(`/payments?action=invoice&customer=${c.id}`)}>Create invoice</QuickBtn>}
              </div>
            </details>}
          </div>
        </div>
        {secondaryActions && <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-200 pt-3" aria-label="Customer record links">{secondaryActions}</div>}
      </section>

      {/* Summary tiles */}
      <div className="customer-summary" aria-label="Customer summary">
        {p.finance && <Card label="Outstanding" value={money(data.summary.outstanding)} tone={data.summary.outstanding > 0 ? "danger" : "ok"} />}
        <Card label="Active visa cases" value={String(data.summary.activeVisaCases)} />
        <Card label="Upcoming trips" value={String(data.summary.upcomingTrips)} />
        <Card label="Pending documents" value={String(data.summary.pendingDocs)} tone={data.summary.pendingDocs > 0 ? "warn" : "ok"} />
        <Card label="Open tasks" value={String(data.summary.openTasks)} tone={data.summary.openTasks > 0 ? "warn" : "ok"} />
        <Card label="Pending refunds" value={String(data.summary.pendingRefunds)} tone={data.summary.pendingRefunds > 0 ? "warn" : "ok"} />
      </div>

      {/* Underline tabs */}
      <label className="mb-4 block sm:hidden"><span className="field-label">Customer section</span><select aria-label="Customer section" className="control w-full" value={tab} onChange={event => setTab(event.target.value)}>{TABS.filter(([key]) => !p.visibleTabs || p.visibleTabs.includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <div aria-label="Customer sections" className="mb-4 hidden gap-0 overflow-x-auto border-b border-slate-200 tos-scroll sm:flex">
        {TABS.filter(([key]) => !p.visibleTabs || p.visibleTabs.includes(key)).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition ${
              tab === key ? "border-teal-600 font-semibold text-teal-700" : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && <Overview data={data} onSelect={setTab} />}
      {tab === "travellers" && (
        <Travellers data={data} perms={p} onAdd={() => setModal("traveller")} onEdit={(t) => setModal({ travellerEdit: t })} />
      )}
      {tab === "visa" && <VisaCases data={data} finance={!!p.finance} />}
      {tab === "tickets" && <Tickets data={data} />}
      {tab === "trips" && <Trips data={data} finance={!!p.finance} />}
      {tab === "documents" && <Documents data={data} perms={perms} onToast={show} />}
      {tab === "payments" && <Payments data={data} />}
      {tab === "refunds" && <Refunds data={data} />}
      {tab === "whatsapp" && <WhatsApp data={data} />}
      {tab === "tasks" && <Tasks data={data} />}
      {tab === "notes" && <Notes data={data} canEdit={!!p.editCustomer} />}
      {tab === "activity" && <Activity data={data} />}

      {toast}
      {modal === "traveller" && <TravellerForm customerId={c.id} traveller={null} sensitive={perms.sensitive} onClose={() => setModal(null)} />}
      {modal === "task" && <NewTask customerId={c.id} onClose={() => setModal(null)} />}
      {typeof modal === "object" && modal !== null && "travellerEdit" in modal && (
        <TravellerForm customerId={c.id} traveller={modal.travellerEdit} sensitive={perms.sensitive} onClose={() => setModal(null)} />
      )}
      {modal === "upload" && <UploadLink customerId={c.id} onClose={() => setModal(null)} />}
    </div>
  );

  function requestDocs() { setModal("upload"); }
}

function QuickBtn({ children, onClick, primary }: { children: React.ReactNode; onClick: () => void; primary?: boolean }) {
  return <button type="button" onClick={onClick} className={`${primary ? "btn-primary" : "btn-secondary"} min-h-9 px-3 py-2 text-xs`}>{children}</button>;
}

function Card({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={tone === "danger" ? "text-rose-700" : tone === "warn" ? "text-amber-800" : "text-slate-900"}>
      <div className="text-small font-medium text-slate-500">{label}</div>
      <div className="mt-0.5 truncate text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3 text-left text-micro font-semibold uppercase tracking-[.08em] text-slate-600 whitespace-nowrap ${className ?? ""}`}>{children}</th>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <EmptyState icon="compass" title={String(children)} description="Only real records appear here. Use the customer actions above to start the next step." />;
}

function KV({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4 text-xs">
      <span className="shrink-0 text-slate-500">{k}</span>
      <span className={strong ? "text-right font-semibold text-amber-700" : "text-right text-slate-900"}>{v}</span>
    </div>
  );
}

function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-[.12em] text-slate-500">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Overview({ data, onSelect }: { data: Data; onSelect: (tab: string) => void }) {
  const wa = data.whatsapp[0];
  const openTasks = data.tasks.filter(t => ["OPEN", "IN_PROGRESS"].includes(t.status)).slice(0, 5);
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-4">
      <CustomerSalesHistory history={data.salesHistory} />
      <Panel title="Current work">
        <div className="divide-y divide-slate-100">
          {data.visaCases.filter(v => !["CLOSED", "DELIVERED", "REJECTED"].includes(v.stageKey)).slice(0, 3).map(v => <Link key={v.id} href={`/visa/${v.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 hover:text-teal-700">
            <span className="min-w-0"><span className="block text-sm font-semibold">{v.caseNo} <span className="font-normal text-slate-500">· {v.destination}</span></span><span className="mt-0.5 block text-xs text-slate-500">{v.visaType} · {v.travellers}</span></span><Status tone="info">{v.stage}</Status>
          </Link>)}
          {data.bookings.filter(b => !["CANCELLED", "VOID", "REFUNDED"].includes(b.status)).slice(0, 3).map(b => <Link key={b.id} href={`/ticketing/${b.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 hover:text-teal-700">
            <span className="min-w-0 [overflow-wrap:anywhere]"><span className="block text-sm font-semibold">{b.bookingNo} <span className="font-normal text-slate-500">· {b.product==="HOTEL"?b.hotelName??"Hotel not entered":b.sector??"Route pending"}</span></span><span className="mt-0.5 block break-words text-xs text-slate-500">{b.product==="HOTEL"?`Supplier confirmation reference: ${b.pnr??"Not entered"} · Check-in ${b.hotelCheckIn?dOnly(b.hotelCheckIn):"not entered"} · Check-out ${b.hotelCheckOut?dOnly(b.hotelCheckOut):"not entered"}`:<>{b.pnr??"Enquiry"}{b.ticketingDeadline?` · Deadline ${dt(b.ticketingDeadline)}`:""}</>}</span></span><Status tone={toneOf(b.status)}>{enumLabel(b.status)}</Status>
          </Link>)}
          {!data.visaCases.some(v => !["CLOSED", "DELIVERED", "REJECTED"].includes(v.stageKey)) && !data.bookings.some(b => !["CANCELLED", "VOID", "REFUNDED"].includes(b.status)) && <p className="customer-overview-empty">No current bookings or visa cases.</p>}
        </div>
      </Panel>
      <Panel title="Open tasks" action={<button type="button" onClick={() => onSelect("tasks")} className="text-xs text-teal-700">View all</button>}>
        {openTasks.length ? (
          <ul className="divide-y divide-slate-100">
            {openTasks.map(t => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{t.title}</div>
                  <div className="text-xs text-slate-500">{t.owner} · due {dOnly(t.dueAt)}</div>
                </div>
                <Status tone={t.priority === "URGENT" ? "danger" : t.priority === "HIGH" ? "warning" : "neutral"}>{enumLabel(t.priority)}</Status>
              </li>
            ))}
          </ul>
        ) : <p className="customer-overview-empty">No open tasks. Create a follow-up from Customer actions.</p>}
      </Panel>
      <Panel title="Latest WhatsApp" action={<span className="text-small text-slate-500">{data.summary.lastWhatsApp ? dt(data.summary.lastWhatsApp) : "No messages yet"}</span>}>
        {wa ? (
          <div className="max-h-64 space-y-2 overflow-y-auto tos-scroll">
            {wa.messages.slice(-4).map((m) => (
              <div key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 text-xs ${m.direction === "IN" ? "bg-slate-100" : "ml-auto border border-teal-200 bg-teal-50"}`}>
                {m.body}
                <div className="mt-0.5 text-small text-slate-500">{dt(m.at)}</div>
              </div>
            ))}
          </div>
        ) : <p className="py-4 text-small text-slate-500">No conversation recorded for this customer.</p>}
      </Panel>
      </div>
      <Panel title="Customer details">
        <div className="space-y-3">
          <KV k="Customer since" v={dOnly(data.customer.createdAt)} />
          <KV k="Company" v={data.customer.companyName ?? "—"} />
          <KV k="Address" v={data.customer.address ?? "—"} />
          <KV k="Relationship manager" v={data.customer.manager?.name ?? "—"} />
        </div>
      </Panel>
    </div>
  );
}

function Travellers({ data, perms, onAdd, onEdit }: { data: Data; perms: Perms; onAdd: () => void; onEdit: (t: Data["travellers"][number]) => void }) {
  return (
    <div className="space-y-4">
      {perms.addTraveller && (
        <button type="button" onClick={onAdd} className="btn-secondary w-full border-dashed text-xs">+ Add Traveller</button>
      )}
      {data.travellers.map((t) => (
        <section key={t.id} className="panel p-5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="font-semibold">{t.fullName}</span>
            <Status>{t.relation}</Status>
            {t.primary && <Status tone="info">Primary</Status>}
            {perms.editTraveller && <button type="button" onClick={() => onEdit(t)} className="btn-secondary ml-auto min-h-8 px-3 py-1.5 text-xs">Edit</button>}
          </div>
          <div className="grid gap-x-8 gap-y-2 text-xs sm:grid-cols-3">
            <KV k="DOB" v={dOnly(t.dateOfBirth)} />
            <KV k="Gender" v={t.gender ?? "—"} />
            <KV k="Nationality" v={t.nationality} />
            <KV k="Passport" v={t.passportNumber ?? "—"} />
            <KV k="Passport expiry" v={dOnly(t.passportExpiry)} />
            <KV k="Place of issue" v={t.passportPlace ?? "—"} />
            <KV k="Known traveller no." v={t.knownTravellerNumber ?? "—"} />
            <KV k="Frequent flyer" v={t.frequentFlyer ?? "—"} />
          </div>
        </section>
      ))}
      {data.travellers.length === 0 && <Empty>No travellers recorded.</Empty>}
    </div>
  );
}

function VisaCases({ data, finance }: { data: Data; finance: boolean }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="min-w-[720px] text-sm">
        <thead><tr><Th>Case</Th><Th>Destination / Type</Th><Th>Stage</Th><Th>Travellers</Th><Th>Travel date</Th><Th className="text-right">Outstanding</Th></tr></thead>
        <tbody>
          {data.visaCases.map((v) => (
            <tr key={v.id} className="border-t border-slate-100">
              <td className="px-4 py-3"><Link href={`/visa/${v.id}`} className="font-medium text-teal-700 hover:underline">{v.caseNo}</Link></td>
              <td className="px-4 py-3">{v.destination}<div className="text-xs text-slate-500">{v.visaType}{v.visaCategory ? ` · ${v.visaCategory}` : ""}</div></td>
              <td className="px-4 py-3"><Status>{v.stage}</Status></td>
              <td className="px-4 py-3 text-xs text-slate-500">{v.travellers || "—"}</td>
              <td className="px-4 py-3 text-xs text-slate-500">{dOnly(v.travelDate)}</td>
              <td className="px-4 py-3 text-right font-medium tabular-nums">{finance ? money(v.sellingPrice - v.amountReceived) : "Restricted"}</td>
            </tr>
          ))}
          {data.visaCases.length === 0 && <tr><td colSpan={6}><Empty>No visa cases.</Empty></td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Tickets({ data }: { data: Data }) {
  const all = data.bookings.flatMap((b) => b.tickets.map((t) => ({ ...t, booking: b })));
  return (
    <div className="panel overflow-x-auto">
      <table className="min-w-[680px] text-sm">
        <thead><tr><Th>Ticket no.</Th><Th>Passenger</Th><Th>Booking</Th><Th>PNR</Th><Th>Sector</Th><Th>Status</Th></tr></thead>
        <tbody>
          {all.map((t, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="px-4 py-3 font-mono text-xs">{t.ticketNo}</td>
              <td className="px-4 py-3">{t.passenger}</td>
              <td className="px-4 py-3"><Link href={`/ticketing/${t.booking.id}`} className="text-teal-700 hover:underline">{t.booking.bookingNo}</Link></td>
              <td className="px-4 py-3 font-mono text-xs">{t.booking.pnr ?? "—"}</td>
              <td className="px-4 py-3 text-xs">{t.booking.sector ?? "—"}</td>
              <td className="px-4 py-3"><Status tone={toneOf(t.status)}>{t.status}</Status></td>
            </tr>
          ))}
          {all.length === 0 && <tr><td colSpan={6}><Empty>No tickets issued.</Empty></td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Trips({ data, finance }: { data: Data; finance: boolean }) {
  return (
    <div className="space-y-3">
      {data.bookings.map((b) => (
        <Link key={b.id} href={`/ticketing/${b.id}`} className="panel flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:border-teal-300">
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{b.bookingNo}{b.product==="HOTEL"?" · Hotel stay":""}</span>
              {b.product==="HOTEL"?<span className="min-w-0 break-all font-mono text-xs text-slate-500">Supplier confirmation reference: {b.pnr??"Not entered"}</span>:b.pnr&&<span className="font-mono text-xs text-slate-500">PNR {b.pnr}</span>}
            </div>
            <div className="mt-1 break-words text-xs text-slate-500">{b.product==="HOTEL"?<>{b.hotelName??"Hotel not entered"} · {b.sector??"Destination not entered"} · {b.travellers||"Guest details not entered"}{b.externallyManaged?" · Platform-synced stay":" · Manual agency record"}</>:<>{b.airline??"—"} · {b.sector??"—"} · {b.travellers||"—"}</>}</div>
          </div>
          <div className="text-right">
            <Status tone={toneOf(b.status)}>{enumLabel(b.status)}</Status>
            <div className="mt-1.5 text-xs text-slate-500">{b.product==="HOTEL"?<>Check-in {b.hotelCheckIn?dOnly(b.hotelCheckIn):"not entered"} · Check-out {b.hotelCheckOut?dOnly(b.hotelCheckOut):"not entered"}</>:<>Travel {dOnly(b.travelDate)}</>}</div>{finance&&["CANCELLED","VOID","REFUNDED"].includes(b.status)&&<p className="mt-2 text-xs text-amber-800">{b.cancellationCharge===null?"Cancellation charges not recorded":`Cancellation charges ${money(b.cancellationCharge)} · balance ${money(b.cancellationBalance)}`} · Trip closed</p>}
          </div>
        </Link>
      ))}
      {data.bookings.length === 0 && <Empty>No trips booked.</Empty>}
    </div>
  );
}

function Documents({ data, perms, onToast }: { data: Data; perms: Perms; onToast: (m: string, tone?: ToastTone) => void }) {
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [links, setLinks] = useState(data.uploadLinks);
  const [revoking, setRevoking] = useState<string | null>(null);
  async function revokeLink(id: string) {
    setRevoking(id);
    try {
      const r = await fetch("/api/upload-links/revoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ linkId: id }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) setLinks(links.map((l) => (l.id === id ? { ...l, revoked: true } : l)));
      else onToast(d.error ?? "Could not revoke this link. It is still active.", "error");
    } catch { onToast("Connection failed. Please try again.", "error"); }
    finally { setRevoking(null); }
  }
  return (
    <div className="space-y-3">
      {links.length > 0 && (
        <section className="panel p-5">
          <div className="text-sm font-semibold">Customer upload links</div>
          <p className="mt-1 text-xs text-slate-500">Anyone with the link can upload without signing in. Revoke a link the moment it leaks or is no longer needed.</p>
          <div className="mt-3 divide-y divide-slate-100">
            {links.map((l) => {
              const expired = new Date(l.expiresAt).getTime() < Date.now();
              const dead = l.revoked || expired;
              return (
                <div key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-xs">
                  <span className="font-medium">{l.note ?? "Customer upload"}</span>
                  <span className="text-slate-500">expires {dOnly(l.expiresAt)}{l.usedAt ? ` · used ${dOnly(l.usedAt)}` : " · unused"}</span>
                  <Status tone={dead ? "neutral" : "success"}>{l.revoked ? "revoked" : expired ? "expired" : "active"}</Status>
                  <span className="ml-auto flex gap-3">
                    {!dead && <button type="button" onClick={() => { navigator.clipboard.writeText(location.origin + l.url).then(() => onToast("Link copied"), () => onToast("Could not copy automatically — open the link and copy it from the address bar.", "error")); }} className="font-medium text-teal-700 hover:underline">Copy link</button>}
                    {!dead && !!perms.requestDocs && <button type="button" disabled={revoking === l.id} onClick={() => revokeLink(l.id)} className="font-medium text-rose-700 hover:underline disabled:opacity-50">{revoking === l.id ? "Revoking…" : "Revoke"}</button>}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {data.documents.map((d) => (
        <section key={d.id} className="panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{d.docType}</span>
                <span className="text-xs text-slate-500">{d.docNo} · v{d.version}{d.traveller ? ` · ${d.traveller}` : ""}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {d.uploadedAt ? `Uploaded ${dt(d.uploadedAt)} (${d.uploadSource ?? "staff"})` : "Not yet uploaded"}
                {d.verifiedBy ? ` · verified by ${d.verifiedBy}` : ""}
                {d.expiryDate ? ` · expires ${dOnly(d.expiryDate)}` : ""}
              </div>
              {(d.warnings as { type: string; message: string }[] | [])?.map((w, i) => (
                <div key={i} className="mt-1 text-xs text-amber-700">⚠ {w.message}</div>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Status tone={toneOf(d.status)}>{enumLabel(d.status)}</Status>
              {d.hasFile && (
                <button
                  type="button"
                  onClick={async () => {
                    const problem = await openSignedFile(
                      () => fetch(`/api/documents/${d.id}/file`, { method: "POST" }),
                      "Could not open this file. Ask an administrator to check document storage.",
                    );
                    if (problem) onToast(problem, "error");
                  }}
                  className="btn-secondary min-h-8 px-3 py-1.5 text-xs"
                >
                  View (signed)
                </button>
              )}
              <Link href={`/documents?focus=${d.id}`} className="btn-secondary min-h-8 px-3 py-1.5 text-xs">Open document desk</Link>
              {openDoc === d.id && <span className="text-xs text-slate-500">panel below</span>}
            </div>
          </div>
          {d.rejectionReason && <div className="mt-2 text-xs text-rose-700">Rejection reason: {d.rejectionReason}</div>}
          {d.extracted && (
            <ExtractionReview doc={d} onDone={(msg) => { onToast(msg); setOpenDoc(null); }} onToast={onToast} />
          )}
        </section>
      ))}
      {data.documents.length === 0 && <Empty>No documents.</Empty>}
    </div>
  );
}

function ExtractionReview({ doc, onDone, onToast }: { doc: Data["documents"][number]; onDone: (msg: string) => void; onToast: (msg: string, tone?: ToastTone) => void }) {
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const e = doc.extracted as Record<string, string> | null;
    return e ? Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v ?? ""])) : {};
  });
  if (!doc.extracted || doc.extractionConfirmed) {
    return doc.extractionConfirmed ? (
      <div className="mt-3 text-xs text-teal-700">✓ Extracted values confirmed by an employee</div>
    ) : null;
  }
  const FIELDS = ["fullName", "passportNumber", "dateOfBirth", "nationality", "gender", "issueDate", "expiryDate", "placeOfIssue"];
  const LABELS: Record<string, string> = {
    fullName: "Full name", passportNumber: "Passport no.", dateOfBirth: "DOB", nationality: "Nationality",
    gender: "Gender", issueDate: "Issue date", expiryDate: "Expiry", placeOfIssue: "Place of issue",
  };
  return (
    <div className="mt-4 rounded-xl border border-dashed border-sky-200 bg-sky-50/60 p-4">
      <div className="mb-3 text-xs font-semibold text-sky-800">AI-suggested values — employee must verify before saving</div>
      <div className="grid gap-3 sm:grid-cols-4">
        {FIELDS.map((f) => (
          <label key={f} className="flex flex-col gap-1 text-small text-slate-500">
            {LABELS[f]}
            <input
              value={(vals[f] as string) ?? ""}
              onChange={(e) => setVals({ ...vals, [f]: e.target.value })}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900"
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={async () => {
          try {
            const r = await fetch("/api/documents/confirm-extraction", {
              method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: doc.id, confirmed: vals }),
            });
            const j = await r.json().catch(() => ({}));
            if (r.ok) onDone("✓ Values confirmed and saved to traveller");
            else onToast(j.error ?? "Could not confirm these values. Nothing was saved to the traveller.", "error");
          } catch { onToast("Connection failed. Nothing was saved — please retry.", "error"); }
        }}
        className="btn-primary mt-3 min-h-8 px-3 py-1.5 text-xs"
      >
        Confirm & save to traveller
      </button>
    </div>
  );
}

function Payments({ data }: { data: Data }) {
  return (
    <div className="panel overflow-x-auto">
      <table aria-label="Customer receipts" className="min-w-[640px] text-sm">
        <caption className="p-4 text-left font-semibold">Receipts · money received</caption>
        <thead><tr><Th>Receipt</Th><Th>Amount</Th><Th>Mode</Th><Th>Against</Th><Th>Received</Th></tr></thead>
        <tbody>
          {data.payments.map((p) => (
            <tr key={p.id} className="border-t border-slate-100">
              <td className="px-4 py-3 font-mono text-xs"><a href={`/payments/print?receipt=${p.id}`} target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline">{p.receiptNo} · Print</a></td>
              <td className="px-4 py-3 font-medium tabular-nums">{money(p.amount)}</td>
              <td className="px-4 py-3 text-xs text-slate-500">{p.mode}</td>
              <td className="px-4 py-3 text-xs text-slate-500">{p.ref ?? "—"}</td>
              <td className="px-4 py-3 text-xs text-slate-500">{dt(p.receivedOn)}</td>
            </tr>
          ))}
          {data.payments.length === 0 && <tr><td colSpan={5}><Empty>No receipts recorded.</Empty></td></tr>}
        </tbody>
      </table>
      <table aria-label="Customer invoices" className="mt-5 min-w-[640px] text-sm">
        <caption className="p-4 text-left font-semibold">Invoices · amounts billed</caption>
        <thead><tr><Th>Invoice</Th><Th>Amount / paid</Th><Th>Status</Th><Th>Description</Th><Th>Due date</Th></tr></thead>
        <tbody>
          {data.invoices.map((i) => (
            <tr key={i.id} className="border-t border-slate-100 bg-slate-50/60">
              <td className="px-4 py-3 font-mono text-xs"><Link href={`/payments?focus=${i.id}`} className="text-teal-700 hover:underline">{i.invoiceNo} · Open invoice</Link></td>
              <td className="px-4 py-3 tabular-nums">{money(i.amount)} <span className="text-xs text-slate-500">/ paid {money(i.amountPaid)}</span></td>
              <td className="px-4 py-3"><Status tone={toneOf(i.status)}>{i.status}</Status></td>
              <td className="max-w-52 truncate px-4 py-3 text-xs text-slate-500">{i.description ?? "—"}</td>
              <td className="px-4 py-3 text-xs text-slate-500">due {dOnly(i.dueDate)}</td>
            </tr>
          ))}
          {data.invoices.length === 0 && <tr><td colSpan={5}><Empty>No invoices issued.</Empty></td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Refunds({ data }: { data: Data }) {
  return (
    <div className="space-y-3">
      {data.refunds.map((r) => (
        <div key={r.id} className="panel flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <Link href={`/refunds?focus=${r.id}#${r.id}`} className="font-mono text-xs text-teal-700 hover:underline">{r.refundNo} · Open refund</Link>
              <span className="font-semibold tabular-nums">{money(r.amount)}</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">{r.reason}{r.booking ? ` · ${r.booking}` : ""} · requested {dOnly(r.requestedOn)}</div>
          </div>
          <Status tone={toneOf(r.status)}>{enumLabel(r.status)}</Status>
        </div>
      ))}
      {data.refunds.length === 0 && <Empty>No refunds.</Empty>}
    </div>
  );
}

function WhatsApp({ data }: { data: Data }) {
  return (
    <div className="space-y-4">
      {data.whatsapp.map((t) => (
        <section key={t.id} className="panel p-5">
          <div className="mb-4 text-xs text-slate-500">{t.phone} · {t.messages.length} messages</div>
          <div className="space-y-2.5">
            {t.messages.map((m) => (
              <div key={m.id} className={`max-w-[80%] rounded-xl px-3.5 py-2.5 text-sm ${m.direction === "IN" ? "bg-slate-100" : "ml-auto border border-teal-200 bg-teal-50"}`}>
                {m.body}
                <div className="mt-1 text-right text-small text-slate-500">{dt(m.at)} {m.direction === "OUT" ? `· ${m.status}` : ""}</div>
                {m.template && <div className="mt-0.5 text-small text-sky-700">template: {m.template}</div>}
              </div>
            ))}
          </div>
        </section>
      ))}
      {data.whatsapp.length === 0 && <Empty>No WhatsApp history.</Empty>}
    </div>
  );
}

function Tasks({ data }: { data: Data }) {
  return (
    <div className="panel divide-y divide-slate-100 overflow-hidden">
      {data.tasks.map((t) => (
        <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <Link href={`/tasks?focus=${t.id}`} className="text-sm font-medium text-teal-700 hover:underline">{t.title}</Link>
            <div className="mt-0.5 text-xs text-slate-500">{t.owner} · due {dOnly(t.dueAt)}</div>
          </div>
          <div className="flex gap-2">
            <Status tone={toneOf(t.priority)}>{t.priority}</Status>
            <Status tone={toneOf(t.status)}>{enumLabel(t.status)}</Status>
          </div>
        </div>
      ))}
      {data.tasks.length === 0 && <div className="p-5"><Empty>No tasks.</Empty></div>}
    </div>
  );
}

function Notes({ data, canEdit }: { data: Data; canEdit: boolean }) {
  const [body, setBody] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const router = useRouter();
  async function save(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(""); try { const r = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId: data.customer.id, body }) }); const d = await r.json().catch(() => ({})); if (!r.ok) { setError(d.error ?? "Could not save note."); return; } setBody(""); router.refresh(); } catch { setError("The note was not saved. Your text is still here — please try again."); } finally { setBusy(false); } }
  return (
    <div className="space-y-4">
      {canEdit && <form className="panel space-y-3 p-5" onSubmit={save}><label className="field"><span className="field-label">Customer note</span><textarea required rows={3} maxLength={5000} value={body} onChange={e => setBody(e.target.value)} placeholder="Preferences, context or a useful handoff…" /></label>{error && <div role="alert" className="form-error">{error}</div>}<div><button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save note"}</button></div></form>}
      {data.notes.map((n) => (
        <div key={n.id} className={`panel px-5 py-4 ${n.pinned ? "border-amber-200 bg-amber-50/60" : ""}`}>
          <div className="text-sm">{n.body}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">— {n.author}, {dt(n.createdAt)} {n.pinned ? <span className="inline-flex items-center gap-1 font-medium text-amber-700"><Icon name="pin" size={12} />Pinned</span> : null}</div>
        </div>
      ))}
      {data.notes.length === 0 && <Empty>No notes.</Empty>}
    </div>
  );
}

function Activity({ data }: { data: Data }) {
  return (
    <section className="panel p-5">
      {data.activities.map((a, i) => (
        <div key={a.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="mt-1.5 h-2 w-2 rounded-full bg-teal-600" />
            {i < data.activities.length - 1 && <div className="w-px flex-1 bg-slate-200" />}
          </div>
          <div className="pb-5">
            <div className="text-sm">{a.summary}</div>
            <div className="mt-0.5 text-small text-slate-500">{a.actor} · {dt(a.createdAt)} · {a.type}</div>
          </div>
        </div>
      ))}
      {data.activities.length === 0 && <Empty>No activity yet.</Empty>}
    </section>
  );
}

function NewTask({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const [form, setForm] = useState({ title: "", priority: "MEDIUM", dueAt: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  return (
    <Modal label="Create task" onClose={onClose} width="max-w-sm" busy={busy}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try { const r = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, customerId, dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null }) }); const d = await r.json().catch(() => ({})); if (!r.ok) { setError(d.error ?? "Could not create task."); return; } onClose(); router.refresh(); }
          catch { setError("Connection failed. The task was not created — your details are still here."); }
          finally { setBusy(false); }
        }}
        className="space-y-4"
      >
        <h3 className="text-lg font-semibold">Create Task</h3>
        {error && <div role="alert" className="form-error">{error}</div>}
        <Field2 label="Task title *"><input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field2>
        <Field2 label="Priority"><select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>URGENT</option></select></Field2>
        <Field2 label="Due date & time"><input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></Field2>
        <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={onClose} className="btn-secondary">Cancel</button><button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Create"}</button></div>
      </form>
    </Modal>
  );
}

function Field2({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}</label>;
}

function TravellerForm({ customerId, traveller, sensitive, onClose }: { customerId: string; traveller: Data["travellers"][number] | null; sensitive: boolean; onClose: () => void }) {
  const dIn = (s: string | null) => (s ? new Date(s).toISOString().slice(0, 10) : "");
  const [form, setForm] = useState({
    fullName: traveller?.fullName ?? "", relation: traveller?.relation ?? "SPOUSE",
    dateOfBirth: dIn(traveller?.dateOfBirth ?? null), gender: traveller?.gender ?? "",
    nationality: traveller?.nationality ?? "India",
    passportNumber: traveller?.passportNumber ?? "", passportIssueDate: dIn(traveller?.passportIssueDate ?? null),
    passportExpiry: dIn(traveller?.passportExpiry ?? null), passportPlace: traveller?.passportPlace ?? "",
    knownTravellerNumber: traveller?.knownTravellerNumber ?? "", frequentFlyer: traveller?.frequentFlyer ?? "",
    primary: traveller?.primary ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    // Without sensitive:view the server refuses passport edits outright. Sending the fields anyway
    // would either be rejected or, worse, post back the masked number the list screen shows.
    const body: Record<string, unknown> = { ...form };
    if (!sensitive) { delete body.passportNumber; delete body.passportPlace; }
    try {
      const r = traveller
        ? await fetch(`/api/travellers/${traveller.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        : await fetch("/api/travellers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, customerId }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { onClose(); router.refresh(); return; }
      setErr(d.error ?? `Could not ${traveller ? "save" : "add"} this traveller. Check the details and try again.`);
    } catch {
      setErr("Connection failed. This traveller was not saved — your entries are still here.");
    } finally { setBusy(false); }
  }

  return (
    <Modal label={traveller ? `Edit ${traveller.fullName}` : "Add traveller"} onClose={onClose} width="max-w-lg" busy={busy}>
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-lg font-semibold">{traveller ? `Edit ${traveller.fullName}` : "Add Traveller"}</h2>
        <div className="form-grid">
          <div className="sm:col-span-2"><Field2 label="Full name *"><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required /></Field2></div>
          <Field2 label="Relationship to customer"><select value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })}>{["SELF", "SPOUSE", "SON", "DAUGHTER", "FATHER", "MOTHER", "EMPLOYEE", "GROUP"].map((r) => <option key={r} value={r}>{r}</option>)}</select></Field2>
          <Field2 label="Date of birth"><input type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} /></Field2>
          <Field2 label="Gender"><select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option value="">—</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option></select></Field2>
          <Field2 label="Nationality"><input value={form.nationality} onChange={(e) => setForm({ ...form, nationality: e.target.value })} /></Field2>
          {sensitive ? (
            <>
              <Field2 label="Passport number"><input value={form.passportNumber} onChange={(e) => setForm({ ...form, passportNumber: e.target.value })} /></Field2>
              <Field2 label="Place of issue"><input value={form.passportPlace} onChange={(e) => setForm({ ...form, passportPlace: e.target.value })} /></Field2>
            </>
          ) : (
            <div className="sm:col-span-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              Passport number and place of issue need the sensitive-data permission. Dates below can still be recorded.
            </div>
          )}
          <Field2 label="Passport issue date"><input type="date" value={form.passportIssueDate} onChange={(e) => setForm({ ...form, passportIssueDate: e.target.value })} /></Field2>
          <Field2 label="Passport expiry"><input type="date" value={form.passportExpiry} onChange={(e) => setForm({ ...form, passportExpiry: e.target.value })} /></Field2>
          <Field2 label="Known traveller number"><input value={form.knownTravellerNumber} onChange={(e) => setForm({ ...form, knownTravellerNumber: e.target.value })} /></Field2>
          <Field2 label="Frequent flyer"><input value={form.frequentFlyer} onChange={(e) => setForm({ ...form, frequentFlyer: e.target.value })} /></Field2>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={form.primary} onChange={(e) => setForm({ ...form, primary: e.target.checked })} />
          Primary traveller
        </label>
        {err && <div role="alert" className="form-error">{err}</div>}
        <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={onClose} className="btn-secondary">Cancel</button><button className="btn-primary" disabled={busy}>{busy ? "Saving…" : traveller ? "Save" : "Add"}</button></div>
      </form>
    </Modal>
  );
}

function UploadLink({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal label="Secure customer upload link" onClose={onClose} width="max-w-md" busy={busy}>
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Secure customer upload link</h3>
        <p className="text-xs leading-5 text-slate-500">Share this private link manually. It does not send a message automatically.</p>
        {error && <div role="alert" className="form-error">{error}</div>}
        {!link ? (
          <button
            type="button"
            onClick={async () => {
              setBusy(true);
              setError("");
              try { const r = await fetch("/api/upload-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId, expiresInDays: 7 }) }); const d = await r.json().catch(() => ({})); if (r.ok && d.url) setLink(d.url); else setError(d.error ?? "Could not create a link. No link was created."); }
              catch { setError("Connection failed. Please try again."); } finally { setBusy(false); }
            }}
            disabled={busy}
            className="btn-primary w-full"
          >
            {busy ? "Creating…" : "Generate 7-day link"}
          </button>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-slate-500">Share with the customer — no login needed, expires in 7 days:</div>
            <code className="block break-all rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-teal-700">{location.origin}{link}</code>
            <button type="button" onClick={() => { void navigator.clipboard.writeText(location.origin + link).catch(() => setError("Could not copy automatically — select the link above and copy it manually.")); }} className="text-xs font-medium text-teal-700 hover:underline">Copy link</button>
          </div>
        )}
        <button type="button" onClick={onClose} className="btn-secondary w-full">Close</button>
      </div>
    </Modal>
  );
}
