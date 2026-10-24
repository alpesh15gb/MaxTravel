// Real Back/Forward traversal against disposable SQLite data. Never restores or retries a write automatically.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {chromium} from './browser.mjs';
import {within,withFixtureCleanup} from './fixture-lifecycle.mjs';
const port=3373,base=`http://127.0.0.1:${port}`,out=path.resolve('test-artifacts/sales-draft-recovery');
const ephemeral=fs.readFileSync('/proc/sys/net/ipv4/ip_local_port_range','utf8').trim().split(/\s+/).map(Number);
assert(ephemeral.length===2&&ephemeral.every(Number.isInteger)&&(port<ephemeral[0]||port>ephemeral[1]));
const metadata=path.resolve('tests/.runtime/visual-review-current.json');fs.mkdirSync(out,{recursive:true});fs.rmSync(metadata,{force:true});
const server=spawn(process.execPath,['tests/visual-review-server.mjs'],{detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,REVIEW_PORT:String(port),REVIEW_DEV:'0',APP_ORIGIN:base,WA_PROVIDER:'manual'}});
const report={scope:'Synthetic Chromium Back/Forward recovery; desktop/mobile emulation, not real-device certification',scenarios:[],errors:[],blocked:[],passed:false};
let logs='',spawnError='',browser,page,db,fixture,owner;
server.stdout.on('data',value=>logs+=value);server.stderr.on('data',value=>logs+=value);server.on('error',error=>spawnError=String(error));
const persist=()=>{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(out,'server.log'),logs);};
async function screenshot(name){await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name}: no horizontal overflow`);await page.screenshot({path:path.join(out,`${name}.png`),timeout:5000,animations:'disabled',mask:[page.locator('#sales-private-link')]});persist();}
async function api(context,url,method='GET',data){const response=await context.request.fetch(base+url,{method,data,headers:{Origin:base},timeout:15000});assert(response.ok(),`${method} ${url}: ${response.status()} ${await response.text()}`);return response.json();}
async function fresh(context,id){const data=await api(context,`/api/sales?leadId=${encodeURIComponent(id)}`);assert(data.lead&&typeof data.lead.baseRevision==='string'&&data.recoveryContext);return data;}
async function start(name,width=390){
 const context=await within(browser.newContext({viewport:{width,height:width===1440?1000:844},locale:'en-IN',timezoneId:'Asia/Kolkata',serviceWorkers:'block'}),30000,'context creation');context.setDefaultTimeout(15000);context.setDefaultNavigationTimeout(30000);
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===base)return route.continue();report.blocked.push({origin:url.origin,path:url.pathname});return route.abort('blockedbyclient');});
 await context.routeWebSocket('**/*',socket=>{report.blocked.push({transport:'websocket'});return socket.close({code:1008,reason:'Isolated fixture'});});
 page=await context.newPage();page.on('pageerror',error=>report.errors.push({name,message:error.message}));
 const writes=[];page.on('request',request=>{if(new URL(request.url()).pathname==='/api/sales'&&request.method()==='POST')writes.push(request.postDataJSON()?.action);});
 await page.goto(base+'/login');await page.getByLabel('Work email',{exact:true}).fill('review@visual.test');await page.getByLabel('Password',{exact:true}).fill('Review-Visual-2026!');await page.getByRole('button',{name:'Sign in to workspace',exact:true}).click();await page.waitForURL('**/dashboard');await page.locator('main h1').waitFor();
 const title=`Recovery ${name}`;const lead=await api(context,'/api/sales','POST',{action:'create',data:{customerId:fixture.customerId,title,source:'Synthetic recovery review',product:'HOTEL',budgetMinor:8000000,destination:'Kerala'}});
 const menu=page.getByRole('button',{name:'Open navigation',exact:true});if(await menu.isVisible())await menu.click();
 await page.locator('#workspace-navigation').getByRole('link',{name:'Enquiries & quotes',exact:true}).click();await page.waitForURL('**/sales');
 await page.getByRole('button',{name:`Open enquiry: ${title}`,exact:true}).click();await page.getByRole('button',{name:'New quote version',exact:true}).click();
 const field=page.getByLabel('Description / itinerary',{exact:true});await field.waitFor();
 await page.getByLabel('Price per unit (INR)',{exact:true}).fill('25000');await page.getByLabel('Terms and inclusions',{exact:true}).fill('Synthetic terms, not a booking or payment.');await page.getByLabel('Valid until',{exact:true}).fill('2099-12-01T12:00');
 const secret=`PRIVATE-${name}-last-keystroke-Z`;await field.fill(secret.slice(0,-1));await field.press('End');await page.keyboard.type('Z');
 return {context,title,id:lead.id,secret,writes};
}
async function back(){await page.goBack({waitUntil:'domcontentloaded',timeout:15000});await page.waitForURL('**/dashboard');}
async function forward(id,scoped=true){
 const checked=page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/sales'&&(!scoped||url.searchParams.get('leadId')===id)&&response.request().method()==='GET';},{timeout:15000});
 await page.goForward({waitUntil:'domcontentloaded',timeout:15000});await page.waitForURL('**/sales');return checked;
}
async function recoveryState(kind){await page.locator(`section[aria-label="Quotation recovery"][data-recovery-state="${kind}"]`).waitFor();}
async function confirmClick(button,expected){let message=null,type=null,dialogError=null;const handler=dialog=>{message=dialog.message();type=dialog.type();void(type==='confirm'&&message===expected?dialog.accept():dialog.dismiss()).catch(error=>dialogError=String(error));};page.once('dialog',handler);try{await button.click();}finally{page.off('dialog',handler);}assert.equal(type,'confirm');assert.equal(message,expected);assert.equal(dialogError,null);}
async function boundarySettled(){
 // Both safe paths are valid: keyed layout replacement, or an explicit stale-session error.
 await page.waitForFunction(()=>[...document.querySelectorAll('[role="alert"]')].some(node=>/Staff session or access changed|saved quotation was cleared/.test(node.textContent??''))||[...document.querySelectorAll('button')].some(node=>node.textContent?.trim()==='New enquiry'&&!node.disabled),undefined,{timeout:15000});
 assert.equal(await page.getByRole('region',{name:'Quotation recovery',exact:true}).count(),0,'Identity/scope boundary clears rather than merely hides recovery');
}
async function noCachedText(secret){assert(await page.evaluate(value=>!document.body.innerText.includes(value)&&![...document.querySelectorAll('input,textarea')].some(node=>node.value.includes(value)),secret),'Denied identity/scope never renders cached draft text');}
async function focused(locator){const handle=await locator.elementHandle();assert(handle);try{await page.waitForFunction(node=>document.activeElement===node,handle,{timeout:5000});}finally{await handle.dispose();}}
async function restoredGeometry(name,title){
 const heading=page.getByRole('heading',{name:`Quotation · ${title}`,exact:true});await focused(heading);
 const field=page.getByLabel('Description / itinerary',{exact:true});const hb=await heading.boundingBox(),fb=await field.boundingBox(),height=await page.evaluate(()=>innerHeight);
 assert(hb&&fb&&hb.y>=64&&fb.y>=64&&hb.y+hb.height<=height&&fb.y+fb.height<=height,'Restore focuses visible heading and first field without scripted scroll');
 let reached=false;for(let i=0;i<=12;i++){if(await field.evaluate(node=>document.activeElement===node)){reached=true;break;}if(i<12)await page.keyboard.press('Tab');}assert(reached,'Real Tab reaches restored description');
 const geometry=await field.evaluate(node=>{const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,hit:hit===node,focused:document.activeElement===node};});
 assert(geometry.left>=0&&geometry.right<=geometry.width&&geometry.top>=64&&geometry.bottom<=geometry.height&&geometry.hit&&geometry.focused,'Restored keyboard field is wholly visible and unobscured');report.scenarios.push({name,geometry});await screenshot(name);
}
await withFixtureCleanup(async()=>{try{await within((async()=>{
 for(let i=0;i<160;i++){assert(!spawnError&&server.exitCode===null&&server.signalCode===null,`Owned server exited: ${spawnError}\n${logs}`);if(logs.includes('VISUAL REVIEW READY')&&fs.existsSync(metadata)){fixture=JSON.parse(fs.readFileSync(metadata,'utf8'));break;}await new Promise(resolve=>setTimeout(resolve,500));}assert(fixture&&fixture.base===base&&Number.isInteger(fixture.serverPid));
 assert(fixture.runtime.startsWith(path.resolve('tests/.runtime')+path.sep));db=new PrismaClient({datasources:{db:{url:`file:${path.join(fixture.runtime,'test.db')}`}}});owner=await db.user.findUniqueOrThrow({where:{email:'review@visual.test'}});
 browser=await chromium.launch({headless:true,timeout:30000});report.engine=browser.browserType().name();report.version=browser.version();
 for(const width of [1440,390,320]){
  const s=await start(`navigation-${width}`,width);await back();const response=await forward(s.id);assert.equal(response.status(),200,'Recovery rechecks scoped server record');
  await recoveryState('ready');await page.getByRole('button',{name:'Restore quotation',exact:true}).waitFor();await screenshot(`recovery-ready-${width}`);assert.equal(await page.getByLabel('Description / itinerary',{exact:true}).count(),0,'Cached editor is not restored automatically');assert.equal(s.writes.length,0);
  await page.getByRole('button',{name:`Open enquiry: ${s.title}`,exact:true}).click();await page.getByRole('region',{name:'Selected enquiry',exact:true}).waitFor();await recoveryState('ready');assert(await page.getByRole('button',{name:'Restore quotation',exact:true}).isEnabled(),'Selecting an enquiry preserves a reachable recovery action');
  await page.getByRole('button',{name:'Restore quotation',exact:true}).click();assert.equal(await page.getByLabel('Description / itinerary',{exact:true}).inputValue(),s.secret,'Immediate Back retains the last typed character');assert.equal(await page.getByLabel('Price per unit (INR)',{exact:true}).inputValue(),'25000');assert.equal(s.writes.length,0,'Restore never submits a quotation');await restoredGeometry(`restored-${width}`,s.title);
  const storage=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));assert(!storage.includes(s.secret),'Draft remains memory-only');
  await back();await forward(s.id);await recoveryState('ready');await page.getByRole('button',{name:'Restore quotation',exact:true}).waitFor();await confirmClick(page.getByRole('button',{name:'Discard saved draft',exact:true}),'Discard this unsaved quotation copy? This cannot be undone.');await page.getByText('Recover an unsaved quotation',{exact:true}).waitFor({state:'hidden'});await back();await page.goForward({waitUntil:'domcontentloaded'});await page.waitForURL('**/sales');await page.getByRole('button',{name:`Open enquiry: ${s.title}`,exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Restore quotation',exact:true}).count(),0,'Explicit discard clears recovery');assert.equal(s.writes.length,0);await within(s.context.close(),3000,'context close');
 }
 // A complete server revision fingerprint must detect a competing quotation while this draft is away.
 {
  const s=await start('stale');const original=await fresh(s.context,s.id);await back();await api(s.context,'/api/sales','POST',{action:'quote',leadId:s.id,baseRevision:original.lead.baseRevision,items:[{description:'A competing staff quote',quantity:1,priceMinor:3200000,costMinor:2800000}],terms:'Synthetic competing version',expiresAt:'2099-12-01T12:00:00.000Z'});const response=await forward(s.id);assert.equal(response.status(),200);assert.notEqual((await response.json()).lead.baseRevision,original.lead.baseRevision);
  await recoveryState('stale');await page.getByText('The enquiry or a quotation changed while you were away. Your old copy is read-only and cannot overwrite the latest version.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Restore quotation',exact:true}).count(),0,'Changed server version must not offer editable restore');assert.equal(s.writes.length,0);await screenshot('stale-read-only');await within(s.context.close(),3000,'stale context close');
 }
 // A validation race after editable restore is rejected atomically, not treated as a successful draft save.
 {
  const s=await start('revision-conflict');await back();await forward(s.id);await recoveryState('ready');await page.getByRole('button',{name:'Restore quotation',exact:true}).click();await page.getByLabel('Description / itinerary',{exact:true}).waitFor();
  const current=await fresh(s.context,s.id);await api(s.context,'/api/sales','POST',{action:'quote',leadId:s.id,baseRevision:current.lead.baseRevision,items:[{description:'Competing saved version',quantity:1,priceMinor:3000000,costMinor:2500000}],terms:'Synthetic competing version',expiresAt:'2099-12-01T12:00:00.000Z'});
  const rejected=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/sales'&&response.request().method()==='POST',{timeout:15000});await page.getByRole('button',{name:'Save draft version',exact:true}).click();const response=await rejected;assert.equal(response.status(),409);assert.equal((await response.json()).code,'QUOTE_REVISION_CONFLICT');await recoveryState('stale');assert.equal(await page.getByRole('button',{name:'Restore quotation',exact:true}).count(),0);assert.equal(await db.salesQuote.count({where:{leadId:s.id}}),1);assert.equal(s.writes.filter(action=>action==='quote').length,1);await screenshot('revision-conflict-read-only');await within(s.context.close(),3000,'conflict context close');
 }
 // A failed access check reveals no retained text and cannot enable restore until a real successful retry.
 {
  const s=await start('unavailable');await back();await page.route('**/api/sales?leadId=*',route=>route.abort('failed'));await page.goForward({waitUntil:'domcontentloaded'});await page.waitForURL('**/sales');await recoveryState('unavailable');await noCachedText(s.secret);assert.equal(await page.getByRole('button',{name:'Restore quotation',exact:true}).count(),0);await screenshot('recovery-check-unavailable');await page.unroute('**/api/sales?leadId=*');await page.getByRole('button',{name:'Retry recovery check',exact:true}).click();await recoveryState('ready');assert.equal(s.writes.length,0);await within(s.context.close(),3000,'unavailable context close');
 }
 // Normal-list failure must not strand retained memory: the explicit reload also rechecks recovery.
 {
  const s=await start('initial-read-failure');await back();
  await page.route('**/api/sales',route=>route.request().method()==='GET'?route.abort('failed'):route.fallback());
  await page.goForward({waitUntil:'domcontentloaded'});await page.waitForURL('**/sales');await page.getByText('Enquiries could not be loaded. Retry to see the latest records.',{exact:true}).waitFor();await noCachedText(s.secret);assert.equal(await page.getByRole('button',{name:'Restore quotation',exact:true}).count(),0);
  await page.unroute('**/api/sales');const checked=page.waitForResponse(response=>new URL(response.url()).searchParams.get('leadId')===s.id&&response.request().method()==='GET',{timeout:15000});await page.getByRole('button',{name:'Reload latest status',exact:true}).click();assert.equal((await checked).status(),200);await recoveryState('ready');await page.getByRole('button',{name:'Restore quotation',exact:true}).click();assert.equal(await page.getByLabel('Description / itinerary',{exact:true}).inputValue(),s.secret);assert.equal(s.writes.length,0,'Failed read and explicit recovery never submit');await screenshot('initial-read-recovered');await within(s.context.close(),3000,'read-failure context close');
 }
 // Changing the cookie without remounting the authenticated layout simulates another-tab sign-in.
 {
  await db.user.create({data:{employeeCode:'RECOVERY-OTHER',name:'Other synthetic owner',email:'other@visual.test',phone:'',passwordHash:owner.passwordHash,roleId:owner.roleId,branchId:owner.branchId}});
  for(const email of ['review@visual.test','other@visual.test']){
  const s=await start(email==='review@visual.test'?'new-session':'new-identity');await back();await api(s.context,'/api/auth/login','POST',{email,password:'Review-Visual-2026!'});await forward(s.id,false);await boundarySettled();await noCachedText(s.secret);assert.equal(await page.getByRole('button',{name:'Restore quotation',exact:true}).count(),0,'New session cannot inherit the old session draft');assert.equal(s.writes.length,0);report.scenarios.push({name:'session-boundary',passed:true});await within(s.context.close(),3000,'identity context close');}
 }
 {
  const s=await start('scope');await back();const branch=await db.branch.create({data:{code:'RECOVERY-OUT',name:'Synthetic other branch',city:'Test'}});const role=await db.role.findUniqueOrThrow({where:{key:'BRANCH_MANAGER'}});
  try{await db.user.update({where:{id:owner.id},data:{roleId:role.id,branchId:branch.id}});await forward(s.id,false);const denied=await s.context.request.get(base+`/api/sales?leadId=${s.id}`,{timeout:15000});assert([403,404].includes(denied.status()),'Lost record scope is denied');await boundarySettled();await noCachedText(s.secret);assert.equal(await page.getByRole('button',{name:'Restore quotation',exact:true}).count(),0);assert.equal(s.writes.length,0);report.scenarios.push({name:'scope-denial',passed:true});}
  finally{await db.user.update({where:{id:owner.id},data:{roleId:owner.roleId,branchId:owner.branchId}});await within(s.context.close(),3000,'scope context close');}
 }
 // Successful save clears the retained copy. Navigating back must not offer duplicate submission.
 {
  const s=await start('saved');await page.getByRole('button',{name:'Save draft version',exact:true}).click();await page.getByRole('region',{name:'Selected enquiry',exact:true}).getByText('Staff-only draft. Not shared with the customer or published in the package catalogue.',{exact:true}).waitFor();assert.equal(await db.salesQuote.count({where:{leadId:s.id}}),1);await back();await page.goForward({waitUntil:'domcontentloaded'});await page.waitForURL('**/sales');await page.getByRole('button',{name:`Open enquiry: ${s.title}`,exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Restore quotation',exact:true}).count(),0);assert.equal(s.writes.filter(action=>action==='quote').length,1);await within(s.context.close(),3000,'saved context close');
 }
 // Failure after the server commits is an unknown outcome, not permission to retry on remount.
 {
  const s=await start('unknown');let release;const held=new Promise(resolve=>release=resolve);let committed;const committedPromise=new Promise(resolve=>committed=resolve);
  await page.route('**/api/sales',async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON()?.action==='quote'){const response=await route.fetch({timeout:15000});assert.equal(response.status(),200);committed();await within(held,30000,'held quote response');await route.abort('failed').catch(()=>{});}else await route.fallback();});
  await page.getByRole('button',{name:'Save draft version',exact:true}).click();await within(committedPromise,15000,'server quote commit');await back();await forward(s.id);await recoveryState('pending');await page.getByText('The previous quotation save is still pending. Do not submit again. Wait for its outcome and review the latest enquiry.',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'Discard saved draft',exact:true}).isDisabled(),'Pending request cannot be discarded to enable a duplicate save');assert.equal(s.writes.filter(action=>action==='quote').length,1);release();await recoveryState('unknown');await page.getByText('The previous save outcome is unknown. It may have completed. This copy cannot be restored or resubmitted; review the latest enquiry before discarding it.',{exact:true}).waitFor();
  assert.equal(await db.salesQuote.count({where:{leadId:s.id}}),1);assert.equal(s.writes.filter(action=>action==='quote').length,1,'Pending/unknown navigation never retries POST');assert.equal(await page.getByRole('button',{name:'Restore quotation',exact:true}).count(),0,'Uncertain save cannot restore an editable duplicate');await screenshot('unknown-outcome');await page.getByRole('button',{name:'Review latest enquiry',exact:true}).click();await page.getByRole('region',{name:'Selected enquiry',exact:true}).getByText('Staff-only draft. Not shared with the customer or published in the package catalogue.',{exact:true}).waitFor();assert.equal(s.writes.filter(action=>action==='quote').length,1,'Explicit reconciliation reads but never retries');await page.unroute('**/api/sales');await within(s.context.close(),3000,'unknown context close');
 }
 // Non-quote saves keep their provider-owned unknown-outcome lock across Activity/remounts.
 for(const timing of ['while-away','after-forward','malformed-while-away']) {
  const s=await start(`unknown-enquiry-create-${timing}`);
  await confirmClick(page.getByRole('button',{name:'New enquiry',exact:true}),'Discard unsaved changes to this enquiry?');
  const title=`Synthetic hidden unknown enquiry create ${timing}`;
  if(timing==='after-forward') {
   await page.getByLabel('Search enquiries',{exact:true}).fill('Unrelated old search');await page.getByRole('button',{name:'Search all enquiries',exact:true}).click();
   await page.getByText('Search updated across all enquiries in your permitted scope.',{exact:true}).waitFor();await page.getByRole('button',{name:'New enquiry',exact:true}).click();
  }
  await page.getByLabel('Customer',{exact:true}).selectOption(fixture.customerId);
  await page.getByLabel('Enquiry title',{exact:true}).fill(title);await page.getByLabel('Source',{exact:true}).fill('Synthetic lifecycle review');
  let release,committed;const held=new Promise(resolve=>release=resolve),commit=new Promise(resolve=>committed=resolve);
  await page.route('**/api/sales',async route=>{
   if(route.request().method()!=='POST'||route.request().postDataJSON()?.action!=='create')return route.fallback();
   const response=await route.fetch({timeout:15000});assert(response.ok());committed();await within(held,30000,'held unknown enquiry response');
   return timing==='malformed-while-away'?route.fulfill({status:200,contentType:'application/json',json:{}}):route.fulfill({status:503,contentType:'application/json',json:{error:'Synthetic lost acknowledgement'}});
  });
  try {
   await page.getByRole('button',{name:'Save enquiry',exact:true}).click();await within(commit,15000,'unknown enquiry commit');await back();
   if(timing==='after-forward') {
    await forward(s.id,false);await page.locator('[data-sales-action-state="submitting"]').waitFor();
    assert(await page.getByRole('button',{name:'New enquiry',exact:true}).isDisabled(),'Pending non-quote writes remain locked after returning');
   }
   const delivered=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/sales'&&response.request().method()==='POST');
   release();await (await delivered).finished();if(timing!=='after-forward')await forward(s.id,false);
   await page.getByText('The save outcome is unknown. It may have completed. Do not submit again; reload latest status and review the enquiry before continuing.',{exact:true}).waitFor();
   assert(await page.getByRole('button',{name:'New enquiry',exact:true}).isDisabled(),'Hidden non-quote failure retains uncertainty barrier');
   assert.equal(await db.salesLead.count({where:{title}}),1);assert.equal(s.writes.filter(action=>action==='create').length,1);
   await page.getByRole('button',{name:'Reload latest status',exact:true}).click();
   await page.getByText('Latest records loaded. Review the enquiry and quote versions before making another change.',{exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'New enquiry',exact:true}).isDisabled(),false,'Only explicit reconciliation ends unknown barrier');
   assert.equal(s.writes.filter(action=>action==='create').length,1,'Reconciliation never retries create');
   assert.equal(await page.getByLabel('Search enquiries',{exact:true}).inputValue(),'','Unknown-create reconciliation clears old filters');
   await page.getByRole('button',{name:`Open enquiry: ${title}`,exact:true}).waitFor();
   report.scenarios.push({name:`non-quote-unknown-${timing}-remains-locked`,passed:true});
  } catch(error) {
   report.failure=String(error);report.nonQuoteState=await page.evaluate(()=>({url:location.pathname,states:[...document.querySelectorAll('[data-sales-action-state]')].map(node=>node.getAttribute('data-sales-action-state')),alerts:[...document.querySelectorAll('[role="alert"]')].map(node=>node.textContent),newEnquiry:[...document.querySelectorAll('button')].filter(node=>node.textContent?.trim()==='New enquiry').map(node=>({disabled:node.disabled}))})).catch(()=>null);persist();
   await within(page.screenshot({path:path.join(out,`non-quote-${timing}-failure.png`),timeout:3000,mask:[page.locator('#sales-private-link')]}),3500,'non-quote failure screenshot').catch(()=>{});throw error;
  } finally { release();await page.unroute('**/api/sales');await within(s.context.close(),3000,'unknown enquiry context close'); }
 }
 // A one-time private link delivered after leaving its activation must never reappear on return.
 {
  const s=await start('late-publish');await page.getByRole('button',{name:'Save draft version',exact:true}).click();await page.getByRole('region',{name:'Selected enquiry',exact:true}).getByText('Staff-only draft. Not shared with the customer or published in the package catalogue.',{exact:true}).waitFor();
  let release,committed;const held=new Promise(resolve=>release=resolve),commit=new Promise(resolve=>committed=resolve);
  await page.route('**/api/sales',async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON()?.action==='publish'){const response=await route.fetch({timeout:15000});assert.equal(response.status(),200);committed();await within(held,30000,'held publish response');await route.fulfill({response});}else await route.fallback();});
  let caseFailure;
  try{
   await confirmClick(page.getByRole('button',{name:'Publish private proposal',exact:true}),'Publish this private proposal? Any earlier published proposal link will stop working.');await within(commit,15000,'server publish commit');await back();await forward(s.id,false);await page.getByRole('button',{name:`Open enquiry: ${s.title}`,exact:true}).waitFor();
   assert.equal(await page.getByRole('region',{name:'Private proposal link',exact:true}).count(),0);
   const delivered=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/sales'&&response.request().method()==='POST'&&response.request().postDataJSON()?.action==='publish',{timeout:15000});
   release();const publishResponse=await delivered;assert.equal(publishResponse.status(),200);assert.equal(await within(publishResponse.finished(),15000,'delivered publish response'),null);
   await page.locator('[data-sales-action-state="acknowledged"]').waitFor();
   assert(await page.getByRole('button',{name:'New enquiry',exact:true}).isDisabled(),'Departed acknowledged write remains locked until explicit review');
   assert.equal(await page.getByRole('region',{name:'Private proposal link',exact:true}).count(),0);
   const refreshed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/sales'&&response.request().method()==='GET',{timeout:15000});
   await page.getByRole('button',{name:'Reload latest status',exact:true}).click();const currentRead=await refreshed;
   assert.equal(currentRead.status(),200);assert.equal(await within(currentRead.finished(),15000,'explicit record read'),null);
   // Explicit review now opens the action's exact scoped record directly. It must not return
   // to a first-page list and require a second selection (the record may be off that page).
   await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(node=>node.textContent?.trim()==='New enquiry'&&!node.disabled),undefined,{timeout:15000});
   const selected=page.getByRole('region',{name:'Selected enquiry',exact:true});
   report.latePublishReview={publishedQuotes:await db.salesQuote.count({where:{leadId:s.id,state:'PUBLISHED'}}),publishRequests:s.writes.filter(action=>action==='publish').length,privateLinkRegions:await page.getByRole('region',{name:'Private proposal link',exact:true}).count(),privateLinkInputs:await page.getByLabel('Private proposal link',{exact:true}).count()};persist();
   assert.deepEqual(report.latePublishReview,{publishedQuotes:1,publishRequests:1,privateLinkRegions:0,privateLinkInputs:0},'Explicit scoped review never republishes or reveals a departed capability');
   await selected.getByRole('heading',{name:s.title,exact:true}).waitFor();
   await selected.getByRole('heading',{name:'Quote v1 · Published',exact:true}).waitFor();
   await selected.getByText('Private customer proposal. Accessible through its private link, not the public package catalogue.',{exact:true}).waitFor();
   await selected.getByRole('complementary',{name:'Private link guidance for quote v1',exact:true}).getByText('Earlier links cannot be retrieved. Losing a link does not withdraw the proposal.',{exact:true}).waitFor();
   assert.equal(await page.getByRole('region',{name:'Private proposal link',exact:true}).count(),0,'Late private link is not revealed in another activation');assert.equal(await page.getByLabel('Private proposal link',{exact:true}).count(),0);assert.equal(await db.salesQuote.count({where:{leadId:s.id,state:'PUBLISHED'}}),1);assert.equal(s.writes.filter(action=>action==='publish').length,1,'Navigation never republishes');report.scenarios.push({name:'late-publish-link-withheld',passed:true});await screenshot('late-publish-withheld');
   // An ordinary full reload of /sales (no lead query) still starts in the list.
   await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:`Open enquiry: ${s.title}`,exact:true}).click();
   const guidance=page.getByRole('complementary',{name:'Private link guidance for quote v1',exact:true});
   await guidance.getByText('Earlier links cannot be retrieved. Losing a link does not withdraw the proposal.',{exact:true}).waitFor();
   assert.equal(await guidance.locator('details').getAttribute('open'),null,'Long recovery guidance starts collapsed');
   assert.equal(await page.getByLabel('Private proposal link',{exact:true}).count(),0,'Reload never retrieves a raw proposal token');
   assert.equal(s.writes.filter(action=>action==='publish').length,1,'Guidance/reload never republishes');
   await page.getByRole('complementary',{name:'Private link guidance for quote v1',exact:true}).scrollIntoViewIfNeeded();
   await screenshot('private-link-after-reload-390');
   const details=guidance.locator('summary');await details.focus();await page.keyboard.press('Enter');
   await guidance.getByText(/Publishing it invalidates earlier published links; saving a draft does not/).waitFor();
   const writesBefore=s.writes.length;
   await guidance.getByRole('button',{name:'Prepare replacement draft',exact:true}).click();
   await page.getByRole('heading',{name:`Quotation · ${s.title}`,exact:true}).waitFor();
   assert.equal(s.writes.length,writesBefore,'Preparing a replacement only opens an editor, never saves/publishes');
   await page.getByRole('button',{name:'Close quotation',exact:true}).click();
   const current=await fresh(s.context,s.id);
   await api(s.context,'/api/sales','POST',{action:'quote',leadId:s.id,baseRevision:current.lead.baseRevision,items:[{description:'Synthetic replacement draft',quantity:1,priceMinor:2500000,costMinor:0}],terms:'Synthetic terms',expiresAt:'2099-12-01T12:00:00.000Z'});
   await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:`Open enquiry: ${s.title}`,exact:true}).click();
   await page.getByRole('complementary',{name:'Private link guidance for quote v1',exact:true}).getByRole('button',{name:'Review latest draft',exact:true}).click();
   await focused(page.getByRole('heading',{name:'Quote v2 · Draft',exact:true}));
   assert.equal(s.writes.length,writesBefore,'Review latest draft never publishes, saves or withdraws');


  }catch(error){caseFailure=error;report.failure=String(error);persist();await within(page.screenshot({path:path.join(out,'late-publish-failure.png'),timeout:3000,mask:[page.locator('#sales-private-link')]}),3000,'late publish failure screenshot').catch(()=>{});throw error;
  }finally{release();try{await within(page.unroute('**/api/sales'),3000,'publish route cleanup');await within(s.context.close(),3000,'publish context close');}catch(error){if(caseFailure){report.cleanupFailure=String(error);persist();}else throw error;}}
 }
 // Customer creation stays inside the enquiry. Only an explicit enquiry save writes the enquiry.
 {
  const s=await start('customer-prerequisite',320);
  await page.getByRole('button',{name:'Save draft version',exact:true}).click();
  await page.getByRole('region',{name:'Selected enquiry',exact:true}).getByText('Staff-only draft. Not shared with the customer or published in the package catalogue.',{exact:true}).waitFor();
  let verificationFailures=1;
  await page.route('**/api/sales*',async route=>{
   const url=new URL(route.request().url());
   if(route.request().method()==='GET'&&url.searchParams.has('customerId')&&verificationFailures-- >0) return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic read unavailable'})});
   if(route.request().method()==='GET'&&!url.searchParams.has('customerId')&&!url.searchParams.has('customers')){const response=await route.fetch({timeout:15000});const data=await response.json();return route.fulfill({response,json:{...data,customers:[]}});}
   return route.fallback();
  });
  await page.getByRole('button',{name:'Refresh records',exact:true}).click();await page.getByRole('button',{name:'New enquiry',exact:true}).click();
  const prerequisite=page.getByRole('region',{name:'Customer needed before enquiry',exact:true});await prerequisite.waitFor();
  assert.equal(await prerequisite.locator('details').getAttribute('open'),null);
  const values={'Enquiry title':'Unsaved prerequisite fixture','Source':'Synthetic review','Destination / route':'Kerala','Travel date':'2099-12-01','Follow-up deadline':'2099-11-01T12:30','Budget (INR)':'45000.50','Notes':'PRIVATE enquiry notes preserved in-flow only'};
  for(const [label,value] of Object.entries(values))await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByLabel('Product',{exact:true}).selectOption('HOTEL');
  const checkFields=async()=>{for(const [label,value] of Object.entries(values))assert.equal(await page.getByLabel(label,{exact:true}).inputValue(),value);assert.equal(await page.getByLabel('Product',{exact:true}).inputValue(),'HOTEL');assert.equal(new URL(page.url()).pathname,'/sales');};
  const add=page.getByRole('button',{name:'Add customer here',exact:true});await add.click();
  let customerDialog=page.getByRole('dialog',{name:'Add customer for this enquiry',exact:true});await customerDialog.waitFor();
  await page.keyboard.press('Escape');await customerDialog.waitFor({state:'hidden'});await focused(add);await checkFields();
  await add.click();customerDialog=page.getByRole('dialog',{name:'Add customer for this enquiry',exact:true});
  await customerDialog.getByLabel('Full name',{exact:true}).fill('Discarded synthetic customer details');
  let cancelMessage='';page.once('dialog',dialog=>{cancelMessage=dialog.message();void dialog.dismiss();});await page.keyboard.press('Escape');
  assert.equal(cancelMessage,'Discard the unsaved customer details? Your enquiry fields will stay here.');assert(await customerDialog.isVisible());
  await confirmClick(customerDialog.getByRole('button',{name:'Cancel customer',exact:true}),'Discard the unsaved customer details? Your enquiry fields will stay here.');await customerDialog.waitFor({state:'hidden'});await checkFields();
  await prerequisite.scrollIntoViewIfNeeded();await screenshot('customer-prerequisite-320');
  await add.click();customerDialog=page.getByRole('dialog',{name:'Add customer for this enquiry',exact:true});
  assert.equal(await customerDialog.getByLabel('Full name',{exact:true}).inputValue(),'');
  const customerName='Flow prerequisite fixture customer';await customerDialog.getByLabel('Full name',{exact:true}).fill(customerName);await customerDialog.getByLabel('Phone',{exact:true}).fill('9000000137');
  let customerPosts=0,release,committed;const held=new Promise(resolve=>release=resolve),commit=new Promise(resolve=>committed=resolve);
  await page.route('**/api/customers',async route=>{if(route.request().method()==='POST'){customerPosts++;const response=await route.fetch({timeout:15000});committed();await within(held,30000,'held customer response');return route.fulfill({response});}return route.fallback();});
  try{
   await customerDialog.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});await within(commit,15000,'customer create commit');
   assert.equal(customerPosts,1,'Synchronous repeated submission cannot create a duplicate customer');assert(await customerDialog.getByRole('button',{name:'Cancel customer',exact:true}).isDisabled());
   await page.keyboard.press('Escape');assert(await customerDialog.isVisible(),'Pending customer cannot be dismissed');release();
   await customerDialog.getByText(/The customer was created, but its current access could not be verified/).waitFor();
   assert.equal(await customerDialog.getByRole('button',{name:'Create & select customer',exact:true}).count(),0);
   await customerDialog.getByRole('button',{name:'Check saved customer',exact:true}).click();await customerDialog.waitFor({state:'hidden'});
   assert.equal(customerPosts,1,'Acknowledged create with failed read only retries GET');
  }finally{release();await page.unroute('**/api/customers');}
  await checkFields();const picker=page.getByLabel('Customer',{exact:true});const selectedCustomer=await picker.inputValue();assert(selectedCustomer);assert.match(await picker.locator('option:checked').innerText(),new RegExp(customerName));
  await page.getByLabel('Find a customer',{exact:true}).fill('No matching customer fixture');await page.getByRole('button',{name:'Search customers',exact:true}).click();
  await page.getByText('Showing 0 customer matches for “No matching customer fixture”. Search by name or code for another customer. Your selected customer stays selected when you search.',{exact:true}).waitFor();
  assert.equal(await picker.inputValue(),selectedCustomer,'Searching never drops the selected customer');await checkFields();
  assert(await page.evaluate(secret=>![...Object.values(localStorage),...Object.values(sessionStorage)].some(value=>value.includes(secret)),values.Notes),'No enquiry PII persisted in local/session storage');
  assert.equal(s.writes.filter(action=>action==='create').length,0,'Customer detour never creates an enquiry');
  await page.getByRole('button',{name:'Save enquiry',exact:true}).click();await page.getByRole('heading',{name:values['Enquiry title'],exact:true}).waitFor();
  assert.equal(s.writes.filter(action=>action==='create').length,1,'Only explicit Save enquiry writes it');
  const saved=await db.salesLead.findFirstOrThrow({where:{title:values['Enquiry title'],customerId:selectedCustomer}});assert.equal(saved.notes,values.Notes);assert.equal(saved.budgetMinor,4500050);
  await page.unroute('**/api/sales*');
  report.scenarios.push({name:'in-flow-customer-cancel-repeat-unknown-read-preserves-enquiry',passed:true});
  await within(s.context.close(),3000,'prerequisite context close');
 }
 // A newer picker access boundary must defeat an older, permitted parent Refresh response.
 for(const boundary of ['denied','changed-context']) {
  const s=await start(`customer-parent-read-${boundary}`,390);
  await confirmClick(page.getByRole('button',{name:'New enquiry',exact:true}),'Discard unsaved changes to this enquiry?');
  let releaseParent,releasePicker,parentCaptured,pickerCaptured;
  const parentHeld=new Promise(resolve=>releaseParent=resolve),pickerHeld=new Promise(resolve=>releasePicker=resolve);
  const capturedParent=new Promise(resolve=>parentCaptured=resolve),capturedPicker=new Promise(resolve=>pickerCaptured=resolve);
  await page.route('**/api/sales*',async route=>{
   const url=new URL(route.request().url());if(route.request().method()!=='GET')return route.fallback();
   if(url.searchParams.has('customers')) {
    const response=await route.fetch({timeout:15000});assert(response.ok());const body=await response.json();pickerCaptured();
    await within(pickerHeld,30000,'held newer picker boundary');
    return boundary==='denied'?route.fulfill({status:403,contentType:'application/json',json:{error:'Synthetic access boundary'}}):route.fulfill({response,json:{...body,recoveryContext:'0'.repeat(64)}});
   }
   const response=await route.fetch({timeout:15000});assert(response.ok());parentCaptured();
   await within(parentHeld,30000,'held older permitted parent read');return route.fulfill({response});
  });
  try {
   await page.getByLabel('Find a customer',{exact:true}).fill('Fixture');await page.getByRole('button',{name:'Search customers',exact:true}).click();
   await within(capturedPicker,15000,'picker request captured');
   await page.getByRole('button',{name:'Refresh records',exact:true}).click();await within(capturedParent,15000,'permitted parent response captured');
   releasePicker();await page.getByRole('button',{name:'Reload workspace',exact:true}).waitFor();
   const delivered=page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/sales'&&!url.searchParams.has('customers')&&response.request().method()==='GET';});
   releaseParent();await (await delivered).finished();
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await page.getByRole('alert').getByText('Staff session or access changed. Reload this workspace before continuing.',{exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Reload workspace',exact:true}).count(),1);
   assert.equal(await page.getByRole('button',{name:'New enquiry',exact:true}).count(),0,'Old parent result cannot re-authorize create');
   assert.equal(await page.getByLabel('Search enquiries',{exact:true}).count(),0,'Old parent data remains cleared');
   assert.equal(await page.getByRole('region',{name:'Quotation recovery',exact:true}).count(),0);
   assert.equal(await page.getByText('Loading your enquiries…',{exact:true}).count(),0,'Boundary ends obsolete loading state');
   await noCachedText(s.title);await noCachedText(s.secret);assert.equal(s.writes.length,0,'Concurrent reads never write');
   report.scenarios.push({name:`newer-picker-${boundary}-defeats-held-parent-response`,passed:true});await screenshot(`picker-parent-boundary-${boundary}`);
  } finally { releaseParent();releasePicker();await page.unroute('**/api/sales*');await within(s.context.close(),3000,'picker parent boundary context close'); }
 }
 // Discovery searches the complete permitted dataset, not only the first display page.
 {
  const s=await start('bounded-discovery',390);
  await page.getByRole('button',{name:'Save draft version',exact:true}).click();
  await page.getByRole('region',{name:'Selected enquiry',exact:true}).getByText('Staff-only draft. Not shared with the customer or published in the package catalogue.',{exact:true}).waitFor();
  const source=await db.salesLead.findUniqueOrThrow({where:{id:s.id}});
  await db.salesLead.createMany({data:Array.from({length:221},(_,index)=>({id:`browser-discovery-${String(index).padStart(3,'0')}`,customerId:source.customerId,branchId:source.branchId,ownerId:source.ownerId,title:`Discovery bounded fixture ${String(index).padStart(3,'0')}`,source:'Synthetic browser fixture',createdAt:new Date(Date.UTC(2021,0,1,0,0,index))}))});
  const list=page.getByRole('region',{name:'Enquiry list',exact:true});
  const search=async text=>{await page.getByLabel('Search enquiries',{exact:true}).fill(text);await page.getByRole('button',{name:'Search all enquiries',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#sales-list-status')?.textContent?.includes('Changed filters are not applied')===false);};
  await search('Discovery bounded fixture');assert.equal(await list.getByRole('button',{name:/^Open enquiry:/}).count(),50);
  for(const expected of [100,150,200,221]){
   await page.getByRole('button',{name:'Load more enquiries',exact:true}).click();
   await page.waitForFunction(count=>document.querySelectorAll('.sales-list button[id^="sales-open-"]').length===count,expected);
   await page.waitForFunction(()=>document.activeElement?.id?.startsWith('sales-open-browser-discovery-'));
   assert.equal(await list.getByRole('button',{name:/^Open enquiry:/}).count(),expected);
  }
  assert.equal(await page.getByRole('button',{name:'Load more enquiries',exact:true}).count(),0);
  await page.getByRole('button',{name:'Open enquiry: Discovery bounded fixture 000',exact:true}).click();
  await page.getByRole('button',{name:'Refresh records',exact:true}).click();
  await page.getByRole('region',{name:'Selected enquiry',exact:true}).getByRole('heading',{name:'Discovery bounded fixture 000',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.sales-list button[id^="sales-open-"]').length===50);
  assert.equal(await page.locator('#sales-open-browser-discovery-000').count(),0,'Selected old record is refreshed by ID without polluting first search page');
  await search('Discovery bounded fixture 000');assert.equal(await list.getByRole('button',{name:/^Open enquiry:/}).count(),1);
  await search('no-matching-discovery-fixture');await list.getByText('No matching enquiries',{exact:true}).waitFor();
  await page.getByRole('button',{name:'View selected enquiry',exact:true}).click();assert(await page.getByRole('region',{name:'Selected enquiry',exact:true}).getByRole('heading',{name:'Discovery bounded fixture 000',exact:true}).isVisible(),'Search does not discard the selected enquiry');await page.getByRole('button',{name:'Back to enquiries',exact:true}).click();
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();await page.getByRole('button',{name:`Open enquiry: ${s.title}`,exact:true}).waitFor();
  assert.equal(s.writes.filter(action=>action==='quote').length,1,'Search, load more and refresh never submit');
  report.scenarios.push({name:'bounded-discovery-all-pages-old-search-selected-refresh-keyboard',passed:true});await screenshot('bounded-discovery-390');
  await within(s.context.close(),3000,'discovery context close');
 }
 // A committed customer write with a lost response never offers a duplicate retry.
 {
  const s=await start('customer-unknown');await page.getByRole('button',{name:'Save draft version',exact:true}).click();await page.getByRole('button',{name:'New enquiry',exact:true}).click();
  await page.getByLabel('Enquiry title',{exact:true}).fill('Preserved after unknown customer result');await page.getByRole('button',{name:'Add customer here',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Add customer for this enquiry',exact:true});const customerName='Unknown outcome synthetic customer';await dialog.getByLabel('Full name',{exact:true}).fill(customerName);await dialog.getByLabel('Phone',{exact:true}).fill('9000000138');
  let writes=0;await page.route('**/api/customers',async route=>{if(route.request().method()==='POST'){writes++;const response=await route.fetch({timeout:15000});assert(response.ok());return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic dropped acknowledgement'})});}return route.fallback();});
  await dialog.getByRole('button',{name:'Create & select customer',exact:true}).click();await dialog.getByText(/The customer save outcome is unknown/).waitFor();
  assert.equal(await dialog.getByRole('button',{name:'Create & select customer',exact:true}).count(),0);await dialog.getByRole('button',{name:'Return to enquiry',exact:true}).click();
  assert.equal(await page.getByLabel('Enquiry title',{exact:true}).inputValue(),'Preserved after unknown customer result');assert(await page.getByRole('button',{name:'Add customer here',exact:true}).isDisabled());
  await page.getByLabel('Find a customer',{exact:true}).fill(customerName);await page.getByRole('button',{name:'Search customers',exact:true}).click();await page.getByLabel('Customer',{exact:true}).getByRole('option',{name:new RegExp(customerName)}).waitFor({state:'attached'});
  assert.equal(writes,1);assert.equal(await db.customer.count({where:{name:customerName}}),1);assert.equal(s.writes.filter(action=>action==='create').length,0);
  report.scenarios.push({name:'unknown-customer-save-search-only-no-repeat',passed:true});await page.unroute('**/api/customers');await within(s.context.close(),3000,'unknown customer context close');

 }
 // The provider owns a customer POST outcome across Activity, not a departed picker callback.
 for(const outcome of ['created-while-away','unknown-after-forward']) {
  const s=await start(`customer-activity-${outcome}`);await page.getByRole('button',{name:'Save draft version',exact:true}).click();await page.getByRole('region',{name:'Selected enquiry',exact:true}).getByText('Staff-only draft. Not shared with the customer or published in the package catalogue.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'New enquiry',exact:true}).click();await page.getByLabel('Enquiry title',{exact:true}).fill(`Unsaved ${outcome}`);await page.getByRole('button',{name:'Add customer here',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Add customer for this enquiry',exact:true});const customerName=`Synthetic Activity ${outcome}`;await dialog.getByLabel('Full name',{exact:true}).fill(customerName);await dialog.getByLabel('Phone',{exact:true}).fill('9000000151');
  let posts=0,release,committed;const held=new Promise(resolve=>release=resolve),commit=new Promise(resolve=>committed=resolve);
  await page.route('**/api/customers',async route=>{if(route.request().method()!=='POST')return route.fallback();posts++;assert.match(route.request().headers()['x-sales-recovery-context'],/^[a-f0-9]{64}$/);const response=await route.fetch({timeout:15000});assert(response.ok());committed();await within(held,30000,'Activity customer response');return outcome==='created-while-away'?route.fulfill({response}):route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic unknown response'})});});
  try {
   await dialog.getByRole('button',{name:'Create & select customer',exact:true}).click();await within(commit,15000,'Activity customer commit');await back();
   if(outcome==='created-while-away') { const delivered=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/customers'&&response.request().method()==='POST');release();await (await delivered).finished(); }
   await forward(s.id,false);
   const review=page.getByRole('region',{name:'Customer save review',exact:true});await review.waitFor();
   if(outcome==='unknown-after-forward') {
    await page.locator('[data-customer-save-state="submitting"]').waitFor();assert(await page.getByRole('button',{name:'New enquiry',exact:true}).isDisabled());
    assert.equal(posts,1);release();await page.locator('[data-customer-save-state="uncertain"]').waitFor();
   } else await page.locator('[data-customer-save-state="created"]').waitFor();
   assert.equal(await page.getByRole('button',{name:'New enquiry',exact:true}).isDisabled(),false,'Settled hidden writes do not strand parent busy/lock');
   await review.getByRole('button',{name:'Review customer in new enquiry',exact:true}).click();assert.equal(await page.getByLabel('Enquiry title',{exact:true}).inputValue(),'','Returning does not expose stale enquiry text');
   assert(await page.getByRole('button',{name:'Add customer here',exact:true}).isDisabled(),'Unreviewed outcome cannot be blindly retried');
   if(outcome==='created-while-away') { await page.getByRole('button',{name:'Check saved customer',exact:true}).click();await page.getByRole('status').filter({hasText:'Customer created and selected.'}).waitFor();assert.match(await page.getByLabel('Customer',{exact:true}).locator('option:checked').innerText(),new RegExp(customerName)); }
   else { await page.getByLabel('Find a customer',{exact:true}).fill(customerName);await page.getByRole('button',{name:'Search customers',exact:true}).click();await page.getByRole('button',{name:'Finish customer review',exact:true}).waitFor();assert(await page.getByRole('button',{name:'Add customer here',exact:true}).isDisabled(),'Search alone cannot silently unlock unknown creation'); }
   assert.equal(posts,1);assert.equal(await db.customer.count({where:{name:customerName}}),1);assert.equal(s.writes.filter(action=>action==='create').length,0);report.scenarios.push({name:`customer-activity-${outcome}`,passed:true});
  } finally { release();await page.unroute('**/api/customers');await within(s.context.close(),3000,'Activity customer context close'); }
 }
 // Full document replacement intentionally ends memory-only recovery.
 {
  const s=await start('reload');await back();await page.reload({waitUntil:'domcontentloaded'});const menu=page.getByRole('button',{name:'Open navigation',exact:true});if(await menu.isVisible())await menu.click();await page.locator('#workspace-navigation').getByRole('link',{name:'Enquiries & quotes',exact:true}).click();await page.waitForURL('**/sales');await page.getByRole('button',{name:`Open enquiry: ${s.title}`,exact:true}).waitFor();await noCachedText(s.secret);assert.equal(await page.getByRole('button',{name:'Restore quotation',exact:true}).count(),0);await within(s.context.close(),3000,'reload context close');
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);report.passed=true;persist();
 })(),480000,'complete draft recovery fixture');}catch(error){report.failure=String(error);persist();if(page)await within(page.screenshot({path:path.join(out,'failure.png'),timeout:3000,mask:[page.locator('#sales-private-link')]}),3000,'failure screenshot').catch(()=>{});throw error;}
},async()=>{persist();const errors=[];if(browser)try{await within(browser.close(),3000,'browser close');}catch(e){errors.push(e);}if(db)try{await within(db.$disconnect(),3000,'database close');}catch(e){errors.push(e);}if(server.pid){const signal=s=>{try{process.kill(-server.pid,s);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};const gone=async ms=>{const end=Date.now()+ms;while(Date.now()<end){if(!signal(0))return;await new Promise(r=>setTimeout(r,100));}if(signal(0))throw Error('Owned fixture process group still alive');};try{if(signal('SIGTERM')){try{await within(gone(3000),3500,'fixture SIGTERM');}catch(e){if(e?.code&&e.code!=='ESRCH')throw e;signal('SIGKILL');await within(gone(2000),2500,'fixture SIGKILL');}}}catch(e){errors.push(e);}}if(errors.length)throw new AggregateError(errors,'Fixture cleanup incomplete');},error=>{report.passed=false;report.cleanupFailure=String(error);persist();});
