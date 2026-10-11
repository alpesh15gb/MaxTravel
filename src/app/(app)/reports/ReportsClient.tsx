"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader, StatCard, EmptyState } from "@/components/ui";
import Icon from "@/components/Icon";
import { inrAmount } from "@/lib/money";
import { enumLabel } from "@/lib/labels";
import type { AgencyReport } from "@/lib/reports";

function Breakdown({title,rows,money=false}:{title:string;rows:{label:string;value:number}[];money?:boolean}){
  const max=Math.max(1,...rows.map(r=>r.value));
  return <section className="panel p-5"><h2 className="text-sm font-semibold mb-5">{title}</h2>{rows.length===0?<p className="text-sm text-slate-500">No records in this period.</p>:<ul className="space-y-4">{rows.map(r=><li key={r.label}><div className="flex justify-between gap-3 text-xs mb-2"><span>{enumLabel(r.label)}</span><strong>{money?inrAmount(r.value):r.value}</strong></div><div className="report-track"><div style={{width:`${r.value/max*100}%`}}/></div></li>)}</ul>}</section>;
}
export default function ReportsClient({canExport}:{canExport:boolean}){
  const [data,setData]=useState<AgencyReport|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(true);
  const [from,setFrom]=useState(""),[to,setTo]=useState("");
  const request=useRef<AbortController|null>(null);
  const load=useCallback(async(query="")=>{
    request.current?.abort(); const controller=new AbortController();request.current=controller;setBusy(true);setError("");
    try{const r=await fetch("/api/reports"+query,{signal:controller.signal});const result=await r.json();if(!r.ok)throw new Error(result.error||"Unable to load reports.");setData(result);setFrom(result.period.from);setTo(result.period.to);}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Unable to load reports.");}finally{if(!controller.signal.aborted)setBusy(false);}
  },[]);
  useEffect(()=>{void load();return()=>request.current?.abort();},[load]);
  const query=data?new URLSearchParams({...data.period,format:"csv"}).toString():"";
  const max=Math.max(1,...(data?.trend.flatMap(r=>[r.sales,r.collections])||[]));
  return <div className="workspace-page">
    <PageHeader eyebrow="Business intelligence" title="Reports & insights" description="Understand your sales, collections and the work behind them." actions={canExport&&data?<a className="btn-secondary" href={"/api/reports?"+query}><Icon name="download" size={16}/>Export CSV</a>:undefined}/>
    <form className="report-filters panel mb-5" onSubmit={e=>{e.preventDefault();void load("?"+new URLSearchParams({from,to}));}}>
      <div><h2 className="text-sm font-semibold">Reporting period</h2><p className="text-xs text-slate-500 mt-1">India time · INR · up to 366 days</p></div>
      <label className="field"><span className="field-label">From</span><input type="date" required value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label className="field"><span className="field-label">To</span><input type="date" required min={from} value={to} onChange={e=>setTo(e.target.value)}/></label>
      <button className="btn-primary" disabled={busy}>{busy?"Loading…":"Apply dates"}</button>
    </form>
    {error&&<div role="alert" className="form-error mb-5">{error} <button className="underline" onClick={()=>void load()}>Retry this month</button></div>}
    <div aria-busy={busy} className={busy?"opacity-60":""}>
    {data&&<>
      <div className="report-kpis mb-5"><StatCard label="Sales value" value={inrAmount(data.sales)} note={`${data.bookings} active bookings · ${data.visaCases} visa cases`} icon="plane"/><StatCard label="Net collections" value={inrAmount(data.netCollections)} note={`${inrAmount(data.collected)} receipts − ${inrAmount(data.returned)} paid refunds`} icon="wallet"/><StatCard label="Outstanding now" value={inrAmount(data.receivables.total)} note="All dates · bookings, visa and standalone invoices" icon="clock" tone="amber"/><StatCard label="Costed booking margin" value={inrAmount(data.margin)} note={`${data.uncosted} uncosted bookings excluded · before overheads`} icon="dashboard"/></div>
      <section className="panel p-5 mb-5"><div className="flex flex-wrap justify-between gap-3 mb-6"><div><h2 className="text-sm font-semibold">Sales & collections</h2><p className="text-xs text-slate-500 mt-1">Monthly totals for the selected period</p></div><div className="flex gap-4 text-xs"><span className="report-legend">Sales</span><span className="report-legend collections">Receipts</span></div></div>
      {data.sales===0&&data.collected===0?<EmptyState icon="dashboard" title="Your reporting starts with real work" description="Bookings, visa cases, invoices and receipts will build your business picture here."/>:<div className="report-chart">{data.trend.map(r=><div className="report-month" key={r.month}><div className="flex justify-between text-xs gap-2"><strong>{r.month}</strong><span>{inrAmount(r.sales)} sales · {inrAmount(r.collections)} receipts</span></div><div className="report-track"><div style={{width:`${r.sales/max*100}%`}}/></div><div className="report-track collections"><div style={{width:`${r.collections/max*100}%`}}/></div></div>)}</div>}</section>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4 mb-5"><Breakdown title="Booking pipeline" rows={data.pipeline}/><Breakdown title="Visa stages" rows={data.visaStages}/><Breakdown title="Collection methods" rows={data.modes} money/><Breakdown title="Task completion" rows={data.tasks}/></div>
      <section className="panel overflow-hidden"><div className="p-5 flex flex-wrap justify-between gap-3"><div><h2 className="text-sm font-semibold">Outstanding balances</h2><p className="text-xs text-slate-500 mt-1">Current snapshot · largest first · {data.outstandingCount} records{data.outstandingCount>100?" · showing top 100":""}</p></div><Link className="btn-secondary" href="/payments">Open money desk<Icon name="arrow" size={14}/></Link></div>{data.outstanding.length?<div className="overflow-x-auto"><table aria-label="Current outstanding balances in INR"><thead><tr><th scope="col">Reference</th><th scope="col">Customer</th><th scope="col">Service</th><th scope="col" className="text-right">Outstanding</th></tr></thead><tbody>{data.outstanding.map(r=><tr key={r.reference}><td><Link className="font-semibold text-blue-700 underline" href={r.href}>{r.reference}</Link></td><td>{r.customer}</td><td>{r.type}</td><td className="text-right font-semibold">{inrAmount(r.amount)}</td></tr>)}</tbody></table></div>:<p className="px-5 pb-5 text-sm text-slate-500">No outstanding balances in your accessible records.</p>}</section>
      <details className="report-definitions mt-5"><summary>How these figures are calculated</summary><p>Sales use booking date, visa creation date and standalone invoice issue date. Linked invoices are excluded to prevent double counting. Cancelled, void and refunded bookings are excluded. Sales include enquiries and quotes with a recorded selling price; they are not recognized accounting revenue. Collections use receipt date; paid refunds use payment date. Outstanding balances reflect all dates and are not an ageing report. Margin includes only INR bookings with a positive supplier cost and excludes visa work, overheads and refunds. {data.excludedCurrency>0?`${data.excludedCurrency} non-INR bookings excluded from sales, margin and outstanding totals.`:""} Visibility follows your finance role and record scope. Export includes summaries and breakdowns; open the money desk for individual balances.</p></details>
    </>}
    </div>
  </div>;
}
