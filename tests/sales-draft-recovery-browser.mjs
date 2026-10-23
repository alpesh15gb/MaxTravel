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
   const refreshed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/sales'&&response.request().method()==='GET',{timeout:15000});release();
   const [publishResponse,currentRead]=await Promise.all([delivered,refreshed]);assert.equal(publishResponse.status(),200);assert.equal(await within(publishResponse.finished(),15000,'delivered publish response'),null);
   assert.equal(currentRead.status(),200);assert.equal(await within(currentRead.finished(),15000,'resumed record read'),null);
   // A departed activation's toast is not a contract. Verify the current, freshly read record instead.
   await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(node=>node.textContent?.trim()==='New enquiry'&&!node.disabled),undefined,{timeout:15000});
   await page.getByRole('button',{name:`Open enquiry: ${s.title}`,exact:true}).click();
   const selected=page.getByRole('region',{name:'Selected enquiry',exact:true});
   await selected.getByRole('heading',{name:'Quote v1 · Published',exact:true}).waitFor();
   await selected.getByText('Private customer proposal. Accessible through its private link, not the public package catalogue.',{exact:true}).waitFor();
   await selected.getByRole('complementary',{name:'Private link guidance for quote v1',exact:true}).getByText(/An earlier private link cannot be retrieved here/).waitFor();
   assert.equal(await page.getByRole('region',{name:'Private proposal link',exact:true}).count(),0,'Late private link is not revealed in another activation');assert.equal(await page.getByLabel('Private proposal link',{exact:true}).count(),0);assert.equal(await db.salesQuote.count({where:{leadId:s.id,state:'PUBLISHED'}}),1);assert.equal(s.writes.filter(action=>action==='publish').length,1,'Navigation never republishes');report.scenarios.push({name:'late-publish-link-withheld',passed:true});await screenshot('late-publish-withheld');
   await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:`Open enquiry: ${s.title}`,exact:true}).click();
   await page.getByRole('complementary',{name:'Private link guidance for quote v1',exact:true}).getByText(/Publishing it invalidates earlier published links; saving a draft does not/).waitFor();
   assert.equal(await page.getByLabel('Private proposal link',{exact:true}).count(),0,'Reload never retrieves a raw proposal token');
   assert.equal(s.writes.filter(action=>action==='publish').length,1,'Guidance/reload never republishes');
   await page.getByRole('complementary',{name:'Private link guidance for quote v1',exact:true}).scrollIntoViewIfNeeded();
   await screenshot('private-link-after-reload-390');

  }catch(error){caseFailure=error;report.failure=String(error);persist();await within(page.screenshot({path:path.join(out,'late-publish-failure.png'),timeout:3000,mask:[page.locator('#sales-private-link')]}),3000,'late publish failure screenshot').catch(()=>{});throw error;
  }finally{release();try{await within(page.unroute('**/api/sales'),3000,'publish route cleanup');await within(s.context.close(),3000,'publish context close');}catch(error){if(caseFailure){report.cleanupFailure=String(error);persist();}else throw error;}}
 }
 // Empty customer picker offers a permitted prerequisite route with honest dirty-navigation recovery.
 {
  const s=await start('customer-prerequisite',320);
  await page.getByRole('button',{name:'Save draft version',exact:true}).click();
  await page.getByRole('region',{name:'Selected enquiry',exact:true}).getByText('Staff-only draft. Not shared with the customer or published in the package catalogue.',{exact:true}).waitFor();
  await page.route('**/api/sales',async route=>{if(route.request().method()==='GET'){const response=await route.fetch({timeout:15000});const data=await response.json();await route.fulfill({response,json:{...data,customers:[]}});}else await route.fallback();});
  await page.getByRole('button',{name:'Refresh records',exact:true}).click();await page.getByRole('button',{name:'New enquiry',exact:true}).click();
  const prerequisite=page.getByRole('region',{name:'Customer needed before enquiry',exact:true});await prerequisite.waitFor();
  const action=prerequisite.getByRole('link',{name:'Open Customers to add a customer',exact:true});assert.equal(await action.getAttribute('href'),'/customers');
  assert(await page.getByRole('button',{name:'Save enquiry',exact:true}).isDisabled());
  await page.getByLabel('Enquiry title',{exact:true}).fill('Unsaved prerequisite fixture');
  let dialogMessage='';page.once('dialog',dialog=>{dialogMessage=dialog.message();void dialog.dismiss();});await action.click();
  assert.equal(dialogMessage,'Leave this enquiry? Unsaved changes will be lost.');assert(new URL(page.url()).pathname==='/sales');
  assert.equal(await page.getByLabel('Enquiry title',{exact:true}).inputValue(),'Unsaved prerequisite fixture');
  await prerequisite.scrollIntoViewIfNeeded();await screenshot('customer-prerequisite-320');
  await confirmClick(action,'Leave this enquiry? Unsaved changes will be lost.');await page.waitForURL('**/customers');await page.getByRole('button',{name:'New customer',exact:true}).waitFor();
  assert.equal(s.writes.filter(action=>action==='create').length,0,'Prerequisite route never creates an enquiry');
  await page.unroute('**/api/sales');
  await page.getByRole('button',{name:'New customer',exact:true}).click();
  const customerDialog=page.getByRole('dialog');await customerDialog.getByLabel('Full name *',{exact:true}).fill('Flow prerequisite fixture customer');await customerDialog.getByLabel('Phone *',{exact:true}).fill('9000000137');
  await customerDialog.getByRole('button',{name:'Create customer',exact:true}).click();await page.waitForURL(/\/customers\/[^/?]+$/);
  const menu=page.getByRole('button',{name:'Open navigation',exact:true});if(await menu.isVisible())await menu.click();
  await page.locator('#workspace-navigation').getByRole('link',{name:'Enquiries & quotes',exact:true}).click();await page.waitForURL('**/sales');
  await page.getByRole('button',{name:'New enquiry',exact:true}).click();
  assert.equal(await page.getByLabel('Enquiry title',{exact:true}).inputValue(),'','Prior new-enquiry fields are not silently restored');
  const picker=page.getByLabel('Customer',{exact:true});await picker.getByRole('option',{name:/Flow prerequisite fixture customer/}).waitFor({state:'attached'});
  assert.equal(await page.getByRole('region',{name:'Customer needed before enquiry',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Save enquiry',exact:true}).isDisabled(),false);
  report.scenarios.push({name:'empty-customer-prerequisite-dirty-cancel-create-return',passed:true});
  await within(s.context.close(),3000,'prerequisite context close');
 }
 // Full document replacement intentionally ends memory-only recovery.
 {
  const s=await start('reload');await back();await page.reload({waitUntil:'domcontentloaded'});const menu=page.getByRole('button',{name:'Open navigation',exact:true});if(await menu.isVisible())await menu.click();await page.locator('#workspace-navigation').getByRole('link',{name:'Enquiries & quotes',exact:true}).click();await page.waitForURL('**/sales');await page.getByRole('button',{name:`Open enquiry: ${s.title}`,exact:true}).waitFor();await noCachedText(s.secret);assert.equal(await page.getByRole('button',{name:'Restore quotation',exact:true}).count(),0);await within(s.context.close(),3000,'reload context close');
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);report.passed=true;persist();
 })(),480000,'complete draft recovery fixture');}catch(error){report.failure=String(error);persist();if(page)await within(page.screenshot({path:path.join(out,'failure.png'),timeout:3000,mask:[page.locator('#sales-private-link')]}),3000,'failure screenshot').catch(()=>{});throw error;}
},async()=>{persist();const errors=[];if(browser)try{await within(browser.close(),3000,'browser close');}catch(e){errors.push(e);}if(db)try{await within(db.$disconnect(),3000,'database close');}catch(e){errors.push(e);}if(server.pid){const signal=s=>{try{process.kill(-server.pid,s);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};const gone=async ms=>{const end=Date.now()+ms;while(Date.now()<end){if(!signal(0))return;await new Promise(r=>setTimeout(r,100));}if(signal(0))throw Error('Owned fixture process group still alive');};try{if(signal('SIGTERM')){try{await within(gone(3000),3500,'fixture SIGTERM');}catch(e){if(e?.code&&e.code!=='ESRCH')throw e;signal('SIGKILL');await within(gone(2000),2500,'fixture SIGKILL');}}}catch(e){errors.push(e);}}if(errors.length)throw new AggregateError(errors,'Fixture cleanup incomplete');},error=>{report.passed=false;report.cleanupFailure=String(error);persist();});
