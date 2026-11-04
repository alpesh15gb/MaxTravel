import Link from "next/link";
import { Suspense } from "react";
import CaseProfit from "@/components/CaseProfit";
import ProfitBanner from "@/components/ProfitBanner";
import WorkDesk from "@/components/WorkDesk";
import TripStageBar from "@/components/TripStageBar";
import Icon, { type IconName } from "@/components/Icon";
import { Status } from "@/components/ui";
import CaseEditor from "@/app/(app)/cases/[id]/CaseEditor";
import { SERVICE_ICON, SERVICE_LABEL } from "../TripsList";
import AddServiceButton from "./AddServiceButton";
import { isClosedCase } from "@/lib/case-constants";
import { canEditCase, canAssignCase } from "@/lib/service-cases";
import { dateLabel, dateTimeLabel } from "@/lib/dates";
import { inrAmount } from "@/lib/money";
import { enumLabel } from "@/lib/labels";
import type { TripDetail } from "@/lib/trips-read";
import type { SessionUser } from "@/lib/session";
import type { readWork } from "@/lib/work-read";

type HistoryRow = { id: string; at: string; who: string; what: string; href?: string };
type Props = {
  user: SessionUser; trip: TripDetail; work: Awaited<ReturnType<typeof readWork>> | null;
  record: { id: string; version: string; status: string; ownerId: string; followUp: string | null };
  imported: { at: string; reference: string | null; source: string | null; stage: string | null } | null;
  owners: { id: string; name: string }[];
  history: { open: boolean; page: number; more: boolean; rows: HistoryRow[] };
};

