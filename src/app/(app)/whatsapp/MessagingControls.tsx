"use client";
import { useEffect, useState } from "react";
import { DEFAULT_PAYMENT_TEMPLATE, PAYMENT_TOKENS, PAYMENT_PREVIEW, paymentTemplateError, renderPaymentTemplate } from "@/lib/whatsapp-templates";
import { useRouter } from "next/navigation";
import type { MetaInboundHealth } from "@/lib/meta-inbound";
const RULE_LABELS: Record<string,string> = { BOOKING_CREATED: "Booking created acknowledgement", TICKET_CONFIRMED: "Ticket confirmation after ticket numbers are recorded", HOTEL_CONFIRMED: "Hotel booking confirmation", BOOKING_DOCUMENT:"Send confirmed booking PDF automatically (Meta document template)", PAYMENT_RECEIVED: "Payment received acknowledgement", STATUS_UPDATE: "Visa stage changes", DOC_REQUEST: "Document upload links for new cases and document stages", APPOINTMENT_REMINDER: "Appointments within 24 hours", PNR_EXPIRY: "Ticketing deadlines within 24 hours", PAYMENT_REMINDER: "One reminder per overdue invoice due date" };
export default function MessagingControls({ paymentTemplate, configured, canManage, rules, unmatched, customers }: {
  paymentTemplate: string; configured: boolean; canManage: boolean; rules: string[];
  unmatched: { id: string; phone: string; body: string; reason: string }[];
  customers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [state,setState] = useState(configured ? "checking" : "manual");
  const [inbound,setInbound] = useState<MetaInboundHealth|null>(null);
  const [template,setTemplate] = useState(paymentTemplate);
  const [savedTemplate,setSavedTemplate] = useState(paymentTemplate);
  const [notice,setNotice] = useState("");
  const templateError = paymentTemplateError(template);
  const [enabled,setEnabled] = useState(rules);
  const [error,setError] = useState(""); const [busy,setBusy] = useState(false);
  useEffect(()=>{
    if (!configured) return;
    let alive=true; const controller=new AbortController();
    const check=async()=>{try { const r=await fetch("/api/whatsapp/connection",{signal:controller.signal}); if(r.ok){const d=await r.json();if(alive){setState(d.state);setInbound(d.inbound??null);}}else if(alive)setState("unreachable"); }catch{if(alive)setState("unreachable");}};
    void check(); const timer=setInterval(()=>{if(document.visibilityState==="visible"){void check();router.refresh();}},15000);
    return()=>{alive=false;controller.abort();clearInterval(timer);};
  },[configured,router]);
  async function save(body: unknown) {
    setBusy(true);setError("");
    try {const r=await fetch("/api/whatsapp/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error??"Could not save messaging settings.");router.refresh();return true;}
    catch(e){setError(e instanceof Error?e.message:"Could not save settings.");return false;}finally{setBusy(false);}
  }
  return <div className="mb-5 space-y-3">
    <div role="status" className={`rounded-xl border p-4 text-sm ${state==="open"?"border-teal-200 bg-teal-50":"border-amber-200 bg-amber-50"}`}>
      <strong>{!configured?"Manual messaging mode":state==="open"?"WhatsApp connected":state==="checking"?"Checking WhatsApp connection…":"WhatsApp disconnected or unreachable"}</strong>
      <p className="mt-1 text-xs leading-5">{!configured?"Log messages here, then open WhatsApp to send. Delivery is not verified.":"Messages are queued on the server. Meta Cloud API uses approved utility templates for outbound updates; free-text replies need a verified customer message within 24 hours. STOP cancels pending messages. Delivery/read status comes from signed receipts. Media currently appears as a notice."}</p>
    </div>
    {canManage&&inbound&&!inbound.contentAvailable&&["unsupported","unknown","text"].includes(inbound.type)&&<div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
      <strong>WhatsApp did not provide readable message content</strong>
      <p className="mt-1 text-xs leading-5">{inbound.errorCodes.length?`Meta error ${inbound.errorCodes.join(", ")}. `:""}Ask the sender to send a new plain-text message. If fresh text also fails, check the WhatsApp Business connection with Meta support using this error code. Opening Incoming documents cannot recover missing text.</p>
    </div>}
    {configured&&canManage&&<details className="panel p-4"><summary className="cursor-pointer text-sm font-semibold">Automatic messages and unmatched replies</summary>
      <p className="my-3 text-xs leading-5 text-slate-600">Messages require customer consent. Meta automatic updates also need a mapped, approved utility template. Editing local wording does not edit or approve a Meta template. Booking, ticket, payment confirmations and document requests send immediately; other updates send between 09:00 and 20:00 India time. Sending STOP withdraws consent. New rules start disabled; review them before enabling.</p>
      <div className="space-y-3">{Object.entries(RULE_LABELS).map(([key,label])=><label key={key} className="flex items-center gap-3 text-sm"><input type="checkbox" checked={enabled.includes(key)} disabled={busy} onChange={async e=>{const next=e.target.checked?[...enabled,key]:enabled.filter(x=>x!==key);if(await save({rules:next}))setEnabled(next);}}/>{label}</label>)}</div>
      <div className="mt-5 border-t border-slate-200 pt-4">
        <label htmlFor="payment-template" className="text-sm font-semibold">Payment acknowledgement template</label>
        <p className="my-2 text-xs leading-5 text-slate-600">The balance is for the linked booking or visa case, or a standalone invoice, after this payment was recorded. Customer advances have no allocated balance. Changes apply to future messages; queued messages keep their original wording.</p>
        <p className="mb-2 break-words text-xs leading-5 text-slate-600">Placeholders: {PAYMENT_TOKENS.map(token=>`{${token}}`).join(", ")}</p>
        <textarea id="payment-template" className="control min-h-40 w-full" value={template} maxLength={2500} disabled={busy} onChange={e=>{setTemplate(e.target.value);setNotice("");}} aria-describedby="payment-template-help"/>
        <p id="payment-template-help" className="my-2 text-xs text-slate-600">{templateError ?? "Keep the balance reference so customers know which booking or invoice the balance belongs to."}</p>
        <div className="rounded-lg bg-slate-50 p-3"><h3 className="text-xs font-semibold">Example preview</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm">{templateError ? "Correct the template to preview it." : renderPaymentTemplate(template, PAYMENT_PREVIEW)}</p></div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busy || Boolean(templateError) || template === savedTemplate} onClick={async()=>{if(await save({paymentTemplate:template})){setSavedTemplate(template);setNotice("Payment template saved for future messages.");}}}>Save payment template</button>
          <button className="btn-secondary" disabled={busy} onClick={async()=>{if(await save({paymentTemplate:null})){setTemplate(DEFAULT_PAYMENT_TEMPLATE);setSavedTemplate(DEFAULT_PAYMENT_TEMPLATE);setNotice("Default payment template restored.");}}}>Restore default</button>
        </div>
        {notice&&<p role="status" className="mt-2 text-sm text-teal-700">{notice}</p>}
      </div>
      <h2 className="mb-2 mt-5 text-sm font-semibold">Unmatched incoming messages</h2>
      {!unmatched.length&&<p className="text-xs text-slate-500">No unmatched replies.</p>}
      {unmatched.map(m=><div key={m.id} className="mt-3 rounded-lg border border-slate-200 p-3"><p className="text-sm font-medium">+{m.phone} · {m.reason==="AMBIGUOUS"?"Multiple matching customers":"No matching customer"}</p><p className="my-2 whitespace-pre-wrap break-words text-sm">{m.body}</p><select className="control w-full" aria-label={`Match message from ${m.phone} to customer`} defaultValue="" disabled={busy} onChange={e=>{if(e.target.value)void save({inboundId:m.id,matchCustomerId:e.target.value});}}><option value="">Match to a customer after verifying identity</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>)}
    </details>}
    {error&&<p role="alert" className="form-error">{error}</p>}
  </div>;
}
