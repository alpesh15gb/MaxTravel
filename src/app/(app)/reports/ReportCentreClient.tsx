"use client";
import { useEffect,useRef,useState } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";
import ReportsClient from "./ReportsClient";
import { PageHeader,EmptyState,Field } from "@/components/ui";
import { inrAmount } from "@/lib/money";
import type { AccountReport } from "@/lib/account-reports";

const reports=[
 {key:"statement",label:"Customer statement",hint:"Opening balance, every movement and closing balance."},
 {key:"ageing",label:"Outstanding & ageing",hint:"Open customer obligations and overdue amounts."},
 {key:"receipts",label:"Receipts & refunds",hint:"Dated customer money received and returned."},
 {key:"supplier-statement",label:"Supplier statement",hint:"Bills, settlements and running payable balance."},
 {key:"supplier-payables",label:"Supplier payables",hint:"Open supplier obligations and due dates."},
 {key:"refunds",label:"Refund exposure",hint:"Pending customer refunds and supplier milestones."},
 {key:"cancellations",label:"Cancellations",hint:"Cancelled in the period: retained charges, fees, refunds and customer balance."},
 {key:"sales",label:"Sales & margin",hint:"Confirmed booking value, quotes and cost coverage."},
 {key:"operations",label:"Work & travel",hint:"Visa work, ticketing deadlines, owners and travel dates."},
];
type Options={customers:{id:string;name:string;code:string}[];suppliers:{id:string;name:string}[];staff:{id:string;name:string}[];statuses:string[];cutover:string|null};
export default function ReportCentreClient({canExport,canSupplier,canRefund,canTerms,initialReport,initialCustomer}:{canExport:boolean;canSupplier:boolean;canRefund:boolean;canTerms:boolean;initialReport?:string;initialCustomer?:string}){
 const available=reports.filter(r=>(!r.key.startsWith("supplier")||canSupplier)&&(r.key!=="refunds"||canRefund));
 const [selected,setSelected]=useState(available.some(r=>r.key===initialReport)?initialReport!:"ageing");
 const [options,setOptions]=useState<Options|null>(null),[customerId,setCustomer]=useState(initialCustomer||""),[supplierId,setSupplier]=useState("");
 const [ownerId,setOwner]=useState(""),[status,setStatus]=useState("");
 const [from,setFrom]=useState(""),[to,setTo]=useState("");
 const [data,setData]=useState<AccountReport|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const [terms,setTerms]=useState(false);
 const [applied,setApplied]=useState("");const request=useRef<AbortController|null>(null);
 useEffect(()=>{const c=new AbortController();fetch("/api/reports/accounts?options=1",{signal:c.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||"Could not load report accounts.");setOptions(d);const today=new Date(Date.now()+330*60000).toISOString().slice(0,10);setTo(today);const cutoffDay=d.cutover?new Date(new Date(d.cutover).getTime()+330*60000).toISOString().slice(0,10):today;setFrom(cutoffDay>today.slice(0,7)+"-01"?cutoffDay:today.slice(0,7)+"-01");}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>{c.abort();request.current?.abort();};},[]);
 const workReport=["sales","operations","cancellations"].includes(selected);
 const supplier=selected.startsWith("supplier");const statement=["statement","supplier-statement"].includes(selected);
 function choose(key:string){request.current?.abort();setSelected(key);setData(null);setError("");setBusy(false);setApplied("");}
 async function load(page=1,query?:string){
  request.current?.abort();const c=new AbortController();request.current=c;setBusy(true);setError("");setData(null);
  const p=query?new URLSearchParams(query):new URLSearchParams({report:selected,from,to,...(customerId&&!supplier?{customerId}:{}),...(supplierId&&supplier?{supplierId}:{}),...(workReport&&ownerId?{ownerId}:{}),...(workReport&&status?{status}:{})});p.set("page",String(page));
  try{const r=await fetch("/api/reports/accounts?"+p,{signal:c.signal});const d=await r.json();if(!r.ok)throw new Error(d.error||"Could not load report.");setData(d);p.delete("page");setApplied(p.toString());}catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:"Could not load report.");}finally{if(!c.signal.aborted)setBusy(false);}
 }
 const editableTermsRows=data?.rows.filter(row=>row._termsEditable===1)||[];
 const appliedCustomer=new URLSearchParams(applied).get("customerId");
 const chosen=available.find(r=>r.key===selected);
 return <div className="workspace-page">
  <nav aria-label="Report catalogue" className="mb-5 flex flex-wrap gap-2">{available.map(r=><button key={r.key} type="button" aria-pressed={selected===r.key} className={selected===r.key?"btn-secondary border-brand-700 bg-brand-50 font-semibold text-brand-700":"btn-secondary"} onClick={()=>choose(r.key)}>{r.label}</button>)}<button className={selected==="overview"?"btn-secondary border-brand-700 bg-brand-50 font-semibold text-brand-700":"btn-secondary"} aria-pressed={selected==="overview"} onClick={()=>choose("overview")}>Business overview</button></nav>
  {selected==="overview"?<ReportsClient canExport={canExport}/>:<>
   <PageHeader title={chosen?.label||"Reports"} description={chosen?.hint||"Financial reports"}/>
   <form className="panel mb-5 p-5 space-y-4" onSubmit={e=>{e.preventDefault();void load();}}>
    <div className="form-grid">
     {!supplier?<Field label={statement?"Customer *":"Customer"}><select required={statement} value={customerId} onChange={e=>setCustomer(e.target.value)}><option value="">{statement?"Choose customer":"All permitted customers"}</option>{options?.customers.map(c=><option key={c.id} value={c.id}>{c.name} · {c.code}</option>)}</select></Field>:selected==="supplier-statement"?<Field label="Supplier *"><select required value={supplierId} onChange={e=>setSupplier(e.target.value)}><option value="">Choose supplier</option>{options?.suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>:null}
     {workReport&&<><Field label="Staff / owner"><select value={ownerId} onChange={e=>setOwner(e.target.value)}><option value="">All permitted staff</option>{options?.staff.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field><Field label="Current status / stage"><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{options?.statuses.map(s=><option key={s} value={s}>{s}</option>)}</select></Field></>}
     <Field label={selected.includes("ageing")||selected==="supplier-payables"?"From (not used for balance cutoff)":"From"}><input type="date" required value={from} onChange={e=>setFrom(e.target.value)}/></Field>
     <Field label={selected==="ageing"||selected==="supplier-payables"?"Balance as of":"Through"}><input type="date" required min={from} value={to} onChange={e=>setTo(e.target.value)}/></Field>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">India calendar · INR · maximum 366 days{selected==="cancellations"?" · Filtered by cancellation date, not booking date":""}{options?.cutover?` · Preserved balances from ${new Date(new Date(options.cutover).getTime()+330*60000).toISOString().slice(0,10)}`:""}</p><button className="btn-primary" disabled={busy||!options}>{busy?"Generating…":"Generate report"}</button></div>
   </form>
   {error&&<p role="alert" className="form-error mb-5">{error}</p>}
   {busy&&<p role="status" className="panel p-5">Loading report…</p>}
   {!data&&!busy&&!error&&<EmptyState icon="dashboard" title="Choose your report filters" description="Generate a report to inspect transactions, balances and export options."/>}
   {data&&<div aria-live="polite">
    <div className="mb-5 flex flex-wrap justify-between items-start gap-3"><div><h2 className="text-lg font-semibold">{data.party?.name||data.title}</h2><p className="text-sm text-slate-500 mt-1">{data.description}</p><p className="text-xs text-slate-500 mt-1">{data.period.from}–{data.period.to} · {data.totalRows} movements / records</p></div>{selected==="ageing"&&canTerms&&editableTermsRows.length>0&&<button className="btn-secondary" onClick={()=>setTerms(true)}>Set payment terms</button>}{canExport&&<div className="flex flex-wrap gap-2">{["csv","xlsx",...(statement?["pdf"]:[])].map(format=><a key={format} className="btn-secondary" href={`/api/reports/accounts?${applied}&format=${format}`}>Download {format.toUpperCase()}</a>)}</div>}</div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 mb-5">{data.summary.map(s=><section className="panel p-4" key={s.label}><h3 className="text-xs text-slate-500">{s.label}</h3><p className="mt-2 text-xl font-semibold">{s.money?inrAmount(s.value):s.value}</p></section>)}</div>
    <section className="panel overflow-hidden"><div className="overflow-x-auto"><table aria-label={data.title}><thead><tr>{data.columns.map(c=><th key={c.key} scope="col" className={c.money?"text-right":""}>{c.label}</th>)}</tr></thead><tbody>{data.rows.map((row,i)=><tr key={`${data.page}-${i}`}>{data.columns.map(c=><td key={c.key} className={c.money?"text-right tabular-nums":""}>{row[c.key]===null?"Not recorded":c.money?inrAmount(Number(row[c.key])):(c.key==="reference"&&row._href?<Link className="text-blue-700 underline" href={String(row._href)}>{String(row[c.key]??"—")}</Link>:c.key==="customer"&&row._customerHref?<a className="text-blue-700 underline" href={String(row._customerHref)}>{String(row[c.key]??"—")}</a>:String(row[c.key]??"—"))}</td>)}</tr>)}</tbody></table></div>{!data.rows.length&&<p className="p-5 text-sm text-slate-500">No movements in this period.{statement?" The opening balance is carried forward.":""}</p>}<div className="p-4 flex flex-wrap items-center justify-between gap-3 border-t"><p className="text-xs text-slate-500">Page {data.page} of {data.pages} · 50 rows per page · exports include all matching rows</p><div className="flex gap-2"><button type="button" className="btn-secondary" disabled={data.page<=1} onClick={()=>void load(data.page-1,applied)}>Previous</button><button type="button" className="btn-secondary" disabled={data.page>=data.pages} onClick={()=>void load(data.page+1,applied)}>Next</button></div></div></section>
    <details className="panel mt-5 p-5"><summary className="cursor-pointer text-sm font-semibold">Report definitions and coverage</summary><ul className="mt-3 space-y-2 text-xs leading-6 text-slate-500">{data.warnings.map(w=><li key={w}>{w}</li>)}</ul><p className="mt-3 text-xs text-slate-500">Generated {new Date(data.generatedAt).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})} IST</p></details>
    {appliedCustomer&&!supplier&&<Link className="btn-secondary mt-4" href={`/customers/${appliedCustomer}`}>Open customer workspace</Link>}
   </div>}
   {terms&&data&&editableTermsRows.length>0&&<PaymentTerms rows={editableTermsRows} onClose={()=>setTerms(false)} onSaved={()=>{setTerms(false);void load(1,applied);}}/>}
  </>}
 </div>;
}

