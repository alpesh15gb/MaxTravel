import PlatformActions from "./PlatformActions";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePage, scopeWhere } from "@/lib/guard";
import { enumLabel } from "@/lib/labels";
import { inrAmount } from "@/lib/money";
import { Status } from "@/components/ui";

export default async function OnlineBookingsPage() {
  const user = await requirePage("ticketing:view");
  const rows = await prisma.booking.findMany({
    where: { gdsSource: "TRIPJACK_API", ...scopeWhere(user, user.branchId, "ownerId") },
    include: { customer: { select: { id: true, name: true } }, payments: true, refunds: true },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
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
    <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50"><tr>{["Reference", "Customer", "Product", "Status", "Supplier reference", "Customer total", "Received", "Refunded"].map(label => <th key={label} className="whitespace-nowrap p-4">{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => {
          const link = platformLink(row.id), document = documentFor(row.id), amounts = financials(row);
          return <tr key={row.id} className="border-t border-slate-100 align-top">
            <td className="min-w-52 p-4"><strong>{row.bookingNo}</strong>{document&&<a className="mt-2 block text-xs font-medium text-teal-700 underline" href={`/api/whatsapp/attachments/${document.id}`} target="_blank" rel="noopener noreferrer">Download booking PDF</a>}<PlatformActions bookingId={row.id} permissions={user.permissions}/></td>
            <td className="whitespace-nowrap p-4"><Link href={`/customers/${row.customerId}`} className="font-medium text-teal-700">{row.customer.name}</Link></td>
            <td className="whitespace-nowrap p-4">{enumLabel(row.product)}</td>
            <td className="whitespace-nowrap p-4"><Status>{enumLabel(link?.platformStatus||row.status)}</Status></td>
            <td className="whitespace-nowrap p-4">{link?.supplierReference||"Pending"}</td>
            <td className="whitespace-nowrap p-4 tabular-nums">{amounts.selling}</td>
            <td className="whitespace-nowrap p-4 tabular-nums">{amounts.received}</td>
            <td className="whitespace-nowrap p-4 tabular-nums">{amounts.refunded}</td>
          </tr>;
        })}</tbody>
      </table>
      {!rows.length&&<p className="p-8 text-sm text-slate-500">No online bookings have synced yet.</p>}
    </div>
    {rows.length ? <div role="list" aria-label="Online bookings at mobile width" className="grid gap-3 md:hidden">{rows.map(row => {
      const link = platformLink(row.id), document = documentFor(row.id), amounts = financials(row);
      return <article role="listitem" key={row.id} className="panel min-w-0 p-4">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-all text-base font-semibold">{row.bookingNo}</h2><Link href={`/customers/${row.customerId}`} className="mt-1 inline-block text-sm font-medium text-teal-700">{row.customer.name}</Link></div><Status>{enumLabel(link?.platformStatus||row.status)}</Status></div>
        {document&&<a className="mt-3 inline-flex min-h-10 items-center text-sm font-medium text-teal-700 underline" href={`/api/whatsapp/attachments/${document.id}`} target="_blank" rel="noopener noreferrer">Download booking PDF</a>}
        <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-sm"><div><dt className="text-xs text-slate-500">Product</dt><dd className="mt-1">{enumLabel(row.product)}</dd></div><div><dt className="text-xs text-slate-500">Supplier reference</dt><dd className="mt-1 break-words">{link?.supplierReference||"Pending"}</dd></div><div><dt className="text-xs text-slate-500">Customer total</dt><dd className="mt-1 tabular-nums">{amounts.selling}</dd></div><div><dt className="text-xs text-slate-500">Received</dt><dd className="mt-1 tabular-nums">{amounts.received}</dd></div><div><dt className="text-xs text-slate-500">Refunded</dt><dd className="mt-1 tabular-nums">{amounts.refunded}</dd></div></dl>
        <PlatformActions bookingId={row.id} permissions={user.permissions}/>
      </article>;
    })}</div> : <section className="panel p-6 text-sm text-slate-600 md:hidden"><h2 className="font-semibold text-slate-900">No online bookings yet</h2><p className="mt-2">Confirmed customer bookings from the booking platform will appear here after the CRM integration syncs them.</p></section>}
    {rows.length===100&&<p className="text-xs text-slate-500">Showing the 100 most recently updated online bookings.</p>}
  </div>;
}
