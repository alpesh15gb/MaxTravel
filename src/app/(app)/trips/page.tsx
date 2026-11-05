import Link from "next/link";
import { requirePage } from "@/lib/guard";
import { CASE_READ } from "@/lib/service-cases";
import { readTrips, TRIP_VIEWS, type TripView } from "@/lib/trips-read";
import { TRIP_STAGES, TRIP_STAGE_LABEL, type TripStage } from "@/lib/trip-stage";
import { PageHeader, EmptyState, Field } from "@/components/ui";
import TripsList from "./TripsList";
export const dynamic = "force-dynamic";

const VIEW_LABEL: Record<TripView, string> = { flights: "Flights", hotels: "Hotels", visas: "Visas", enquiries: "Enquiries", online: "Online" };
type SP = { stage?: string; q?: string; mine?: string; view?: string; page?: string; customer?: string };

export default async function TripsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePage([...CASE_READ]), sp = await searchParams;
  const stage = sp.stage === "ALL" ? undefined : ([...TRIP_STAGES, "CANCELLED"] as string[]).includes(sp.stage ?? "") ? (sp.stage as TripStage) : "ACTIVE";
  const view = TRIP_VIEWS.includes(sp.view as TripView) ? (sp.view as TripView) : undefined;
  const page = Math.min(1000, Math.max(1, Math.trunc(Number(sp.page)) || 1));
  const q = sp.q?.trim().slice(0, 120) || undefined, mine = sp.mine === "1";
  const customerId = sp.customer?.slice(0, 200) || undefined;
  const data = await readTrips(user, { stage, view, search: q, mine, page, customerId });
  const active = data.counts.ENQUIRY + data.counts.QUOTED + data.counts.BOOKED + data.counts.TRAVELLING;
  const all = active + data.counts.DONE + data.counts.CANCELLED;
  const href = (o: Partial<SP>) => {
    const p = new URLSearchParams(), m: Partial<SP> = { stage: sp.stage, q, mine: mine ? "1" : undefined, view, customer: customerId, ...o };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, v);
    const s = p.toString();
    return `/trips${s ? `?${s}` : ""}`;
  };
  const chips: [string, string, number][] = [["ACTIVE", "Active", active], ...TRIP_STAGES.map(s => [s, TRIP_STAGE_LABEL[s], data.counts[s]] as [string, string, number]), ["CANCELLED", "Cancelled", data.counts.CANCELLED], ["ALL", "All", all]];
  const current = stage ?? "ALL";
  const pages = Math.max(1, Math.ceil(data.total / 50));
  return <div className="workspace-page space-y-4">
    <PageHeader title="Trips" description="Every customer job under one Max ID: enquiry, quote, bookings, visa and payment." actions={<Link className="btn-primary" href="/trips/new">New trip</Link>} />
    <form className="panel grid grid-cols-2 items-end gap-3 p-4 sm:flex sm:flex-wrap" action="/trips">
      {customerId && <input type="hidden" name="customer" value={customerId} />}
      <label className="col-span-2 min-w-0 flex-1 text-sm font-medium sm:basis-64">Search trips<input name="q" defaultValue={q} placeholder="Customer, Max ID, PNR or destination" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3" /></label>
      <Field label="Travel stage"><select name="stage" defaultValue={current}>{chips.map(([id,label,n])=><option key={id} value={id}>{label} ({n})</option>)}</select></Field>
      <Field label="Service"><select name="view" defaultValue={view??""}><option value="">All services</option>{TRIP_VIEWS.map(v=><option key={v} value={v}>{VIEW_LABEL[v]}</option>)}</select></Field>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="mine" value="1" defaultChecked={mine} />Mine only</label>
      <button className="btn-secondary">Apply filters</button>
    </form>
    {data.capped && <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">Showing the 500 most recently updated trips. Search by customer, phone, Max ID or PNR to find older ones.</p>}
    {data.rows.length ? <TripsList rows={data.rows} /> : (all > 0 || q || view || mine || customerId)
      ? <EmptyState title="No trips match" description="Try another search, stage or service." href="/trips" action="Clear filters" />
      : <EmptyState title="No trips yet" description="Start one for a customer. Every enquiry, booking and visa lives inside a trip with its own Max ID." href="/trips/new" action="New trip" />}
    {pages > 1 && <nav aria-label="Pages" className="flex items-center justify-between text-sm">
      {page > 1 ? <Link className="btn-secondary" href={href({ page: String(page - 1) })}>Previous</Link> : <span />}
      <span>Page {page} of {pages}</span>
      {page < pages ? <Link className="btn-secondary" href={href({ page: String(page + 1) })}>Next</Link> : <span />}
    </nav>}
  </div>;
}
