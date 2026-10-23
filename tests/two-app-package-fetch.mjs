/** Explicit fixture preload only: actual HTTP to disposable CRM, never canned JSON.
 * Production code retains its fixed CRM origin. Never use this in deployment. */
import {appendFileSync} from 'node:fs';
if(process.env.TWO_APP_PACKAGE_FIXTURE!=='loopback-only')throw Error('Explicit two-app fixture required');
const target=new URL(process.env.TWO_APP_CRM_ORIGIN??'');
if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||!target.port||target.pathname!=='/'||target.search||target.hash||target.username||target.password)throw Error('Disposable loopback CRM required');
const log=process.env.TWO_APP_BRIDGE_LOG;
if(!log)throw Error('Fixture bridge evidence path required');
const realFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 // Normalize with Fetch's own Request+init precedence, including inherited cache.
 const request=new Request(input,init);
 const url=new URL(request.url);
 const headers=request.headers;
 const method=request.method;
 if(url.origin!=='https://crm.maxtravel.in'||url.search||url.hash||method!=='GET'||!/^\/api\/public\/travel-packages(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(url.pathname)||headers.has('cookie')||headers.has('authorization')||request.body||request.credentials==='include'||request.cache!=='no-store'){
  appendFileSync(log,JSON.stringify({blocked:true})+'\n');throw Error('Unexpected outbound request blocked by two-app fixture');
 }
 appendFileSync(log,JSON.stringify({path:url.pathname,cache:request.cache})+'\n');
 return realFetch(new Request(new URL(url.pathname,target),request),{headers:{Accept:'application/json'},redirect:'error'});
};
