"use client";
import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { EmptyState, PageHeader, SearchInput } from "@/components/ui";
import { availableWorkActions } from "@/lib/workspace-guide";
const GROUPS = ["All workflows","Customers & sales","Travel operations","Money & accounts"] as const;
export default function StartWork({permissions}:{permissions:string[]}) {
  const [query,setQuery]=useState("");
  const [group,setGroup]=useState<string>("All workflows");
  const actions=availableWorkActions(permissions);
  const visible=actions.filter(action=>(group==="All workflows"||action.group===group)&&`${action.title} ${action.description} ${action.group}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="workspace-page start-work-page">
    <PageHeader eyebrow="Your transaction desk" title="What do you need to do?" description="Choose the work. We'll take you to the right place to complete it." actions={<Link className="btn-secondary" href="/dashboard">Back to Today</Link>}/>
    <div className="start-work-intro"><span className="start-work-symbol"><Icon name="compass" size={25}/></span><div><h2>One customer. All their work.</h2><p>Working with an existing customer? Open their record first to see travellers, bookings, applications and balances together.</p></div>{permissions.includes("customer:view")&&<Link href="/customers" className="btn-secondary">Find customer<Icon name="arrow" size={16}/></Link>}</div>
    <div className="workflow-filters"><SearchInput label="Find a workflow" placeholder="Payment, visa, booking, quotation…" value={query} onChange={setQuery}/><div className="workflow-groups" role="group" aria-label="Workflow area">{GROUPS.filter(value=>value==="All workflows"||actions.some(action=>action.group===value)).map(value=><button type="button" key={value} aria-pressed={group===value} onClick={()=>setGroup(value)}>{value}</button>)}</div></div>
    <p className="workflow-result-count" role="status">{visible.length} available workflows · actions follow your role permissions</p>
    {visible.length?<div className="workflow-card-grid">{visible.map(action=><Link className="workflow-card" key={action.id} href={action.href} aria-labelledby={`workflow-title-${action.id}`} aria-describedby={`workflow-description-${action.id}`}><div className="workflow-card-heading"><span className="workflow-card-icon"><Icon name={action.icon} size={22}/></span><span>{action.group}</span><Icon name="arrow" size={18}/></div><h2 id={`workflow-title-${action.id}`}>{action.title}</h2><p id={`workflow-description-${action.id}`}>{action.description}</p><ol aria-label={`${action.title} steps`}>{action.steps.map((step,index)=><li key={step}><span>{index+1}</span>{step}</li>)}</ol><span className="workflow-card-cta">Start this workflow<Icon name="arrow" size={15}/></span></Link>)}</div>:<EmptyState title="No matching workflows" description="Try another keyword or work area. Only actions available to your role are shown." action="Clear filters" onAction={()=>{setQuery("");setGroup("All workflows");}}/>}
  </div>;
}