function PaymentTerms({rows,onClose,onSaved}:{rows:AccountReport["rows"];onClose:()=>void;onSaved:()=>void}){
 const [selected,setSelected]=useState("0"),[dueDate,setDue]=useState(/^\d{4}-\d{2}-\d{2}$/.test(String(rows[0]?.due))?String(rows[0].due):""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");const row=rows[Number(selected)];try{const r=await fetch("/api/reports/terms",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:row._type,id:row._id,dueDate:dueDate||null})});const d=await r.json();if(!r.ok)throw new Error(d.error||"Could not save terms.");onSaved();}catch(e){setError(e instanceof Error?e.message:"Connection failed.");}finally{setBusy(false);}}
 return <Modal label="Payment terms" onClose={onClose} busy={busy}><form className="space-y-5" onSubmit={save}><h2 className="text-xl font-semibold">Set payment terms</h2><p className="text-sm text-slate-500">Choose an editable obligation from this report page. Platform-managed booking terms are excluded. The date applies from this change onward; past ageing stays preserved. Leave the date empty to clear it.</p><Field label="Obligation"><select value={selected} onChange={e=>{setSelected(e.target.value);const due=String(rows[Number(e.target.value)]?.due);setDue(/^\d{4}-\d{2}-\d{2}$/.test(due)?due:"");}}>{rows.map((r,i)=><option key={String(r._id)} value={String(i)}>{r.customer} · {r.reference} · {r.due}</option>)}</select></Field><Field label="Payment due date"><input type="date" value={dueDate} onChange={e=>setDue(e.target.value)}/></Field>{error&&<p role="alert" className="form-error">{error}</p>}<div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy?"Saving…":"Save payment terms"}</button></div></form></Modal>;
}
