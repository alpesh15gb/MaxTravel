"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
const RULE_LABELS: Record<string,string> = { BOOKING_CREATED: "Booking created acknowledgement", TICKET_CONFIRMED: "Ticket confirmation after ticket numbers are recorded", PAYMENT_RECEIVED: "Payment received acknowledgement", STATUS_UPDATE: "Visa stage changes", DOC_REQUEST: "Document requests when entering a document stage", APPOINTMENT_REMINDER: "Appointments within 24 hours", PNR_EXPIRY: "Ticketing deadlines within 24 hours", PAYMENT_REMINDER: "One reminder per overdue invoice due date" };
export default function MessagingControls({ configured, canManage, rules, unmatched, customers }: {
  configured: boolean; canManage: boolean; rules: string[];
  unmatched: { id: string; phone: string; body: string; reason: string }[];
  customers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [state,setState] = useState(configured ? "checking" : "manual");
  const [enabled,setEnabled] = useState(rules);
  const [error,setError] = useState(""); const [busy,setBusy] = useState(false);
  useEffect(()=>{
    if (!configured) return;
    let alive=true; const controller=new AbortController();
    const check=async()=>{try { const r=await fetch("/api/whatsapp/connection",{signal:controller.signal}); if(r.ok){const d=await r.json();if(alive)setState(d.state);}else if(alive)setState("unreachable"); }catch{if(alive)setState("unreachable");}};
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
      <p className="mt-1 text-xs leading-5">{!configured?"Log messages here, then open WhatsApp to send. Delivery is not verified.":"Messages are queued on the server. Delivery and read status depend on provider receipts. Queued messages wait while disconnected. Media replies appear as notices; open WhatsApp to view attachments."}</p>
    </div>
    {configured&&canManage&&<details className="panel p-4"><summary className="cursor-pointer text-sm font-semibold">Automatic messages and unmatched replies</summary>
      <p className="my-3 text-xs leading-5 text-slate-600">Automatic messages require customer consent. Booking, ticket and payment confirmations send immediately; other updates send between 09:00 and 20:00 India time. Sending STOP withdraws consent. New rules start disabled; review them before enabling.</p>
      <div className="space-y-3">{Object.entries(RULE_LABELS).map(([key,label])=><label key={key} className="flex items-center gap-3 text-sm"><input type="checkbox" checked={enabled.includes(key)} disabled={busy} onChange={async e=>{const next=e.target.checked?[...enabled,key]:enabled.filter(x=>x!==key);if(await save({rules:next}))setEnabled(next);}}/>{label}</label>)}</div>
      <h2 className="mb-2 mt-5 text-sm font-semibold">Unmatched incoming messages</h2>
      {!unmatched.length&&<p className="text-xs text-slate-500">No unmatched replies.</p>}
      {unmatched.map(m=><div key={m.id} className="mt-3 rounded-lg border border-slate-200 p-3"><p className="text-sm font-medium">+{m.phone} · {m.reason==="AMBIGUOUS"?"Multiple matching customers":"No matching customer"}</p><p className="my-2 whitespace-pre-wrap break-words text-sm">{m.body}</p><select className="control w-full" aria-label={`Match message from ${m.phone} to customer`} defaultValue="" disabled={busy} onChange={e=>{if(e.target.value)void save({inboundId:m.id,matchCustomerId:e.target.value});}}><option value="">Match to a customer after verifying identity</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>)}
    </details>}
    {error&&<p role="alert" className="form-error">{error}</p>}
  </div>;
}
