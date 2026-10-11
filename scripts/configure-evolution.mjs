// Run inside the CRM container after supplying its instance key via .env.
// Does not enumerate instances, change global hooks, create sessions or touch WhatsApp-main.
import fs from "node:fs";
const {EVOLUTION_BASE_URL:base, EVOLUTION_API_KEY:key, EVOLUTION_INSTANCE:instance, WA_WEBHOOK_SECRET:secret}=process.env;
if (!base || !key || instance!=="max travel" || !secret || secret.length<32) throw new Error("Expected configured max travel instance and a webhook secret of at least 32 characters.");
const target="http://max-travel-crm-webhook:3000/api/whatsapp/evolution";
async function request(path, body){
 const r=await fetch(`${base.replace(/\/$/,"")}${path}/${encodeURIComponent(instance)}`,{method:body?"POST":"GET",headers:{apikey:key,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000),redirect:"error"});
 if(!r.ok)throw new Error(`Evolution returned HTTP ${r.status}; no other instances were changed.`);
 return r.json();
}
const state=await request("/instance/connectionState");
if(state.instance?.state!=="open")throw new Error("max travel is not connected. Reconnect it in Evolution first.");
const previous=await request("/webhook/find");
const old=previous?.webhook??previous;
if(old?.enabled&&old?.url&&old.url!==target)throw new Error("This instance already has an enabled webhook for another app. Nothing changed; inspect it before continuing.");
const backup="/data/evolution-webhook-before-crm.json";
if(!fs.existsSync(backup))fs.writeFileSync(backup,JSON.stringify(previous,null,2),{mode:0o600});
await request("/webhook/set",{webhook:{enabled:true,url:target,byEvents:false,base64:false,headers:{Authorization:`Bearer ${secret}`},events:["MESSAGES_UPSERT","MESSAGES_UPDATE"]}});
const actual=await request("/webhook/find");const webhook=actual?.webhook??actual;
if(webhook?.url!==target||webhook?.enabled!==true)throw new Error("Webhook verification failed. Inspect only the max travel instance.");
console.log("max travel connected to the CRM webhook. Existing instances and global hooks were not modified.");
