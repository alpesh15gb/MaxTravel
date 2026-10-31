"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Icon from "./Icon";
import { EmptyState, PageHeader, Status, ViewToggle } from "./ui";
import NewCase from "@/app/(app)/cases/NewCase";
import { enumLabel } from "@/lib/labels";
import { clockLabel } from "@/lib/dates";
import { findSection, type SectionId } from "@/lib/workspace-sections";
import type { WorkspaceOverview } from "@/lib/workspace-overview";
import type { PulseItem } from "@/lib/pulse";

export default function WorkspaceDashboard({ sectionId = "today", todayLabel }: { sectionId?: SectionId; todayLabel: string }) {
  return <Suspense fallback={<div className="workspace-page" role="status">Loading your workspace…</div>}><Overview sectionId={sectionId} todayLabel={todayLabel}/></Suspense>;
}

function Overview({ sectionId, todayLabel }: { sectionId: SectionId; todayLabel: string }) {
  const router = useRouter(), params = useSearchParams();
  const [record, setRecord] = useState<{ section: SectionId; data: WorkspaceOverview } | null>(null);
  const [error, setError] = useState(""), [refreshing, setRefreshing] = useState(false), [shown, setShown] = useState(8);
  const request = useRef<AbortController | null>(null);
  const data = record?.section === sectionId ? record.data : null;
  const definition = findSection(sectionId)!;
  const daily = sectionId === "today", view = params.get("view");
  const priority = ["URGENT", "HIGH", "MEDIUM"].includes(params.get("priority") ?? "") ? params.get("priority")! : "ALL";
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setRefreshing(true); setError("");
    try {
      const response = await fetch(`/api/pulse?section=${sectionId}`, { signal: controller.signal });
      if (!response.ok) {
        if (!controller.signal.aborted && (response.status===401||response.status===403)) setRecord(null);
        throw Error(response.status === 403 ? "Your role does not allow this section." : "Could not load this workspace. Please try again.");
      }
      const next: WorkspaceOverview = await response.json();
      if (!controller.signal.aborted) setRecord({ section: sectionId, data: next });
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load this workspace."); }
    finally { if (!controller.signal.aborted) setRefreshing(false); }
  }, [sectionId]);
  useEffect(() => { void load(); return () => request.current?.abort(); }, [load]);

  const title = daily ? data ? data.mode === "agency" ? "Agency overview" : "My work" : "Today" : definition.title;
  const description = daily ? "Your priorities and follow-ups for today. Open a section for the detailed work." : definition.description;
  const fullQueue = !daily || view === "all" || view === "followups";
  const source = daily && view === "followups" ? data?.followups ?? [] : data?.items ?? [];
  const filtered = source.filter(item => priority === "ALL" || item.severity === priority);
  const decisions = (data?.items ?? []).filter(item => item.severity === "URGENT" || (item.severity === "HIGH" && !/^(TASK_|CASE_FOLLOWUP|SALES_FOLLOW_UP|LIST_CAPPED)/.test(item.kind)));
  const primary = data?.actions[0];
  const fallback = daily ? data?.sections.find(s=>s.id!=="today") : data?.links[0];
  const fallbackLabel = fallback ? "label" in fallback ? fallback.label : fallback.title : "";
  function changePriority(value: string) {
    setShown(8);
    const next = new URLSearchParams(params.toString());
    if (value === "ALL") next.delete("priority"); else next.set("priority", value);
    router.replace(`${definition.href}?${next.toString()}`, { scroll: false });
  }
  return <div className="workspace-page section-workspace" data-section={sectionId}>
    <div className="section-page-top"><PageHeader eyebrow={daily ? `${todayLabel} · ${data?.scope ?? "Your workspace"}` : "Agency workspace"} title={title} description={description} actions={data && <>
      {data.caseServices.length > 0 ? <NewCase services={data.caseServices} canAddCustomer={data.canAddCustomer} triggerLabel="New case"/> : primary ? <Link className="btn-primary" href={primary.href}>{primary.title}<Icon name="arrow" size={15}/></Link> : fallback ? <Link className="btn-primary" href={fallback.href}>Open {fallbackLabel.toLowerCase()}<Icon name="arrow" size={15}/></Link> : null}
    </>}/></div>
    {params.get("denied") && <p role="alert" className="form-error mb-5">Your role does not allow that action. Choose one of your available sections.</p>}
    {error && <div role="alert" className="form-error mb-5">{error} <button className="btn-secondary" onClick={()=>void load()}>Retry</button></div>}
    {!data && !error && <div className="panel p-6" role="status">Loading your permitted records…</div>}
    {data && <>
      <div className="section-overview-toolbar"><p><Icon name="shield" size={15}/>{data.scope}<span>· Updated {clockLabel(data.generatedAt)}</span></p><button className="btn-secondary" aria-label="Refresh workspace" disabled={refreshing} onClick={()=>void load()}><Icon name="refresh" size={15}/>{refreshing?"Refreshing…":"Refresh"}</button></div>
      {data.stats.length > 0 && <section className="workspace-stat-grid" aria-label="Workspace summary">{data.stats.map(stat=><Link href={stat.href} className="workspace-stat" key={stat.label}><span><Icon name={stat.icon} size={18}/>{stat.label}</span><strong>{stat.value}</strong><small>{stat.note}</small></Link>)}</section>}
      {data.items.some(item=>item.kind.startsWith("LIST_CAPPED"))&&<p className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm" role="status">Some attention lists show up to 50 records. Open the relevant workspace for the complete list. The daily queue is a working shortlist; use the module for complete records.</p>}
      {!daily && <section className="section-modules" aria-label={`${definition.title} tools`}><div className="section-block-heading"><h2>Open a workspace</h2><span>{data.links.length} available tools</span></div><div className="section-module-grid">{data.links.map(link=><Link className="section-module" href={link.href} key={link.href}><span className="section-module-icon"><Icon name={link.icon} size={22}/></span><div><h3>{link.label}</h3><p>{link.description}</p></div><Icon name="arrow" size={17}/></Link>)}</div>
        {data.actions.length>0&&<div className="section-action-links" aria-label="Section actions">{data.actions.map(action=><Link key={action.id} href={action.href}><Icon name="plus" size={15}/>{action.title}</Link>)}</div>}
      </section>}
      {daily && !fullQueue ? <div className="daily-section-queues">
        <section className="panel" aria-label="Urgent decisions"><div className="section-block-heading"><div><h2>Needs a decision</h2><p>Start with the most important records.</p></div><Link href="/dashboard?view=all">View all priorities<Icon name="arrow" size={15}/></Link></div><AttentionList items={decisions.slice(0,5)} empty="No urgent decisions waiting" description="Your important operational and financial decisions will appear here."/></section>
        <section className="panel" aria-label="Today's follow-ups"><div className="section-block-heading"><div><h2>Today’s follow-ups</h2><p>Due today and overdue, across your permitted work.</p></div><Link href="/dashboard?view=followups">View all follow-ups<Icon name="arrow" size={15}/></Link></div><AttentionList items={data.followups.slice(0,5)} empty="No follow-ups due" description="Scheduled case, enquiry and task follow-ups appear here when due."/></section>
      </div> : sectionId !== "administration" && <section className="panel section-attention" aria-label="Attention queue" aria-busy={refreshing}><div className="section-block-heading"><div><h2>{daily ? view==="followups"?"All due follow-ups":"All priorities" : "Needs your attention"}</h2><p>{filtered.length} items in the current queue. Open the linked module for its full list.</p></div>{daily&&<Link href="/dashboard">Back to overview</Link>}</div><div className="section-priority-filter"><ViewToggle label="Priority filter" value={priority} onChange={changePriority} options={[{value:"ALL",label:`All (${source.length})`},...(["URGENT","HIGH","MEDIUM"] as const).filter(value=>value===priority||source.some(i=>i.severity===value)).map(value=>({value,label:`${enumLabel(value)} (${source.filter(i=>i.severity===value).length})`}))]}/></div><AttentionList items={filtered.slice(0,shown)} empty="No items in this view" description="Refresh as your operations change. Your role and record assignments determine what appears."/>{filtered.length>shown&&<div className="section-show-more"><button className="btn-secondary" onClick={()=>setShown(n=>n+10)}>Show more items ({filtered.length-shown} remaining)</button></div>}</section>}
      {daily && <section className="section-directory" aria-label="Your sections"><div className="section-block-heading"><div><h2>Work by section</h2><p>Choose the workspace for the transaction you need.</p></div><Link href="/work">Find a workflow<Icon name="arrow" size={15}/></Link></div><div className="section-directory-grid">{data.sections.filter(s=>s.id!=="today").map(section=><Link href={section.href} key={section.id}><Icon name={section.icon} size={20}/><span><strong>{section.title}</strong><small>{section.description}</small></span><Icon name="arrow" size={16}/></Link>)}</div></section>}
    </>}
  </div>;
}

function AttentionList({items,empty,description}:{items:PulseItem[];empty:string;description:string}) {
  if (!items.length) return <EmptyState icon="check" title={empty} description={description}/>;
  return <div className="section-attention-list">{items.map(item=><article key={item.id} className="section-attention-row"><div><div className="section-record-label"><Status tone={item.severity==="URGENT"?"danger":item.severity==="HIGH"?"warning":"info"}>{enumLabel(item.severity)}</Status><span>{enumLabel(item.kind)}</span></div><Link href={item.href} className="section-record-title">{item.title}</Link><p>{item.detail}</p></div><Link className="btn-secondary" href={item.href}>{item.actions.find(action=>action.href)?.label??"Open record"}<Icon name="arrow" size={14}/></Link></article>)}</div>;
}
