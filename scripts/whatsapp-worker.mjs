// No database or provider credentials needed in this container. All work is authenticated to the app.
const secret = process.env.WA_WORKER_SECRET;
if (!secret || secret.length < 32) throw new Error("WA_WORKER_SECRET must contain at least 32 characters.");
const url = process.env.WA_WORKER_URL || "http://app:3000/api/whatsapp/process";
let stopping = false;
process.on("SIGTERM",()=>{stopping=true;});
process.on("SIGINT",()=>{stopping=true;});
while (!stopping) {
  try {
    const r = await fetch(url,{method:"POST",headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(240000)});
    if (!r.ok) console.error(`[whatsapp-worker] App returned HTTP ${r.status}`);
  } catch { console.error("[whatsapp-worker] Could not reach the CRM worker endpoint."); }
  for(let n=0;n<15&&!stopping;n++) await new Promise(r=>setTimeout(r,1000));
}
