"use client";

import Link from "next/link";
import { dateLabel } from "@/lib/dates";
import { enumLabel } from "@/lib/labels";
import { inrFixed } from "@/lib/money";
import { Status } from "@/components/ui";

type CreditNote = { id: string; creditNoteNo: string; amount: number };
type Invoice = {
  id: string; invoiceNo: string; documentKind: string; creditNote: CreditNote | null;
  customer: string; customerId: string; bookingId: string | null; visaCaseId: string | null;
  description: string | null; amount: number; amountPaid: number; status: string;
  dueDate: string | null;
};
type Receipt = {
  id: string; receiptNo: string; customer: string; amount: number;
  mode: string; receivedOn: string; ref: string | null;
};
const money = (amount: number) => inrFixed(amount);

export function InvoiceCards({ rows, query, canCredit, canRecord, focus, onCredit }: {
  rows: Invoice[]; query: string; canCredit: boolean; canRecord: boolean;
  focus: string | null; onCredit: (invoice: Invoice) => void;
}) {
  const visible = rows.filter(invoice => `${invoice.invoiceNo} ${invoice.customer} ${invoice.description ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  return <div role="list" aria-label="Invoices and balances" className="grid gap-3 md:hidden">{visible.map(invoice => {
    const balance = invoice.status === "CREDITED" ? 0 : Math.max(0, invoice.amount - invoice.amountPaid);
    return <article role="listitem" key={invoice.id} className={`panel p-4 ${focus === invoice.id ? "border-teal-300 bg-teal-50/40" : ""}`}>
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="font-semibold">{invoice.invoiceNo}</span>{invoice.documentKind === "TAX_INVOICE" && <span className="ml-2 rounded-full bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800">Tax invoice</span>}<Link href={`/customers/${invoice.customerId}`} className="mt-1 block text-sm text-teal-700">{invoice.customer}</Link></div><Status tone={invoice.status === "PAID" ? "success" : invoice.status === "PARTIAL" ? "warning" : "neutral"}>{enumLabel(invoice.status)}</Status></div>
      <p className="mt-3 break-words text-sm text-slate-600">{invoice.description || "No description"}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-slate-500">Invoice total</dt><dd className="mt-1 font-medium">{money(invoice.amount)}</dd></div><div><dt className="text-xs text-slate-500">Balance due</dt><dd className="mt-1 font-semibold text-amber-800">{money(balance)}</dd></div><div><dt className="text-xs text-slate-500">Due date</dt><dd className="mt-1">{invoice.dueDate ? dateLabel(invoice.dueDate) : "Not set"}</dd></div><div><dt className="text-xs text-slate-500">Paid to date</dt><dd className="mt-1">{money(invoice.amountPaid)}</dd></div></dl>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-sm"><a className="font-medium text-teal-700" href={`/payments/print?invoice=${invoice.id}`} target="_blank" rel="noopener noreferrer">Print invoice</a>{invoice.creditNote && <a className="font-medium text-teal-700" href={`/payments/print?creditNote=${invoice.creditNote.id}`} target="_blank" rel="noopener noreferrer">Credit note</a>}{canCredit && invoice.status === "UNPAID" && invoice.amountPaid === 0 && !invoice.bookingId && !invoice.visaCaseId && !invoice.creditNote && <button className="font-medium text-rose-700" onClick={() => onCredit(invoice)}>Issue credit note</button>}{canRecord && invoice.status !== "PAID" && invoice.status !== "CREDITED" && <Link className="font-medium text-teal-700" href={`/payments?action=record&customer=${invoice.customerId}&invoice=${invoice.id}`}>Collect</Link>}</div>
    </article>;
  })}</div>;
}

export function ReceiptCards({ rows, query }: { rows: Receipt[]; query: string }) {
  const visible = rows.filter(receipt => `${receipt.receiptNo} ${receipt.customer}`.toLowerCase().includes(query.toLowerCase()));
  return <div role="list" aria-label="Payment receipts" className="grid gap-3 md:hidden">{visible.map(receipt => <article role="listitem" key={receipt.id} className="panel p-4">
    <div className="flex items-start justify-between gap-3"><div><span className="font-semibold">{receipt.receiptNo}</span><span className="mt-1 block text-sm text-slate-600">{receipt.customer}</span></div><span className="font-semibold tabular-nums">{money(receipt.amount)}</span></div>
    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-slate-500">Received via</dt><dd className="mt-1">{enumLabel(receipt.mode)}</dd></div><div><dt className="text-xs text-slate-500">Received on</dt><dd className="mt-1">{dateLabel(receipt.receivedOn)}</dd></div><div className="col-span-2"><dt className="text-xs text-slate-500">Allocation</dt><dd className="mt-1 break-words">{receipt.ref ?? "Customer advance"}</dd></div></dl>
    <a className="mt-4 inline-flex min-h-10 items-center border-t border-slate-100 pt-2 text-sm font-medium text-teal-700" href={`/payments/print?receipt=${receipt.id}`} target="_blank" rel="noopener noreferrer">Print receipt</a>
  </article>)}</div>;
}
