"use client";
import { dateTimeLabel } from "@/lib/dates";
import { composerReady, hasComposerDraft } from "@/lib/whatsapp-composer-memory";
import { useWhatsAppComposer } from "@/components/WhatsAppComposerProvider";
import PdfAttachment from "./PdfAttachment";
import MessagingControls from "./MessagingControls";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "@/components/Icon";
import { PageHeader, EmptyState, Field, Status } from "@/components/ui";
type Msg={id:string;direction:string;body:string;at:string;status:string;template:string|null;staff:string|null;lastError:string|null;attachment:{id:string;filename:string}|null};
type Thread={id:string;customerId:string;customerName:string;customerCode:string;phone:string;unread:number;awaitingReply:boolean;lastAt:string;messages:Msg[]};
export default function WhatsAppInbox({paymentTemplate,threads,customers,templates,canSend,selectedThread,selectedCustomer,configured,canManage,rules,unmatched}:{paymentTemplate:string;configured:boolean;canManage:boolean;rules:string[];unmatched:{id:string;phone:string;body:string;reason:string}[];threads:Thread[];customers:{id:string;name:string;phone:string;whatsappOptIn:boolean}[];templates:{key:string;title:string;body:string}[];canSend:boolean;selectedThread:string|null;selectedCustomer:string|null}){
 const router=useRouter(), memory=useWhatsAppComposer();
 const fieldId=useId(), conversationLabelId=`${fieldId}-conversation-label`, cloudLabelId=`${fieldId}-cloud-label`, cloudHintId=`${fieldId}-cloud-hint`;
 const initial=threads.find(t=>t.id===selectedThread)?.customerId??selectedCustomer??threads[0]?.customerId??"";
 const [customerId,setCustomer]=useState(initial), [q,setQ]=useState("");
 const selected=useRef(initial), view=useRef(0), previewController=useRef<AbortController|null>(null);
 const [generation,setGeneration]=useState(0), [localError,setLocalError]=useState("");
 const routeSelection=useRef(JSON.stringify([selectedThread,selectedCustomer]));
 const [cloudEnabled,setCloudEnabled]=useState(false);
 const [cloudTemplates,setCloudTemplates]=useState<{key:string;name:string;language:string;parameters:string[]}[]>([]);
 const entry=memory.get(customerId), {draft,attachment,cloudPreview,cloudKey,cloudValues,error,handoff}=entry;
 const busy=Boolean(entry.previewToken||entry.action?.phase==="pending");
 const active=threads.find(t=>t.customerId===customerId), customer=customers.find(c=>c.id===customerId);
 const chosenCloud=cloudTemplates.find(t=>t.key===cloudKey);
 useEffect(()=>{
   const activate=()=>{view.current=memory.activate(selected.current);setGeneration(view.current);};
   const show=(event:PageTransitionEvent)=>{if(event.persisted)activate();};
   activate(); router.refresh(); window.addEventListener("pageshow",show);
   return()=>{previewController.current?.abort();memory.leave(view.current);window.removeEventListener("pageshow",show);};
 },[memory,router]);
 useEffect(()=>{
   const key=JSON.stringify([selectedThread,selectedCustomer]);
   if(routeSelection.current===key)return;
   routeSelection.current=key;
   const next=threads.find(t=>t.id===selectedThread)?.customerId??selectedCustomer??"";
   previewController.current?.abort();selected.current=next;view.current=memory.activate(next);
   setGeneration(view.current);setCustomer(next);setLocalError("");
 },[selectedThread,selectedCustomer,threads,memory]);
 useEffect(()=>{if(!configured)return;const controller=new AbortController();fetch("/api/whatsapp/meta-templates",{signal:controller.signal}).then(r=>r.ok?r.json():null).then(data=>{if(!controller.signal.aborted&&data?.configured){setCloudEnabled(true);setCloudTemplates(data.templates);}}).catch(()=>{});return()=>controller.abort();},[configured]);
 function selectCustomer(next:string){
   if(next===customerId)return;
   previewController.current?.abort();selected.current=next;view.current=memory.activate(next);
   setGeneration(view.current);setCustomer(next);setLocalError("");
 }
 function edit(patch:Parameters<typeof memory.edit>[1], expectedView=view.current, attachmentEpoch?:number){
   previewController.current?.abort();
   if(!memory.edit(customerId,patch,expectedView,attachmentEpoch)&&memory.isActive(customerId,expectedView))setLocalError("Up to 20 private drafts can be kept in this tab. Finish or discard an earlier draft before starting another.");
   else setLocalError("");
 }
 async function preview(template:string,cloud=false){
   if(!canSend||!customer||(!cloud&&!template))return;
   if(!cloud&&draft.trim()&&!window.confirm("Replace this customer's unsent message with the quick reply?"))return;
   const token=memory.beginPreview(customerId,view.current,cloud);if(!token)return;
   const controller=new AbortController();previewController.current=controller;
   try{
     const r=await fetch("/api/whatsapp/send",{method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({customerId,preview:true,...(cloud?{cloudTemplateKey:cloudKey,cloudValues,...(attachment?{attachmentId:attachment.id}:{})}:{template})})});
     const data=await r.json();if(!r.ok||typeof data.body!=="string")throw Error(data.error||"Could not prepare template.");
     memory.finishPreview(token,data.body);
   }catch(e){if(!controller.signal.aborted)memory.finishPreview(token,null,e instanceof Error?e.message:"Preview unavailable.");}
   finally{if(previewController.current===controller)previewController.current=null;}
 }
 async function consent(optIn:boolean){
   if(!canSend||!customer)return;
   const currentView=view.current,token=memory.beginConsent(customerId,currentView);if(token===null)return;
   try{const r=await fetch("/api/whatsapp/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({customerId,optIn})});const d=await r.json();if(!r.ok)throw new Error(d.error??"Could not save consent.");if(memory.finishConsent(customerId,token)&&memory.isActive(selected.current,view.current))router.refresh();}
   catch(e){memory.finishConsent(customerId,token,e instanceof Error?e.message:"Could not save consent. Refresh to check its current status.");}
 }
 async function log(){
   if(!canSend||!customer||cloudKey&&!chosenCloud)return;
   const currentView=view.current;
   const token=memory.beginSend(customerId,currentView,chosenCloud?.parameters??[],()=>{const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);return Array.from(bytes,value=>value.toString(16).padStart(2,"0")).join("");});if(!token)return;
   const fields=token.fields;
   try{
     const r=await fetch("/api/whatsapp/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({customerId:token.customerId,text:fields.draft,...(fields.attachment?{attachmentId:fields.attachment.id,acceptedAttachmentId:fields.attachment.confirmed?fields.attachment.id:null}:{}),...(fields.cloudKey?{cloudTemplateKey:fields.cloudKey,cloudValues:fields.cloudValues,acceptedCloudBody:token.cloudPreview}:{}),requestId:token.requestId})});
     const d=await r.json();
     if(!r.ok){memory.finishSend(token,r.status>=500||r.status===408?"uncertain":"rejected",undefined,r.status>=500||r.status===408?undefined:d.error??"Could not prepare your message.");return;}
     if(d.ok!==true||typeof d.messageId!=="string"||typeof d.threadId!=="string"||typeof d.body!=="string"||typeof d.status!=="string"||!["LOGGED","QUEUED","SENT","DELIVERED","READ","FAILED"].includes(d.status)||(d.whatsappUrl!==null&&typeof d.whatsappUrl!=="string")){
       memory.finishSend(token,"uncertain");return;
     }
     const applied=memory.finishSend(token,"acknowledged",{url:d.whatsappUrl,body:d.body,status:d.status});
     if(applied&&memory.isActive(selected.current,view.current))router.refresh();
   }catch{memory.finishSend(token,"uncertain");}
 }
 return <div className="workspace-page"><PageHeader title="WhatsApp desk" description={configured?"Send and receive customer messages from your shared agency number.":"Log customer messages against the customer record, then send them in WhatsApp."} actions={<a className={customers.length?"btn-primary":"btn-secondary"} href="#conversation-picker">Open a conversation</a>}/><MessagingControls paymentTemplate={paymentTemplate} configured={configured} canManage={canManage} rules={rules} unmatched={unmatched} customers={customers}/>
 <div className="panel grid overflow-hidden md:grid-cols-[280px_1fr]"><aside aria-label="Conversations" className="border-b border-slate-200 md:border-b-0 md:border-r"><div className="space-y-3 p-4" id="conversation-picker" tabIndex={-1}><label className="field"><span className="field-label" id={conversationLabelId}>Start or open a conversation</span><select aria-labelledby={conversationLabelId} value={customerId} onChange={e=>selectCustomer(e.target.value)}><option value="">Choose a customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><input aria-label="Filter conversations" value={q} onChange={e=>setQ(e.target.value)} placeholder="Find a conversation…" className="control w-full"/></div><div className="max-h-48 overflow-y-auto md:max-h-[540px]">{threads.filter(t=>t.customerName.toLowerCase().includes(q.toLowerCase())).map(t=><button key={t.id} onClick={()=>selectCustomer(t.customerId)} className={`w-full border-t border-slate-100 p-4 text-left ${customerId===t.customerId?"bg-teal-50":"hover:bg-slate-50"}`}><span className="block text-sm font-semibold">{t.customerName}</span><span className="mt-1 block truncate text-xs text-slate-500">{t.messages[t.messages.length-1]?.body??"No messages"}</span>{t.awaitingReply&&<span className="mt-2 block text-small text-amber-700">Inbound message awaiting follow-up</span>}</button>)}</div></aside>
 <section className="flex min-h-[500px] min-w-0 flex-col">{customer?<><header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-5"><div><h2 className="font-semibold">{customer.name}</h2><p className="mt-1 text-xs text-slate-500">{customer.phone}</p></div><Link className="text-xs font-semibold text-teal-700" href={`/customers/${customer.id}`}>Customer workspace →</Link></header><div className="flex-1 space-y-3 p-5">{!active?.messages.length&&<div className="py-8 text-center text-xs text-slate-500">Your conversation history starts with the first message.</div>}{active?.messages.map(m=><div key={m.id} className={`max-w-[90%] whitespace-pre-wrap break-words rounded-2xl p-4 text-sm md:max-w-[80%] ${m.direction==="OUT"?"ml-auto border border-teal-100 bg-teal-50":"bg-slate-100"}`}>{m.body}{m.attachment&&<a className="mt-2 block text-xs font-semibold text-teal-700 underline" href={`/api/whatsapp/attachments/${m.attachment.id}`} target="_blank" rel="noopener noreferrer">PDF · {m.attachment.filename}</a>}<div className="mt-2 flex flex-wrap items-center justify-end gap-2 text-small text-slate-500">{m.staff??(m.direction==="OUT"&&m.template?"Automatic message":null)} {dateTimeLabel(m.at)}{m.direction==="OUT"&&<Status tone="neutral">{m.status==="LOGGED"?"Logged · not sent":m.status==="UNKNOWN"?"Outcome unknown":m.status.toLowerCase()}</Status>}{m.status==="UNKNOWN"&&<span className="block w-full text-rose-700">Check WhatsApp before sending again.</span>}{m.lastError&&<span className="block w-full text-rose-700">{m.lastError}</span>}</div></div>)}</div>{canSend&&<div className="space-y-3 border-t border-slate-200 p-5">{configured&&<label className="flex items-start gap-3 text-xs leading-5"><input type="checkbox" className="mt-1" checked={customer.whatsappOptIn} disabled={busy} onChange={e=>void consent(e.target.checked)}/>Customer agreed to receive WhatsApp messages</label>}{cloudEnabled&&<PdfAttachment key={`${customerId}:${generation}:${entry.attachmentEpoch}`} customerId={customerId} disabled={busy} onUploading={uploading=>memory.uploading(customerId,uploading,generation,entry.attachmentEpoch)} value={attachment} onChange={value=>edit({attachment:value},generation,entry.attachmentEpoch)}/>}{cloudTemplates.length>0&&<div className="space-y-2"><label className="field"><span className="field-label" id={cloudLabelId}>Approved Meta utility template</span><select aria-labelledby={cloudLabelId} aria-describedby={cloudHintId} value={cloudKey} onChange={e=>edit({cloudKey:e.target.value,cloudValues:{}})}><option value="">Free-text reply (within 24 hours only)</option>{cloudTemplates.map(t=><option key={t.key} value={t.key}>{t.name} · {t.language}</option>)}</select></label>{chosenCloud?.parameters.map(name=><Field key={name} label={name}><input maxLength={1024} value={cloudValues[name]??""} onChange={e=>edit({cloudValues:{...cloudValues,[name]:e.target.value}})}/></Field>)}{cloudKey&&<><button className="btn-secondary" disabled={busy} onClick={()=>void preview("",true)}>Preview approved message</button>{cloudPreview&&<p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">{cloudPreview}</p>}</>}<p id={cloudHintId} className="text-xs text-slate-500">Template name, approval and utility category are checked with Meta before sending. Enter the specific business fields; the approved wording is used.</p></div>}{!cloudKey&&templates.length>0&&<select aria-label="Insert quick reply" defaultValue="" disabled={busy} onChange={e=>{void preview(e.target.value);e.target.value="";}} className="control text-xs"><option value="">Insert a quick reply</option>{templates.map(t=><option key={t.key} value={t.key}>{t.title}</option>)}</select>}{!cloudKey&&<Field label="Message"><textarea rows={3} maxLength={4000} placeholder={`Write to ${customer.name}…`} value={draft} onChange={e=>edit({draft:e.target.value})}/></Field>}{(error||localError)&&<div role="alert" className="form-error">{localError||error}</div>}
 {entry.action?.phase==="uncertain"&&<div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><p>The earlier send may already have completed. Do not repeat it until you have checked this customer&apos;s conversation and WhatsApp.</p><button className="btn-secondary" onClick={()=>router.refresh()}>Refresh conversation</button><button className="btn-secondary" onClick={()=>{if(window.confirm("Have you checked this customer's conversation and WhatsApp for the earlier message? This does not cancel it. Continue only after verifying its outcome to avoid a duplicate."))memory.reviewedUnknown(customerId);}}>I checked the earlier message</button></div>}
 {hasComposerDraft(entry)&&<p className="text-xs text-slate-500">Private draft kept for this customer while you switch conversations or use Back in this workspace. It expires after 30 minutes and is not saved across reload or sign-out.</p>}{handoff&&<div className="form-success" role="status">{handoff.status==="LOGGED"?"Message logged - not sent.":`Message ${handoff.status.toLowerCase()}. Delivery status will update here.`}{handoff.newerDraftKept&&" Your newer draft has been kept."} {handoff.url?<a href={handoff.url} target="_blank" rel="noopener noreferrer" className="ml-1 font-semibold underline">Open WhatsApp to send →</a>:handoff.status==="LOGGED"?"This logged message has no WhatsApp handoff because its original recipient number was unavailable.":null}</div>}<div className="flex flex-wrap justify-end gap-2">{hasComposerDraft(entry)&&<button className="btn-secondary" disabled={Boolean(entry.action)} onClick={()=>{if(window.confirm("Discard this customer’s private unsent draft?")){previewController.current?.abort();memory.discard(customerId);}}}>Discard draft</button>}<button className="btn-primary" aria-label={configured?"Send WhatsApp message":"Log message & prepare WhatsApp"} aria-busy={busy} onClick={log} disabled={!composerReady(entry,chosenCloud?.parameters)||Boolean(cloudKey&&!chosenCloud)}><Icon name="message" size={16}/>{busy?"Saving…":configured?"Send WhatsApp message":"Log message & prepare WhatsApp"}</button></div></div>}</>:<EmptyState icon="message" title={customers.length?"Choose a customer to connect":"No conversations yet"} description="Select a real customer to view their communication history or prepare a message." href={!customers.length?"/customers":undefined} action={!customers.length?"Go to customers":undefined}/>}</section></div></div>;
}
