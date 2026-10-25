// Node-only mock provider. Loaded ONLY by the disposable fixture subprocess, never application imports.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {appendFileSync} from 'node:fs';
if(process.env.CRM_SYNTHETIC_INCOMING!=='1'||process.env.APP_ORIGIN!=='http://127.0.0.1:3397')throw Error('Incoming provider fixture requires its isolated loopback origin');
process.env.WA_PROVIDER='meta';process.env.WA_WORKER_SECRET='synthetic-fixture-worker-secret-0123456789abcdef';process.env.WA_CLOUD_ACCESS_TOKEN='synthetic-local-fixture-token-not-valid-anywhere';process.env.WA_CLOUD_PHONE_NUMBER_ID='123456789';process.env.WA_CLOUD_WABA_ID='987654321';process.env.WA_CLOUD_GRAPH_VERSION='v23.0';process.env.WA_CLOUD_APP_SECRET='synthetic-fixture-app-secret-0123456789abcdef';process.env.WA_CLOUD_VERIFY_TOKEN='synthetic-fixture-verify-token-0123456789abcdef';
const bytes=Buffer.from('%PDF-1.4\nSynthetic incoming document fixture only\n%%EOF'),sha256=createHash('sha256').update(bytes).digest('hex'),original=globalThis.fetch;
const trace=(event)=>{if(process.env.CRM_INCOMING_TRACE)appendFileSync(process.env.CRM_INCOMING_TRACE,JSON.stringify(event)+'\n');};
globalThis.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url),method=init.method??(input instanceof Request?input.method:'GET');
 if(url.origin==='http://127.0.0.1:3397')return original(input,init);
 // No network fallback for provider endpoints, messages, telemetry or unknown hosts.
 if(method!=='GET'){trace({event:'blocked-provider-write',host:url.host,path:url.pathname,method});throw Error('Fixture forbids all external writes');}
 if(url.origin==='https://graph.facebook.com'&&/^\/v23\.0\/fixture-media-(1440|390)$/.test(url.pathname)){
  assert.equal(new Headers(init.headers).get('authorization'),'Bearer synthetic-local-fixture-token-not-valid-anywhere');const id=url.pathname.split('/').pop();trace({event:'mock-metadata',id});return Response.json({id,mime_type:'application/pdf',file_size:bytes.length,sha256,url:`https://lookaside.fbsbx.com/whatsapp_business/attachments/?id=${id}`});
 }
 if(url.origin==='https://lookaside.fbsbx.com'&&url.pathname==='/whatsapp_business/attachments/'&&/^fixture-media-(1440|390)$/.test(url.searchParams.get('id')??'')){
  assert.equal(init.redirect,'error');assert.equal(new Headers(init.headers).get('authorization'),'Bearer synthetic-local-fixture-token-not-valid-anywhere');trace({event:'mock-download',id:url.searchParams.get('id')});return new Response(new Uint8Array(bytes));
 }
 if(url.origin==='https://graph.facebook.com'&&url.pathname==='/v23.0/123456789'){trace({event:'mock-connection-status'});return Response.json({id:'123456789',display_phone_number:'Synthetic fixture'});}
 trace({event:'blocked-external',host:url.host,path:url.pathname,method});throw Error('Unexpected external request blocked by synthetic provider');
};
