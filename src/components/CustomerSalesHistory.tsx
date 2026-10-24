import Link from "next/link";
import type { CustomerSalesHistory as History } from "@/lib/customer-sales-history";
import { enumLabel } from "@/lib/labels";
import { dateTimeLabel } from "@/lib/dates";

/** No fetches or mutation actions: every link opens the scoped, exact enquiry. */
export function CustomerSalesHistory({ history }: { history: History }) {
  return <section className="panel p-5" aria-label="Enquiries and quotations">
    <h2 className="text-sm font-semibold">Enquiries and quotations</h2>
    {!history.accessible ? <p className="mt-2 text-sm text-slate-500">Sales history is not available with your current access.</p> : <>
      <p className="mt-2 text-xs text-slate-500">{history.enquiries.length ? `Showing ${history.enquiries.length} of ${history.total} accessible enquiries, newest first.` : "No enquiries visible for this customer in your current scope."} Records outside your scope are not included.</p>
      <ul className="divide-y divide-slate-100">
        {history.enquiries.map(lead => <li key={lead.id} className="py-3">
          <Link className="text-sm font-semibold text-teal-700 hover:underline" href={lead.href}>{lead.title} · Open enquiry</Link>
          <p className="mt-1 text-xs text-slate-600">{enumLabel(lead.product)} · {enumLabel(lead.stage)}{lead.destination ? ` · ${lead.destination}` : ""}{lead.followUpAt ? ` · Follow-up ${dateTimeLabel(lead.followUpAt)}` : ""}</p>
          {lead.quotes.length ? <>
            <p className="mt-2 text-xs text-slate-500">Latest {lead.quotes.length} of {lead.quoteCount} quote versions. Open enquiry for full history.</p>
            <ul className="mt-1 space-y-1 text-xs text-slate-600">{lead.quotes.map(quote => <li key={quote.id}>
              v{quote.version} · {enumLabel(quote.state)} · {quote.state === "ACCEPTED" || quote.state === "CONVERTED" ? `Accepted ${dateTimeLabel(quote.acceptedAt)}` : `Expiry ${dateTimeLabel(quote.expiresAt)}`}
              {quote.state === "ACCEPTED" && " · No CRM booking created"}
              {quote.state === "CONVERTED" && " · CRM booking created; not supplier confirmation"}
            </li>)}</ul>
          </> : <p className="mt-2 text-xs text-slate-500">No quotations yet.</p>}
        </li>)}
      </ul>
      <Link href="/sales" className="mt-2 inline-block text-xs font-medium text-teal-700 hover:underline">Open Sales to search all accessible enquiries</Link>
    </>}
  </section>;
}

export default CustomerSalesHistory;
