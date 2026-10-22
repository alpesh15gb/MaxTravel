import "./online-bookings.css";
import { ONLINE_BOOKING_STATUSES, onlineBookingQuery, onlineBookingPage, onlineBookingsHref, parseOnlineBookingFilters, type SearchParams } from "@/lib/online-bookings-query";
import PlatformActions from "./PlatformActions";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePage, scopeWhere } from "@/lib/guard";
import { enumLabel } from "@/lib/labels";
import { inrAmount } from "@/lib/money";
import { Status } from "@/components/ui";

export default async function OnlineBookingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePage("ticketing:view");
  const filters = parseOnlineBookingFilters(await searchParams);
  const results = await prisma.booking.findMany({
    ...onlineBookingQuery(filters, scopeWhere(user, user.branchId, "ownerId")),
    include: { customer: { select: { id: true, name: true } }, payments: true, refunds: true },
  });
  const { rows, hasOlder, hasNewer } = onlineBookingPage(results, filters);
  const links = await prisma.platformBookingLink.findMany({ where: { bookingId: { in: rows.map(row => row.id) } } });
  const documents = await prisma.whatsAppAttachment.findMany({
    where: { id: { in: links.filter(link => link.documentsCurrent).map(link => `platform-pdf-${link.platformId}-${link.revision}`) } },
    select: { id: true, filename: true },
  });
  const finance = user.permissions.includes("payment:view");
  const platformLink = (bookingId: string) => links.find(link => link.bookingId === bookingId);
  const documentFor = (bookingId: string) => {
    const link = platformLink(bookingId);
    return link && link.documentsCurrent ? documents.find(document => document.id === `platform-pdf-${link.platformId}-${link.revision}`) : undefined;
  };
  const financials = (row: typeof rows[number]) => ({
    selling: finance ? inrAmount(row.sellingPrice) : "Restricted",
    received: finance ? inrAmount(row.payments.reduce((sum, payment) => sum + payment.amount, 0)) : "Restricted",
    refunded: finance ? inrAmount(row.refunds.filter(refund => refund.status === "PAID").reduce((sum, refund) => sum + refund.amount, 0)) : "Restricted",
  });

  return <div className="workspace-page space-y-5">
    <div>
      <div className="eyebrow">BOOKING PLATFORM ↔ CRM</div>
      <h1 className="text-2xl font-semibold">Online bookings</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Flight and hotel bookings synced from the Max Travel booking platform. Customer approval and refund controls are handled through the mapped booking administrator permissions.</p>
    </div>
    <form action="/online-bookings" method="get" className="online-bookings-filters panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto]" aria-label="Find online bookings">
      <label className="min-w-0 text-sm font-medium">Search bookings<input name="q" defaultValue={filters.q} maxLength={100} placeholder="Reference, PNR or customer name" className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3" /></label>
      <div className="min-w-0 text-sm font-medium"><label htmlFor="online-bookings-product">Product</label><select id="online-bookings-product" name="product" defaultValue={filters.product} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3"><option value="">All products</option><option value="FLIGHT">Flight</option><option value="HOTEL">Hotel</option></select></div>
      <div className="min-w-0 text-sm font-medium"><label htmlFor="online-bookings-status">CRM status</label><select id="online-bookings-status" name="status" defaultValue={filters.status} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3"><option value="">All CRM statuses</option>{ONLINE_BOOKING_STATUSES.map(status => <option key={status} value={status}>{enumLabel(status)}</option>)}</select></div>
      <div className="flex items-end gap-3"><button type="submit" className="min-h-11 rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white">Apply filters</button><Link href="/online-bookings" className="inline-flex min-h-11 items-center text-sm font-medium text-teal-700 underline">Clear</Link></div>
    </form>
    <p className="text-sm text-slate-600">{rows.length} booking{rows.length === 1 ? "" : "s"} on this page · Newest CRM records first. Statuses below are synced snapshots, not live supplier checks. CRM status filters use the local CRM workflow status.</p>
    {filters.invalid && <p role="alert" className="panel p-4 text-sm text-amber-800">These filters or page link are invalid. No records were loaded. Apply valid filters or clear them to restart.</p>}
    {!rows.length && !filters.invalid && <section className="panel p-6"><h2 className="font-semibold">{filters.cursor ? "No bookings on this page" : filters.q || filters.status || filters.product ? "No matching online bookings" : "No online bookings available"}</h2><p className="mt-2 text-sm text-slate-600">{filters.cursor ? "Records may have changed. Return to the first page with these filters." : "Only bookings within your access are shown. Try different filters, or check that the platform integration has synced your bookings."}</p><Link className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-teal-700 underline" href={onlineBookingsHref(filters)}>Return to first page</Link></section>}
    {!!rows.length && <div className="min-w-0 md:overflow-x-auto md:rounded-xl md:border md:border-slate-200 md:bg-white">
      <table aria-label="Online bookings" className="online-bookings-records block w-full text-left text-sm md:table">
        <thead className="hidden bg-slate-50 md:table-header-group"><tr>{["Reference", "Customer", "Product", "Synced platform status", "Supplier reference", "Customer total", "Received", "Refunded"].map(label => <th scope="col" key={label} className="whitespace-nowrap p-4">{label}</th>)}</tr></thead>
        <tbody className="grid gap-3 md:table-row-group">{rows.map(row => {
          const link = platformLink(row.id), document = documentFor(row.id), amounts = financials(row);
          return <tr key={row.id} className="grid min-w-0 grid-cols-2 gap-x-3 rounded-xl border border-slate-200 bg-white p-4 align-top md:table-row md:rounded-none md:border-0 md:border-t md:border-slate-100 md:p-0">
            <td className="col-span-2 block min-w-0 pb-3 md:table-cell md:min-w-72 md:p-4 [&_details]:min-w-0 [&_summary]:min-h-11 [&_summary]:py-3"><span className="mb-1 block text-xs text-slate-500 md:hidden">Reference</span><strong className="break-all">{row.bookingNo}</strong>{document&&<a className="mt-2 inline-flex min-h-11 items-center text-xs font-medium text-teal-700 underline" href={`/api/whatsapp/attachments/${document.id}`} target="_blank" rel="noopener noreferrer">Download booking PDF</a>}<PlatformActions bookingId={row.id} permissions={user.permissions}/></td>
            <td className="col-span-2 block min-w-0 pb-3 md:table-cell md:p-4"><span className="mb-1 block text-xs text-slate-500 md:hidden">Customer</span><Link href={`/customers/${row.customerId}`} className="break-words font-medium text-teal-700">{row.customer.name}</Link></td>
            <td className="block min-w-0 pb-3 md:table-cell md:whitespace-nowrap md:p-4"><span className="mb-1 block text-xs text-slate-500 md:hidden">Product</span>{enumLabel(row.product)}</td>
            <td className="block min-w-0 pb-3 md:table-cell md:p-4"><span className="mb-1 block text-xs text-slate-500 md:hidden">Synced platform status</span><Status>{link?.platformStatus ? enumLabel(link.platformStatus) : "No platform status"}</Status><span className="mt-2 block text-xs text-slate-500">CRM: {enumLabel(row.status)}</span>{link && <span className="mt-1 block text-xs text-slate-500">Snapshot received: {link.updatedAt.toISOString().replace("T", " ").slice(0, 16)} UTC</span>}</td>
            <td className="block min-w-0 break-words pb-3 md:table-cell md:p-4"><span className="mb-1 block text-xs text-slate-500 md:hidden">Supplier reference</span>{link?.supplierReference||"Pending"}</td>
            <td className="block min-w-0 pb-3 tabular-nums md:table-cell md:whitespace-nowrap md:p-4"><span className="mb-1 block text-xs text-slate-500 md:hidden">Customer total</span>{amounts.selling}</td>
            <td className="block min-w-0 pb-3 tabular-nums md:table-cell md:whitespace-nowrap md:p-4"><span className="mb-1 block text-xs text-slate-500 md:hidden">Received</span>{amounts.received}</td>
            <td className="block min-w-0 pb-3 tabular-nums md:table-cell md:whitespace-nowrap md:p-4"><span className="mb-1 block text-xs text-slate-500 md:hidden">Refunded</span>{amounts.refunded}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
    {!!rows.length && <nav aria-label="Online booking pages" className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-4">{hasNewer && <Link className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium" href={onlineBookingsHref(filters, "newer", rows[0])}>← Newer bookings</Link>}{hasOlder && <Link className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium" href={onlineBookingsHref(filters, "older", rows[rows.length - 1])}>Older bookings →</Link>}</div>
      {filters.cursor && <Link href={onlineBookingsHref(filters)} className="inline-flex min-h-11 items-center text-sm text-teal-700 underline">First page</Link>}
    </nav>}
  </div>;
}
