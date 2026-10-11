"use client";
import { enumLabel } from "@/lib/labels";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Icon, { type IconName } from "@/components/Icon";
import { EmptyState, PageHeader, StatCard, Status, ViewToggle } from "@/components/ui";
import { clockLabel } from "@/lib/dates";

interface Action { label:string; api?:string; method?:string; body?:Record<string,unknown>; href?:string }
interface Item { id:string;kind:string;severity:string;title:string;detail:string;href:string;actions:Action[];at?:string }
interface Resp { items:Item[];counts:{urgent:number;high:number;medium:number};generatedAt:string;kpis:{label:string;value:string;href:string;tone:string;icon:IconName;note:string}[];quickActions:{label:string;description:string;href:string;icon:IconName}[];firstRun:boolean;name:string }
type Filter = "ALL" | "URGENT" | "HIGH" | "MEDIUM";

export default function DashboardClient({todayLabel}:{todayLabel:string}){return <Suspense fallback={<div className="workspace-page">Loading your workspace…</div>}><Dashboard todayLabel={todayLabel}/></Suspense>;}

function Dashboard({todayLabel}:{todayLabel:string}){
  const sp=useSearchParams();const [data,setData]=useState<Resp|null>(null);const [error,setError]=useState("");const [filter,setFilter]=useState<Filter>("ALL");const [busy,setBusy]=useState("");const [notice,setNotice]=useState("");const [noticeFailed,setNoticeFailed]=useState(false);
  const load=useCallback(async()=>{setError("");try{const r=await fetch("/api/pulse");if(!r.ok)throw new Error();setData(await r.json());}catch{setError("Could not load your agency pulse. Please refresh to try again.");}},[]);
  useEffect(()=>{void load();},[load]);
  async function act(item:Item,a:Action){if(a.href){location.assign(a.href);return;}if(!a.api)return;setBusy(item.id+a.label);setNotice("");setNoticeFailed(false);try{const r=await fetch(a.api,{method:a.method??"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(a.body??{})});const d=await r.json().catch(()=>({}));if(!r.ok){setNotice(d.error??"That action could not be completed. Nothing was changed.");setNoticeFailed(true);return;}if(d.whatsappUrl){setNotice("Message logged. Open WhatsApp from the message desk to send it.");}else if(d.url){setNotice(`Upload link created: ${d.url}`);}else setNotice(`${a.label} completed.`);await load();}catch{setNotice("Connection failed. Nothing was changed — please try again.");setNoticeFailed(true);}finally{setBusy("");}}
  const items=data?.items.filter(i=>filter==="ALL"||i.severity===filter)??[];
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
  return <div className="workspace-page">
    <PageHeader title="Agency pulse" description="The exceptions, deadlines and follow-ups that need a decision today." actions={<div className="page-actions"><span className="flex items-center gap-2 text-small text-slate-600"><Icon name="calendar" size={15}/>{todayLabel}</span>{data?.quickActions.map((a,i)=><Link key={a.href} href={a.href} className={i===0?"btn-primary":"btn-secondary"} title={a.description}><Icon name={a.icon} size={16}/>{a.label}</Link>)}</div>}/>
    {sp.get("denied")&&<div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Your role does not allow this action. Ask your agency owner if you need access.</div>}
    {error&&<div className="form-error mb-5 flex items-center justify-between gap-3" role="alert">{error}<button className="btn-secondary" onClick={load}>Retry</button></div>}

    {/* A role with no module permissions has no KPIs at all, and an empty bordered band is worse
        than nothing — so the strip is only rendered when it has something to say. */}
    {(!data||data.kpis.length>0)&&<div className="summary-strip" aria-label="Agency summary">{data?data.kpis.map((k)=><Link key={k.label} href={k.href}><StatCard label={k.label} value={k.value} note={k.note} icon={k.icon} tone={k.tone==="danger"?"rose":k.tone==="warn"?"amber":"neutral"}/></Link>):[0,1,2].map(i=><div key={i} className="h-24 animate-pulse bg-slate-100"/>)}</div>}

    <div className="grid items-start gap-4">
      <section id="attention" className="panel min-w-0 overflow-hidden" aria-label="Attention queue">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div><h2 className="text-sm font-semibold">Needs your attention <span className="ml-1 text-xs font-normal text-slate-500">{data?.items.length ?? "–"}</span></h2><p className="mt-0.5 text-small text-slate-500">Prioritized work with a clear next step.</p></div>
          <button className="btn-secondary" aria-label="Refresh" onClick={load}><Icon name="refresh" size={14}/>Refresh</button>
        </div>
        <div className="overflow-x-auto border-b border-slate-100 px-4 py-2"><ViewToggle label="Priority filter" value={filter} onChange={setFilter} options={filterOptions}/></div>
        {/* A failed action must not wear the green success banner: it read as confirmation. */}
        {notice&&(noticeFailed?<div role="alert" className="form-error mb-4 break-words">{notice}</div>:<div role="status" className="form-success mb-4 break-words">{notice}</div>)}
        {data&&items.length===0&&<EmptyState icon="check" title={data.firstRun?"No follow-ups yet":"No items in this view"} description={data.firstRun?"There are no transactions yet. Add real customers and work records; deadlines and follow-ups will appear here automatically.":"No matching exceptions were found in your accessible records. Refresh as your operations change."}/>}
        {items.length>0&&<div className="divide-y divide-slate-100">{items.map(i=><article key={i.id} className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2"><Status tone={i.severity==="URGENT"?"danger":i.severity==="HIGH"?"warning":"info"}>{enumLabel(i.severity)}</Status><span className="text-small text-slate-500">{enumLabel(i.kind)}</span></div>
            <Link href={i.href} className="block text-sm font-semibold text-slate-900 hover:text-teal-700">{i.title}</Link>
            <p className="mt-1 text-xs leading-5 text-slate-500">{i.detail}</p>
          </div>
          {i.actions.length>0&&<div className="flex flex-col items-start gap-1.5 md:items-end"><button onClick={()=>act(i,i.actions[0])} disabled={!!busy} className="btn-secondary">{busy===i.id+i.actions[0].label?"Working…":i.actions[0].label}<Icon name="arrow" size={14}/></button>{i.actions.length>1&&<details className="max-w-full text-xs text-slate-500"><summary className="cursor-pointer py-1">More actions</summary><div className="mt-1 flex flex-wrap gap-2">{i.actions.slice(1).map(a=><button key={a.label} onClick={()=>act(i,a)} disabled={!!busy} className="btn-secondary">{busy===i.id+a.label?"Working…":a.label}</button>)}</div></details>}</div>}
        </article>)}</div>}
        {data&&<p className="border-t border-slate-100 px-4 py-2 text-small text-slate-500">Updated {clockLabel(new Date(data.generatedAt))} · Visibility follows your role and record access.</p>}
      </section>

    </div>
  </div>;
}
