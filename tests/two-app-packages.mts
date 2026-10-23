/** Two real production Next servers + disposable CRM SQLite. No browser/provider.
 * Build both checkouts first; BOOKING_FIXTURE_ROOT must point at booking-platform.
 * Never accepts a database URL, deployed URL or existing staff credentials. */
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,readFileSync,writeFileSync,mkdirSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync,execFileSync,type ChildProcess} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import bcrypt from 'bcryptjs';
import {emptyPackage} from '../src/lib/travel-packages';
import {within,stopFixtureChild,withFixtureCleanup} from './fixture-lifecycle.mjs';
const crm=realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
const output=path.join(crm,'test-artifacts/two-app-packages');mkdirSync(output,{recursive:true});
// Invalidate prior success before input, build, database or socket preflight.
const run={runId:randomUUID(),startedAt:new Date().toISOString(),status:'failed' as 'passed'|'failed',stages:[] as string[]};
writeFileSync(path.join(output,'proof.json'),JSON.stringify({...run,phase:'preflight'},null,2));
assert(process.env.BOOKING_FIXTURE_ROOT,'Explicit BOOKING_FIXTURE_ROOT required');
const booking=realpathSync(process.env.BOOKING_FIXTURE_ROOT!);
assert.equal(JSON.parse(readFileSync(path.join(booking,'package.json'),'utf8')).name,'booking-platform');
for(const root of [crm,booking]){
 for(const name of ['.env','.env.local','.env.production','.env.production.local'])assert(!existsSync(path.join(root,name)),`Use a fixture checkout without ${name}`);
 assert(existsSync(path.join(root,'.next/BUILD_ID')),`Build fixture checkout first: ${root}`);
}
const revision=(root:string)=>execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const dir=mkdtempSync(path.join(tmpdir(),'two-app-package-proof-'));
const databaseUrl=`file:${path.join(dir,'fixture.db')}`;
const bridgeLog=path.join(dir,'bridge.jsonl');writeFileSync(bridgeLog,'');
const servers:ChildProcess[]=[];const logs:Record<string,string>={};let db:PrismaClient|undefined;
const cleanEnv={PATH:process.env.PATH,HOME:dir,TMPDIR:dir,NODE_ENV:'production',NODE_OPTIONS:'--preserve-symlinks',NEXT_TELEMETRY_DISABLED:'1'};
async function port(){return new Promise<number>((resolve,reject)=>{const server=createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const address=server.address();assert(address&&typeof address!=='string');server.close(error=>error?reject(error):resolve(address.port));});});}
const crmOrigin=`http://127.0.0.1:${await port()}`,bookingOrigin=`http://127.0.0.1:${await port()}`;
assert.notEqual(crmOrigin,bookingOrigin);
const proof={...run,phase:'execution',bookingFontMode:process.env.TWO_APP_FONT_FIXTURE==='1'?'Next Google font fixture; not visual equivalence':'normal build',crmRevision:revision(crm),bookingRevision:revision(booking),crmBuild:readFileSync(path.join(crm,'.next/BUILD_ID'),'utf8').trim(),bookingBuild:readFileSync(path.join(booking,'.next/BUILD_ID'),'utf8').trim(),stages:[] as string[]};
function start(label:string,root:string,origin:string,env:NodeJS.ProcessEnv,preload?:string){
 logs[label]='';const args=[...(preload?['--import',preload]:[]),'node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',new URL(origin).port];
 const child=spawn(process.execPath,args,{cwd:root,env:{...cleanEnv,...env},stdio:['ignore','pipe','pipe']});servers.push(child);
 child.stdout!.on('data',data=>logs[label]+=String(data));child.stderr!.on('data',data=>logs[label]+=String(data));return child;
}
async function request(origin:string,pathname:string,init?:RequestInit){assert([crmOrigin,bookingOrigin].includes(origin));return fetch(origin+pathname,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});}
async function ready(origin:string,pathname:string,child:ChildProcess){await within((async()=>{while(true){if(child.exitCode!==null)throw Error(`Fixture server exited: ${origin}`);try{if((await request(origin,pathname)).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,150));}})(),30000,'fixture readiness');}
try {
await withFixtureCleanup(async()=>{
 const env={DATABASE_URL:databaseUrl,APP_ORIGIN:crmOrigin,JWT_SECRET:'two-app-fixture-only-placeholder-not-valid-anywhere-real-0123456789',WA_PROVIDER:'manual',PACKAGE_MEDIA_ROOT:path.join(dir,'media'),UPLOAD_ROOT:path.join(dir,'uploads')};
 const migrated=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{cwd:crm,env:{...cleanEnv,...env},encoding:'utf8',timeout:60000});assert.equal(migrated.status,0,migrated.stderr);
 db=new PrismaClient({datasources:{db:{url:databaseUrl}}});
 const role=await db.role.create({data:{key:'OWNER',name:'Synthetic owner',desc:'Disposable two-app fixture'}});
 const password='two-app-disposable-staff-fixture-only';
 await db.user.create({data:{employeeCode:'TWO-APP',name:'Fixture owner',email:'two-app@example.test',phone:'',passwordHash:await bcrypt.hash(password,10),roleId:role.id}});
 const crmServer=start('crm',crm,crmOrigin,env);
 await ready(crmOrigin,'/api/health',crmServer);
 const bookingServer=start('booking',booking,bookingOrigin,{BETTER_AUTH_URL:bookingOrigin,PAYMENT_PROVIDER:'PAYGLOCAL',TWO_APP_PACKAGE_FIXTURE:'loopback-only',TWO_APP_CRM_ORIGIN:crmOrigin,TWO_APP_BRIDGE_LOG:bridgeLog},path.join(crm,'tests/two-app-package-fetch.mjs'));
 await ready(bookingOrigin,'/api/packages',bookingServer);
 const login=await request(crmOrigin,'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:crmOrigin},body:JSON.stringify({email:'two-app@example.test',password})});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie')!.split(';')[0];assert(cookie);
 const slug='two-app-synthetic-journey',privateNote='NEVER_PUBLIC_TWO_APP_PRIVATE_NOTE',draftTitle='UNPUBLISHED_PRIVATE_DRAFT_TITLE';
 const draft={...emptyPackage,title:'Two app published journey',destination:'Synthetic destination',summary:'Disposable two app package proof.',description:'Synthetic itinerary for integration testing only.',priceAmount:12345.67,priceBasis:'PER_PERSON',priceNotes:'Synthetic starting price for all fixture assertions',priceValidUntil:new Date(Date.now()+30*86400000).toISOString().slice(0,10),itinerary:[{day:1,title:'Synthetic itinerary day',description:'Fixture only.'}],inclusions:['Synthetic inclusion'],exclusions:['Synthetic exclusion'],terms:'Synthetic terms',cancellationPolicy:'Synthetic cancellation terms',availabilityNotes:'On request only',contactEmail:'fixture@example.test',internalNotes:privateNote};
 let item:{id:string;revision:number};
 async function mutate(body:object){const response=await request(crmOrigin,'/api/travel-packages'+(item?`/${item.id}`:''),{method:item?'PATCH':'POST',headers:{Cookie:cookie,Origin:crmOrigin,'Content-Type':'application/json'},body:JSON.stringify({...body,...(item?{revision:item.revision}:{})})});const result=await response.json();assert(response.ok,JSON.stringify(result));item=result.package;}
 async function observe(published:boolean,label:string){
  const before=readFileSync(bridgeLog,'utf8').trim().split('\n').filter(Boolean).length;
  const list=await request(bookingOrigin,'/api/packages');assert.equal(list.status,200);assert.match(list.headers.get('cache-control')??'',/no-store/);const listing=await list.json();
  assert.equal(listing.packages.some((p:{slug:string})=>p.slug===slug),published);
  const detail=await request(bookingOrigin,`/api/packages/${slug}`);assert.equal(detail.status,published?200:404);assert.match(detail.headers.get('cache-control')??'',/no-store/);const detailBody=await detail.json();
  const page=await request(bookingOrigin,`/packages/${slug}`);assert.equal(page.status,published?200:404);assert.match(page.headers.get('x-robots-tag')??'',/noindex/);const html=await page.text();
  for(const payload of [JSON.stringify(listing),JSON.stringify(detailBody),html]){assert(!payload.includes(privateNote));assert(!payload.includes(draftTitle));}
  if(published){const summary=listing.packages.find((p:{slug:string})=>p.slug===slug);assert.equal(summary.priceAmount,12345.67);assert(!('internalNotes'in summary));assert(!('itinerary'in summary));assert.equal(detailBody.package.title,draft.title);assert.equal(detailBody.package.priceAmount,12345.67);assert.deepEqual(detailBody.package.inclusions,draft.inclusions);assert(html.includes(draft.title));assert(html.includes('Synthetic itinerary day'));}
  else {assert(html.includes('Package unavailable'));assert(!html.includes(draft.title));}
  const lines=readFileSync(bridgeLog,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));assert(lines.every(line=>!line.blocked&&line.cache==='no-store'));assert(lines.length>=before+3,'Every observation reaches real CRM; no adapter/cache fixture shortcut');
  proof.stages.push(label);console.log(`PASS ${label}`);
 }
 await mutate({slug,draft});await observe(false,'draft is private in booking listing, detail API and SSR');
 await mutate({action:'PUBLISH',slug,draft});await observe(true,'publication crosses real HTTP into booking catalogue and SSR');
 await mutate({action:'SAVE',slug,draft:{...draft,title:draftTitle,priceAmount:99999}});await observe(true,'unpublished draft changes and private notes remain isolated');
 await mutate({action:'UNPUBLISH'});await observe(false,'withdrawal removes prior warmed listing, detail API and SSR');
 await observe(false,'repeat withdrawal read remains absent without stale publication');
 assert.equal((await db.travelPackage.findUniqueOrThrow({where:{id:item!.id}})).status,'DRAFT');
 console.log('PASS two real apps; no browser, supplier, payment or production database calls');
},async()=>{
 const cleanup=await Promise.allSettled([...servers.reverse().map(child=>stopFixtureChild(child)),db?.$disconnect()]);
 const failures=cleanup.filter(result=>result.status==='rejected');
 if(failures.length)throw new AggregateError(failures.map(result=>(result as PromiseRejectedResult).reason),'Fixture cleanup failed');
});
proof.status='passed';
} finally {
 try {
  for(const [label,log]of Object.entries(logs))writeFileSync(path.join(output,`${label}.log`),log);
  writeFileSync(path.join(output,'bridge.jsonl'),readFileSync(bridgeLog));
  rmSync(dir,{recursive:true,force:true});
 } catch(error) {proof.status='failed';throw error;}
 finally {writeFileSync(path.join(output,'proof.json'),JSON.stringify(proof,null,2));}
}
