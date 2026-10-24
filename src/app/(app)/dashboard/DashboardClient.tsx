"use client";
import { enumLabel } from "@/lib/labels";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Icon, { type IconName } from "@/components/Icon";
import { EmptyState, PageHeader, StatCard, Status, ViewToggle } from "@/components/ui";
import { clockLabel } from "@/lib/dates";

interface Action { label:string; api?:string; method?:string; body?:Record<string,unknown>; href?:string }
interface Item { id:string;kind:string;severity:string;title:string;detail:string;href:string;actions:Action[];at?:string }
interface Resp { items:Item[];counts:{urgent:number;high:number;medium:number};generatedAt:string;kpis:{label:string;value:string;href:string;tone:string;icon:IconName;note:string}[];quickActions:{label:string;description:string;href:string;icon:IconName}[];firstRun:boolean;name:string }
type Filter = "ALL" | "URGENT" | "HIGH" | "MEDIUM";
type Workstream = "all" | "sales" | "travel" | "documents" | "money" | "followups";
const WORKSTREAMS: { value: Workstream; label: string; icon: IconName }[] = [
  { value: "all", label: "All work", icon: "dashboard" },
  { value: "sales", label: "Sales follow-ups", icon: "customers" },
  { value: "travel", label: "Travel & appointments", icon: "plane" },
  { value: "documents", label: "Documents to resolve", icon: "documents" },
  { value: "money", label: "Payments & refunds", icon: "wallet" },
  { value: "followups", label: "Tasks & conversations", icon: "tasks" },
];
function workstream(item: Item): Workstream {
  if (/SALES/.test(item.kind)) return "sales";
  if (/PAYMENT|REFUND|SUPPLIER|INVOICE/.test(item.kind)) return "money";
  if (/DOC|PASSPORT/.test(item.kind)) return "documents";
  if (/TASK|WHATSAPP|MESSAGE/.test(item.kind)) return "followups";
  return "travel";
}

export default function DashboardClient({todayLabel}:{todayLabel:string}){return <Suspense fallback={<div className="workspace-page">Loading your workspace…</div>}><Dashboard todayLabel={todayLabel}/></Suspense>;}

