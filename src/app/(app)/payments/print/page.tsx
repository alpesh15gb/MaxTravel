import "./print-document.css";
import { dateLabel } from "@/lib/dates";
import { inrFixed } from "@/lib/money";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getServerSession } from "@/lib/session";
import { canTouchRecord } from "@/lib/guard";
import PrintButton from "./PrintButton";
import { readInvoiceTaxSnapshot } from "@/lib/invoice-config";

export const dynamic = "force-dynamic";

const money = (n: number) => inrFixed(n);
const dOnly = (s: Date | null) => (s ? dateLabel(s) : "—");

export default async function PrintDocumentPage({ searchParams }: { searchParams: Promise<{ invoice?: string; receipt?: string; creditNote?: string }> }) {
  const user = await getServerSession();
  if (!user) redirect("/login");
  const { invoice: invoiceId, receipt: receiptId, creditNote: creditNoteId } = await searchParams;

  if (creditNoteId) {
    const note = await prisma.invoiceCreditNote.findUnique({ where: { id: creditNoteId }, include: { invoice: { include: { customer: { include: { branch: true } } } }, issuedBy: { select: { name: true } } } });
    if (!note || !canTouchRecord(user, note.invoice.customer)) notFound();
    const tax = readInvoiceTaxSnapshot(note.taxSnapshot);
    return <div className="financial-document mx-auto max-w-2xl bg-white p-10 text-sm text-slate-900 print:p-0"><div className="financial-document-header mb-8 flex items-start justify-between"><div><h1 className="text-2xl font-bold">Credit note</h1><p className="mt-1 font-mono text-xs text-slate-500">{note.creditNoteNo}</p><p className="mt-1 text-xs text-slate-500">Against invoice {note.invoice.invoiceNo}</p></div><div className="text-right text-xs text-slate-500"><div className="font-semibold text-base text-slate-900">{tax?.issuer.name??note.invoice.customer.branch.name}</div>{tax?<><div>GSTIN: {tax.issuer.gstin}</div><div>{tax.issuer.address}</div></>:<div>{note.invoice.customer.branch.city}</div>}</div></div><div className="mb-5 rounded-lg border border-slate-200 p-4 text-xs"><div className="font-semibold">Credit issued to</div><div>{tax?.buyer.companyName||tax?.buyer.name||note.invoice.customer.name}</div>{tax?.buyer.gstin&&<div>GSTIN: {tax.buyer.gstin}</div>}{tax?.buyer.address&&<div>{tax.buyer.address}</div>}</div><table className="w-full border-collapse text-sm"><tbody><tr><td className="border border-slate-300 px-3 py-2 font-medium">Credit note date</td><td className="border border-slate-300 px-3 py-2">{dOnly(note.issuedOn)}</td></tr><tr><td className="border border-slate-300 px-3 py-2 font-medium">Reason</td><td className="border border-slate-300 px-3 py-2">{note.reason}</td></tr>{tax&&<><tr><td className="border border-slate-300 px-3 py-2">Taxable subtotal credited</td><td className="border border-slate-300 px-3 py-2">{money(tax.subtotalMinor/100)}</td></tr>{tax.components.map((component,index)=><tr key={`${component.label}-${index}`}><td className="border border-slate-300 px-3 py-2">{component.label} credit</td><td className="border border-slate-300 px-3 py-2">{money(component.amountMinor/100)}</td></tr>)}</>}<tr><td className="border border-slate-300 px-3 py-2 font-bold">Total credit</td><td className="border border-slate-300 px-3 py-2 font-bold">{money(note.amount)}</td></tr></tbody></table><p className="mt-6 text-xs leading-5 text-slate-500">This credit note closes the fully unpaid invoice balance. It does not represent a cash refund or bank transaction. Recorded by {note.issuedBy?.name??"staff"}.</p>{tax?.footer&&<p className="mt-3 text-xs leading-5">{tax.footer}</p>}<div className="mt-6 text-center"><PrintButton/></div><style>{`@media print{.no-print{display:none}body{background:white}}`}</style></div>;
  }

  if (invoiceId) {
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { customer: { include: { branch: true } }, booking: true, visaCase: true, payments: { orderBy: { receivedOn: "asc" } }, creditNote: true } });
    if (!invoice || !canTouchRecord(user, invoice.customer)) notFound();
    const balance = invoice.status === "CREDITED" ? 0 : Math.round((invoice.amount - invoice.amountPaid) * 100) / 100;
    const tax = invoice.documentKind === "TAX_INVOICE" ? readInvoiceTaxSnapshot(invoice.taxSnapshot) : null;
    const taxSnapshotMissing = invoice.documentKind === "TAX_INVOICE" && !tax;
    return (
      <div className="financial-document mx-auto max-w-2xl bg-white p-10 text-sm text-slate-900 print:p-0">
        <div className="financial-document-header mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{tax?.title ?? (taxSnapshotMissing ? "Tax invoice · snapshot unavailable" : "Operational invoice")}</h1>
            <p className="mt-1 font-mono text-xs text-slate-500">{invoice.invoiceNo}</p>
            <p className="mt-1 text-xs uppercase tracking-widest text-slate-500">{invoice.documentKind === "TAX_INVOICE" ? "Invoice copy" : "Operational billing record"}</p>
          </div>
          <div className="text-right text-xs text-slate-500">
            {tax ? <><div className="font-semibold text-base text-slate-900">{tax.issuer.name}</div><div>GSTIN: {tax.issuer.gstin}</div><div>{tax.issuer.address}</div><div>{tax.issuer.state}</div></> : <><div className="font-semibold text-base text-slate-900">{invoice.customer.name}</div><div>{invoice.customer.code}</div><div>{invoice.customer.phone}</div>{invoice.customer.email && <div>{invoice.customer.email}</div>}</>}
          </div>
        </div>
        {tax&&<div className="mb-5 rounded-lg border border-slate-200 p-4 text-xs"><div className="font-semibold">Bill to</div><div>{tax.buyer.companyName||tax.buyer.name}</div>{tax.buyer.gstin&&<div>GSTIN: {tax.buyer.gstin}</div>}{tax.buyer.address&&<div>{tax.buyer.address}</div>}<div>{tax.buyer.city}, {tax.buyer.state}</div><div className="mt-2">Place of supply: {tax.placeOfSupply}</div>{tax.sac&&<div>Service code: {tax.sac}</div>}</div>}
        {taxSnapshotMissing&&<div role="alert" className="mb-5 border border-rose-300 bg-rose-50 p-3 text-xs font-semibold text-rose-900">The tax configuration snapshot is unavailable. Do not use this printout as an issued tax document; contact an administrator to investigate the record.</div>}
        <table className="w-full border-collapse text-sm">
          <tbody>
            <tr><td className="border border-slate-300 px-3 py-2 font-medium">Description</td><td className="border border-slate-300 px-3 py-2">{invoice.description ?? "Travel services"}</td></tr>
            {tax&&<tr><td className="border border-slate-300 px-3 py-2 font-medium">Tax profile</td><td className="border border-slate-300 px-3 py-2">{tax.profile.label}</td></tr>}
            <tr><td className="border border-slate-300 px-3 py-2 font-medium">Issued</td><td className="border border-slate-300 px-3 py-2">{dOnly(invoice.issuedOn)}</td></tr>
            <tr><td className="border border-slate-300 px-3 py-2 font-medium">Due</td><td className="border border-slate-300 px-3 py-2">{dOnly(invoice.dueDate)}</td></tr>
            <tr><td className="border border-slate-300 px-3 py-2 font-medium">Status</td><td className="border border-slate-300 px-3 py-2">{invoice.status === "CREDITED" ? "Credited in full" : invoice.status}</td></tr>
            {invoice.creditNote&&<tr><td className="border border-slate-300 px-3 py-2 font-medium">Credit note</td><td className="border border-slate-300 px-3 py-2"><a className="underline" href={`/payments/print?creditNote=${invoice.creditNote.id}`}>{invoice.creditNote.creditNoteNo}</a> · {dOnly(invoice.creditNote.issuedOn)}</td></tr>}
            {invoice.booking && <tr><td className="border border-slate-300 px-3 py-2 font-medium">Booking</td><td className="border border-slate-300 px-3 py-2">{invoice.booking.bookingNo}{invoice.booking.pnr ? ` · PNR ${invoice.booking.pnr}` : ""}</td></tr>}
            {invoice.visaCase && <tr><td className="border border-slate-300 px-3 py-2 font-medium">Visa case</td><td className="border border-slate-300 px-3 py-2">{invoice.visaCase.caseNo} · {invoice.visaCase.destination}</td></tr>}
            {tax&&<tr><td className="border border-slate-300 px-3 py-2">Taxable subtotal</td><td className="border border-slate-300 px-3 py-2">{money(tax.subtotalMinor/100)}</td></tr>}
            {tax?.components.map((component,index)=><tr key={`${component.label}-${index}`}><td className="border border-slate-300 px-3 py-2">{component.label} ({(component.rateBasisPoints/100).toFixed(2)}%)</td><td className="border border-slate-300 px-3 py-2">{money(component.amountMinor/100)}</td></tr>)}
            <tr><td className="border border-slate-300 px-3 py-2 font-bold">{tax?"Total": "Amount"}</td><td className="border border-slate-300 px-3 py-2 font-bold">{money(invoice.amount)}</td></tr>
            <tr><td className="border border-slate-300 px-3 py-2">Received</td><td className="border border-slate-300 px-3 py-2">{money(invoice.amountPaid)}</td></tr>
            <tr><td className="border border-slate-300 px-3 py-2 font-bold">Balance due</td><td className="border border-slate-300 px-3 py-2 font-bold">{money(balance)}</td></tr>
          </tbody>
        </table>
        {invoice.payments.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-500">Receipts against this invoice</h2>
            <table className="w-full border-collapse text-xs">
              <thead><tr>{["Receipt", "Mode", "Received", "Amount"].map(h => <th key={h} className="border border-slate-300 px-2 py-1 text-left">{h}</th>)}</tr></thead>
              <tbody>{invoice.payments.map(p => <tr key={p.id}><td className="border border-slate-300 px-2 py-1 font-mono">{p.receiptNo}</td><td className="border border-slate-300 px-2 py-1">{p.mode}</td><td className="border border-slate-300 px-2 py-1">{dOnly(p.receivedOn)}</td><td className="border border-slate-300 px-2 py-1 text-right">{money(p.amount)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {tax?.footer&&<p className="mt-6 text-small leading-5 text-slate-600">{tax.footer}</p>}
        <p className="mt-8 text-small leading-5 text-slate-500">{tax ? "Tax labels, rates and issuer details are the saved agency configuration for this invoice." : `Operational billing record from the ${user.branchName ?? "agency"} workspace.`} Printed {dOnly(new Date())} by {user.name}.</p>
        <div className="mt-6"><PrintButton /></div>
        <style>{`@media print{.no-print{display:none}body{background:white}}`}</style>
      </div>
    );
  }

  if (receiptId) {
    const receipt = await prisma.payment.findUnique({ where: { id: receiptId }, include: { customer: true, booking: true, visaCase: true, invoice: true } });
    if (!receipt || !canTouchRecord(user, receipt.customer)) notFound();
    return (
      <div className="financial-document mx-auto max-w-xl bg-white p-10 text-sm text-slate-900 print:p-0">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold">Payment receipt</h1>
          <p className="mt-1 font-mono text-xs text-slate-500">{receipt.receiptNo}</p>
        </div>
        <table className="w-full border-collapse text-sm">
          <tbody>
            <tr><td className="border border-slate-300 px-3 py-2 font-medium">Received from</td><td className="border border-slate-300 px-3 py-2">{receipt.customer.name} ({receipt.customer.code})</td></tr>
            <tr><td className="border border-slate-300 px-3 py-2 font-medium">Amount</td><td className="border border-slate-300 px-3 py-2 font-bold">{money(receipt.amount)}</td></tr>
            <tr><td className="border border-slate-300 px-3 py-2 font-medium">Mode</td><td className="border border-slate-300 px-3 py-2">{receipt.mode}</td></tr>
            <tr><td className="border border-slate-300 px-3 py-2 font-medium">Received on</td><td className="border border-slate-300 px-3 py-2">{dOnly(receipt.receivedOn)}</td></tr>
            {receipt.booking && <tr><td className="border border-slate-300 px-3 py-2 font-medium">Towards booking</td><td className="border border-slate-300 px-3 py-2">{receipt.booking.bookingNo}{receipt.booking.pnr ? ` · PNR ${receipt.booking.pnr}` : ""}</td></tr>}
            {receipt.visaCase && <tr><td className="border border-slate-300 px-3 py-2 font-medium">Towards visa case</td><td className="border border-slate-300 px-3 py-2">{receipt.visaCase.caseNo}</td></tr>}
            {receipt.invoice && <tr><td className="border border-slate-300 px-3 py-2 font-medium">Towards invoice</td><td className="border border-slate-300 px-3 py-2">{receipt.invoice.invoiceNo}</td></tr>}
            {receipt.note && <tr><td className="border border-slate-300 px-3 py-2 font-medium">Note</td><td className="border border-slate-300 px-3 py-2">{receipt.note}</td></tr>}
            <tr><td className="border border-slate-300 px-3 py-2 font-medium">Recorded by</td><td className="border border-slate-300 px-3 py-2">{receipt.receivedById ? (await prisma.user.findUnique({ where: { id: receipt.receivedById }, select: { name: true } }))?.name ?? "—" : "—"}</td></tr>
          </tbody>
        </table>
        <p className="mt-8 text-small leading-5 text-slate-500">This is a computer-generated record of money logged in the agency workspace — it is not a bank confirmation. It is not a bank statement or a statutory tax document. Printed {dOnly(new Date())} by {user.name}.</p>
        <div className="mt-6 text-center"><PrintButton /></div>
        <style>{`@media print{.no-print{display:none}body{background:white}}`}</style>
      </div>
    );
  }

  notFound();
}