export default function TripView({ user, trip, work, record, imported, owners, history }: Props) {
  const can = (p: string) => user.permissions.includes(p as SessionUser["permissions"][number]);
  const closed = isClosedCase({ status: trip.caseStatus });
  const id = trip.id, phone = trip.customer.phone.replace(/[^+0-9]/g, "");
  const liveBookings = trip.services.filter(s => !s.dead && s.kind !== "VISA" && s.kind !== "ENQUIRY");
  const liveVisas = trip.services.filter(s => !s.dead && s.kind === "VISA");
  const paymentHref = `/payments?action=record&customer=${trip.customer.id}` + (liveBookings.length === 1 && !liveVisas.length ? `&booking=${liveBookings[0].href.split("/").pop()}` : liveVisas.length === 1 && !liveBookings.length ? `&visaCase=${liveVisas[0].href.split("/").pop()}` : "");
  type AddItem = { href: string; label: string; icon: IconName; service?: "VISA" | "QUOTE" };
  const add: AddItem[] = closed ? [] : ([
    can("customer:create") && can("customer:edit") && can("ticketing:create") && { service: "QUOTE" as const, href: "", label: "Quote", icon: "compass" as const },
    can("ticketing:create") && { href: `/ticketing/new?case=${id}&product=FLIGHT`, label: "Flight", icon: "plane" as const },
    can("ticketing:create") && { href: `/ticketing/new?case=${id}&product=HOTEL`, label: "Hotel", icon: "board" as const },
    can("visa:create") && canEditCase(user) && { service: "VISA" as const, href: "", label: "Visa", icon: "visa" as const },
    can("ticketing:create") && { href: `/ticketing/new?case=${id}&product=BUS`, label: "Other", icon: "list" as const },
    can("payment:record") && { href: paymentHref, label: "Payment", icon: "wallet" as const },
    can("task:create") && { href: "#todos", label: "To-do", icon: "tasks" as const },
  ] as (AddItem | false)[]).filter((x): x is AddItem => Boolean(x));
  const empty = trip.services.length === 0;
  const historyHref = (n: number) => `/trips/${id}?history=${n}#history`;

  return <div className="workspace-page work-desk space-y-5">
    <header className="panel space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Max ID {trip.caseNo}{trip.online && <span className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 normal-case text-indigo-800">Online</span>}</p>
          <h1 className="mt-1 break-words text-2xl font-semibold text-slate-900">{trip.title}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {can("customer:view") ? <Link className="font-medium text-blue-700 underline" href={`/masters/${trip.customer.id}`}>{trip.customer.name}</Link> : trip.customer.name}
            {" "}· {trip.customer.code} · Handled by {trip.owner}
            {trip.start && <> · {dateLabel(trip.start)}{trip.end && trip.end !== trip.start ? ` – ${dateLabel(trip.end)}` : ""}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {phone && <a className="btn-secondary" href={`tel:${phone}`}><Icon name="phone" size={16} />Call</a>}
          {trip.customer.email && <a className="btn-secondary" href={`mailto:${encodeURIComponent(trip.customer.email)}`}><Icon name="mail" size={16} />Email</a>}
          {can("chat:use") && <Link className="btn-secondary" href={`/team-chat?case=${id}`}>Discuss</Link>}
        </div>
      </div>
      <TripStageBar stage={trip.stage} />
      {trip.money && <ProfitBanner user={user} id={id} />}
      {record.followUp && <p className="text-sm text-slate-700"><Icon name="calendar" size={14} className="mr-1 inline" />Follow up: {dateTimeLabel(record.followUp)}</p>}
    </header>

    {imported && <section className="panel space-y-1 p-5 text-sm" aria-label="Imported trip"><h2 className="font-semibold">Imported from earlier records</h2><p className="break-words">Original reference: <strong>{imported.reference}</strong> · Source: {imported.source}{imported.stage ? ` · Original stage: ${imported.stage}` : ""}</p><p className="text-slate-600">Imported {dateTimeLabel(imported.at)}.</p></section>}

    {add.length > 0 && <section className={`panel p-5 ${empty ? "border-2 border-teal-600" : ""}`} aria-labelledby="add-title">
      <h2 id="add-title" className="text-lg font-semibold">{empty ? `What does ${trip.customer.name} need?` : "Add to this trip"}</h2>
      {empty && <p className="mt-1 text-sm text-slate-600">Pick a service. It will be saved under Max ID {trip.caseNo}.</p>}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {add.map(a => a.service ? <AddServiceButton key={a.label} tripId={id} service={a.service} label={a.label} icon={a.icon} /> : <Link key={a.label} href={a.href} className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 hover:border-teal-600 hover:bg-teal-50"><Icon name={a.icon} size={16} className="shrink-0 text-teal-700" />{a.label}</Link>)}
      </div>
    </section>}

    {!empty && <section className="panel p-5" aria-labelledby="services-title">
      <h2 id="services-title" className="text-lg font-semibold">Services</h2>
      <ul className="mt-3 divide-y divide-slate-100">
        {trip.services.map(s => <li key={s.href} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <Link href={s.href} className={`flex min-h-11 min-w-0 items-center gap-2 text-sm ${s.dead ? "text-slate-400 line-through" : "font-medium text-blue-700 underline"}`}><Icon name={SERVICE_ICON[s.kind]} size={16} className="shrink-0" /><span className="sr-only">{SERVICE_LABEL[s.kind]}: </span><span className="break-words">{s.label}</span></Link>
          <Status tone={s.dead ? "danger" : "neutral"}>{s.status}</Status>
        </li>)}
      </ul>
      {trip.quotes.some(q => q.latestQuote) && <p className="mt-2 text-xs text-slate-500">Latest quote: {trip.quotes.filter(q => q.latestQuote).map(q => `${q.title} · ${enumLabel(q.latestQuote!.state)} · ${inrAmount(q.latestQuote!.totalMinor / 100)}`).join("; ")}</p>}
    </section>}

    {trip.money && <section id="money" className="space-y-3" aria-label="Money">
      <details className="panel p-5"><summary className="cursor-pointer font-semibold">Profit for each booking and visa</summary><div className="mt-3"><CaseProfit user={user} id={id} /></div></details>
      <div className="flex flex-wrap gap-2"><Link className="btn-secondary" href={`/reports?report=statement&customerId=${trip.customer.id}`}>Customer statement</Link><Link className="btn-secondary" href={`/payments?customer=${trip.customer.id}`}>Invoices & receipts</Link></div>
    </section>}

    {work && <section id="todos" aria-label="To-dos" className="scroll-mt-20">
      <Suspense fallback={<p role="status">Loading to-dos…</p>}><WorkDesk initialData={work} caseId={id} embedded /></Suspense>
    </section>}

    {can("document:view") && <section id="documents" className="panel p-5" aria-labelledby="docs-title">
      <h2 id="docs-title" className="text-lg font-semibold">Documents</h2>
      {trip.documents.length ? <ul className="mt-3 divide-y divide-slate-100">{trip.documents.map(d => <li key={d.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><Link className="text-blue-700 underline" href={`/documents?focus=${d.id}`}>{d.docNo} · {d.docType}</Link><span className="text-slate-600">{enumLabel(d.status)}</span></li>)}</ul>
        : <p className="mt-2 text-sm text-slate-600">No visa documents on this trip yet.</p>}
      <p className="mt-3 text-sm"><Link className="text-blue-700 underline" href={`/masters/${trip.customer.id}?tab=travellers`}>Passports and traveller documents are on the customer page</Link></p>
    </section>}

    {canEditCase(user) && <CaseEditor key={record.version} record={record} owners={owners} canAssign={canAssignCase(user)} />}

    <details id="history" className="panel p-5" open={history.open}>
      <summary className="cursor-pointer text-lg font-semibold">History <span className="text-sm font-normal text-slate-500">· who changed what, and when</span></summary>
      <ol className="mt-3 divide-y divide-slate-100">
        {history.rows.map(e => <li key={e.id} className="py-3 text-sm">
          <p className="whitespace-pre-wrap break-words">{e.what}</p>
          <p className="mt-1 text-xs text-slate-500">{dateTimeLabel(e.at)} · {e.who}{e.href && <> · <Link className="inline-flex min-h-8 items-center px-1 text-blue-700 underline" href={e.href}>Open</Link></>}</p>
        </li>)}
      </ol>
      <nav className="mt-2 flex gap-3" aria-label="History pages">
        {history.page > 1 && <Link className="btn-secondary" href={historyHref(history.page - 1)}>Newer</Link>}
        {history.more && <Link className="btn-secondary" href={historyHref(history.page + 1)}>Older</Link>}
      </nav>
    </details>
  </div>;
}