function Dashboard({todayLabel}:{todayLabel:string}){
  const sp=useSearchParams();const [data,setData]=useState<Resp|null>(null);const [error,setError]=useState("");const [filter,setFilter]=useState<Filter>("ALL");const [busy,setBusy]=useState("");const [notice,setNotice]=useState("");const [noticeFailed,setNoticeFailed]=useState(false);const [stream,setStream]=useState<Workstream>("all");const [refreshing,setRefreshing]=useState(false);
  const mutationLock=useRef(false);const loadingLock=useRef(false);const uncertainRef=useRef(false);const [uncertain,setUncertain]=useState(false);
  const load=useCallback(async(internal=false)=>{if(loadingLock.current||(mutationLock.current&&!internal))return;loadingLock.current=true;setError("");setRefreshing(true);try{const r=await fetch("/api/pulse");if(!r.ok)throw new Error();setData(await r.json());uncertainRef.current=false;setUncertain(false);}catch{setError("Could not load Today. Please refresh to try again.");}finally{loadingLock.current=false;setRefreshing(false);}},[]);
  useEffect(()=>{void load();},[load]);
  async function act(item:Item,a:Action){if(a.href){location.assign(a.href);return;}if(!a.api||mutationLock.current||loadingLock.current||uncertainRef.current)return;mutationLock.current=true;setBusy(item.id+a.label);setNotice("");setNoticeFailed(false);try{const r=await fetch(a.api,{method:a.method??"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(a.body??{})});const d=await r.json();if(!r.ok){uncertainRef.current=true;setUncertain(true);setNotice(d.error??"The action could not be confirmed. Refresh and check the record before trying again.");setNoticeFailed(true);return;}if(d.whatsappUrl){setNotice("Message logged. Open WhatsApp from the message desk to send it.");}else if(d.url){setNotice(`Upload link created: ${d.url}`);}else setNotice(`${a.label} completed.`);uncertainRef.current=true;setUncertain(true);await load(true);}catch{uncertainRef.current=true;setUncertain(true);setNotice("The response was interrupted. The action may have completed — refresh and check the record before trying again.");setNoticeFailed(true);}finally{mutationLock.current=false;setBusy("");}}
  const items=data?.items.filter(i=>(filter==="ALL"||i.severity===filter)&&(stream==="all"||workstream(i)===stream))??[];
  // Real counts in parentheses, and an empty bucket is not offered: "Urgent · 0" read as one broken
  // label, and clicking it could only ever show an empty list. "All" is always there, so a filter
  // that emptied while you watched still has somewhere to land.
  //
  // The no-data case is deliberately separate rather than folded into the test above. Reading
  // data?.counts.urgent as "unknown" let it pass that empty-bucket test and then print itself, so
  // a pulse that failed to load rendered "Urgent (undefined)" chips — at exactly the moment the
  // numbers are least knowable. With no data there is nothing to choose between, so only "All" is
  // offered, matching the "–" beside the heading above it.
  const filterOptions: {value:Filter;label:string}[]=data
    ?[{value:"ALL",label:`All (${data.items.length})`},
      ...([["URGENT",data.counts.urgent],["HIGH",data.counts.high],["MEDIUM",data.counts.medium]] as [Filter,number][])
        .filter(([,n])=>n>0)
        .map(([value,n])=>({value,label:`${value[0]}${value.slice(1).toLowerCase()} (${n})`}))]
    :[{value:"ALL",label:"All (–)"}];
  const primaryItemId = items.find(item => item.actions.length > 0)?.id;
  const firstRunAction = data?.firstRun && items.length === 0 ? data.quickActions[0] : undefined;
  return <div className="workspace-page studio-dashboard">
    <div className="studio-dashboard-heading today-heading"><div><p className="studio-welcome">{data ? `Welcome back, ${data.name.split(" ")[0]}.` : "Your agency workspace"}</p>
      <PageHeader title="Today" description="See what needs a decision. Pick up where your team left off." />
    </div><div className="today-context"><span className="workspace-date"><Icon name="calendar" size={16}/>{todayLabel}</span><span className="studio-scope-note"><Icon name="shield" size={13}/>Your accessible records</span></div></div>
    {sp.get("denied")&&<div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Your role does not allow this action. Ask your agency owner if you need access.</div>}
    {error&&<div className="form-error mb-5 flex items-center justify-between gap-3" role="alert">{error}<button className="btn-secondary" onClick={()=>void load()}>Retry</button></div>}

    <div className="daily-workspace today-workspace">
      <section id="attention" className="panel min-w-0 overflow-hidden" aria-label="Attention queue" aria-busy={refreshing}>
        <div className="attention-heading">
          <div><h2>{stream==="all"?"Needs your attention":WORKSTREAMS.find(w=>w.value===stream)?.label} <span className="attention-total">{data?items.length:"–"}</span></h2><p>Open a record to resolve the next step.</p></div>
          <button className={primaryItemId || firstRunAction ? "btn-secondary" : "btn-primary"} aria-label="Refresh" disabled={refreshing||!!busy} onClick={()=>void load()}><Icon name="refresh" size={14}/><span className="attention-refresh-label">{refreshing?"Refreshing…":"Refresh"}</span></button>
        </div>
        <div className="queue-filter-bar"><label className="today-work-area"><span className="field-label">Work area</span><select className="control" value={stream} onChange={e=>{setStream(e.target.value as Workstream);setFilter("ALL");}}>{WORKSTREAMS.map(w=><option key={w.value} value={w.value}>{w.label}</option>)}</select></label><ViewToggle label="Priority filter" value={filter} onChange={setFilter} options={filterOptions}/></div>
        {/* A failed action must not wear the green success banner: it read as confirmation. */}
        {notice&&(noticeFailed?<div role="alert" className="form-error mb-4 break-words">{notice}</div>:<div role="status" className="form-success mb-4 break-words">{notice}</div>)}
        {uncertain&&<p className="today-reconcile" role="status">New writes are paused. Refresh to reconcile the latest records before repeating an action.</p>}
        {!data&&!error&&<div role="status" className="p-6 text-sm text-slate-600">Loading deadlines and follow-ups…</div>}
        {data&&items.length===0&&<EmptyState icon="check" title={data.firstRun?"No follow-ups yet":"No items in this view"} description={data.firstRun?"There are no transactions yet. Add real customers and work records; deadlines and follow-ups will appear here automatically.":"No matching exceptions were found in your accessible records. Refresh as your operations change."}/>}
        {firstRunAction&&<div className="px-6 pb-6"><Link className="btn-primary" href={firstRunAction.href}>{firstRunAction.label}<Icon name="arrow" size={14}/></Link></div>}
        {items.length>0&&<div className="divide-y divide-slate-100">{items.map(i=><article key={i.id} className={`attention-row attention-${i.severity.toLowerCase()}`}><div className="attention-record-icon" aria-hidden="true"><Icon name={WORKSTREAMS.find(w => w.value === workstream(i))?.icon ?? "tasks"} size={20}/></div>
          <div className="attention-record-content min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2"><Status tone={i.severity==="URGENT"?"danger":i.severity==="HIGH"?"warning":"info"}>{enumLabel(i.severity)}</Status><span className="text-small text-slate-500">{enumLabel(i.kind)}</span></div>
            <Link href={i.href} className="block text-sm font-semibold text-slate-900 hover:text-teal-700">{i.title}</Link>
            <p className="mt-1 text-xs leading-5 text-slate-500">{i.detail}</p>
          </div>
          {i.actions.length>0&&<div className="attention-actions flex flex-col items-start gap-1.5 md:items-end"><button onClick={()=>act(i,i.actions[0])} disabled={!!busy||(!i.actions[0].href&&(uncertain||refreshing))} className={i.id===primaryItemId?"btn-primary":"btn-secondary"}>{busy===i.id+i.actions[0].label?"Working…":i.actions[0].label}<Icon name="arrow" size={14}/></button>{i.actions.length>1&&<details className="max-w-full text-xs text-slate-500"><summary className="cursor-pointer py-1">More actions</summary><div className="mt-1 flex flex-wrap gap-2">{i.actions.slice(1).map(a=><button key={a.label} onClick={()=>act(i,a)} disabled={!!busy||(!a.href&&(uncertain||refreshing))} className="btn-secondary">{busy===i.id+a.label?"Working…":a.label}</button>)}</div></details>}</div>}
        </article>)}</div>}
        {data&&<p className="attention-updated">Updated {clockLabel(new Date(data.generatedAt))} · Visibility follows your role and record access.</p>}
      </section>
      <aside className="daily-workspace-tools today-brief" aria-label="Agency overview">
        {(!data||data.kpis.length>0)&&<section className="today-summary panel" aria-label="Agency summary"><div className="studio-section-heading"><span className="studio-section-icon"><Icon name="dashboard" size={18}/></span><div><h2>At a glance</h2><p>Current CRM records</p></div></div><div className="dashboard-kpi-strip">{data?data.kpis.map(k=><div key={k.label} className={`dashboard-kpi ${k.href==="/payments"?"dashboard-kpi-financial":""}`}><Link href={k.href}><StatCard label={k.label} value={k.value} note={k.href==="/payments"?undefined:k.note} icon={k.icon} tone={k.tone==="danger"?"rose":k.tone==="warn"?"amber":"neutral"}/></Link>{k.href==="/payments"&&k.note&&<details className="kpi-mobile-breakdown"><summary>Receivables breakdown</summary><p>{k.note}</p></details>}</div>):<p role="status" className="p-5">Loading record summary…</p>}</div></section>}
        {data&&data.quickActions.length>0&&<section className="panel studio-shortcuts-panel"><div className="studio-section-heading"><span className="studio-section-icon"><Icon name="plus" size={18}/></span><div><h2>Start new work</h2><p>When you’re ready</p></div></div><div className="grid gap-2">{data.quickActions.map(a=><Link key={a.href} href={a.href} className="workspace-shortcut"><Icon name={a.icon} size={18}/><span><strong>{a.label}</strong><span>{a.description}</span></span><Icon name="arrow" size={15}/></Link>)}</div></section>}
      </aside>
    </div>
  </div>;
}
