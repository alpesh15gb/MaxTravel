import { dateLabel } from "@/lib/dates";
import { inrFixed } from "@/lib/money";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getServerSession } from "@/lib/session";
import { canTouchRecord } from "@/lib/guard";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

const money = (n: number) => inrFixed(n);
const dOnly = (s: Date | null) => (s ? dateLabel(s) : "—");

export default async function PrintDocumentPage({ searchParams }: { searchParams: Promise<{ invoice?: string; receipt?: string }> }) {
  const user = await getServerSession();
  if (!user) redirect("/login");
  const { invoice: invoiceId, receipt: receiptId } = await searchParams;

  if (invoiceId) {
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { customer: { include: { branch: true } }, booking: true, visaCase: true, payments: { orderBy: { receivedOn: "asc" } } } });
    if (!invoice || !canTouchRecord(user, invoice.customer)) notFound();
    const balance = Math.round((invoice.amount - invoice.amountPaid) * 100) / 100;
    return (
      <div className="mx-auto max-w-2xl bg-white p-10 text-sm text-slate-900 print:p-0">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{invoice.invoiceNo}</h1>
            <p className="mt-1 text-xs uppercase tracking-widest text-slate-500">Tax invoice / bill of supply — draft for agency review</p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <div className="font-semibold text-base text-slate-900">{invoice.customer.name}</div>
            <div>{invoice.customer.code}</div>
            <div>{invoice.customer.phone}</div>
            {invoice.customer.email && <div>{invoice.customer.email}</div>}
          </div>
        </div>
        <table className="w-full border-collapse text-sm">
          <tbody>
            <tr><td className="border border-slate-300 px-3 py-2 font-medium">Description</td><td className="border border-slate-300 px-3 py-2">{invoice.description ?? "Travel services"}</td></tr>
            <tr><td className="border border-slate-300 px-3 py-2 font-medium">Issued</td><td className="border border-slate-300 px-3 py-2">{dOnly(invoice.issuedOn)}</td></tr>
            <tr><td className="border border-slate-300 px-3 py-2 font-medium">Due</td><td className="border border-slate-300 px-3 py-2">{dOnly(invoice.dueDate)}</td></tr>
            {invoice.booking && <tr><td className="border border-slate-300 px-3 py-2 font-medium">Booking</td><td className="border border-slate-300 px-3 py-2">{invoice.booking.bookingNo}{invoice.booking.pnr ? ` · PNR ${invoice.booking.pnr}` : ""}</td></tr>}
            {invoice.visaCase && <tr><td className="border border-slate-300 px-3 py-2 font-medium">Visa case</td><td className="border border-slate-300 px-3 py-2">{invoice.visaCase.caseNo} · {invoice.visaCase.destination}</td></tr>}
            <tr><td className="border border-slate-300 px-3 py-2 font-bold">Amount</td><td className="border border-slate-300 px-3 py-2 font-bold">{money(invoice.amount)}</td></tr>
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
        <p className="mt-8 text-small leading-5 text-slate-500">This document reflects receipts recorded in the {user.branchName ?? "your agency"} workspace as of the print date; it is not a statutory GST invoice until your accountant confirms the applicable tax treatment. Printed {dOnly(new Date())} by {user.name}.</p>
        <div className="mt-6"><PrintButton /></div>
        <style>{`@media print{.no-print{display:none}body{background:white}}`}</style>
      </div>
    );
  }

  if (receiptId) {
    const receipt = await prisma.payment.findUnique({ where: { id: receiptId }, include: { customer: true, booking: true, visaCase: true, invoice: true } });
    if (!receipt || !canTouchRecord(user, receipt.customer)) notFound();
    return (
      <div className="mx-auto max-w-xl bg-white p-10 text-sm text-slate-900 print:p-0">
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
