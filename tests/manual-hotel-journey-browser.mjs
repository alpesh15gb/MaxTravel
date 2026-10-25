// Contiguous real UI journey. Disposable SQLite only; no real customers, provider calls or delivery.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {chromium} from './browser.mjs';
import {within,withFixtureCleanup} from './fixture-lifecycle.mjs';
const port=3401,base=`http://127.0.0.1:${port}`,out=path.resolve('test-artifacts/manual-hotel-journey');
const metadata=path.resolve('tests/.runtime/visual-review-current.json');
fs.mkdirSync(out,{recursive:true});fs.rmSync(metadata,{force:true});
const server=spawn(process.execPath,['tests/visual-review-server.mjs'],{detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,REVIEW_PORT:String(port),REVIEW_DEV:'0',APP_ORIGIN:base,WA_PROVIDER:'manual'}});
// Fatal exits cannot leave this owned detached fixture behind for later CI steps.
const stopOwnedOnExit=()=>{if(server.pid)try{process.kill(-server.pid,'SIGKILL');}catch{}};process.once('exit',stopOwnedOnExit);
const report={scope:'Real UI against isolated SQLite; desktop and phone emulation, no provider or customer contact',scenarios:[],errors:[],blocked:[],passed:false};
let logs='',spawnError='',browser,db,fixture,currentPage;
server.stdout.on('data',v=>logs+=v);server.stderr.on('data',v=>logs+=v);server.on('error',e=>spawnError=String(e));
const persist=()=>{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(out,'server.log'),logs);};
async function context(width){
 const c=await browser.newContext({viewport:{width,height:width===1440?1000:844},locale:'en-IN',timezoneId:'Asia/Kolkata',serviceWorkers:'block'});
 c.setDefaultTimeout(15000);c.setDefaultNavigationTimeout(30000);
 // Intercept only forbidden origins. Do not route local navigation through an extra
 // continue handler: Back/reload can cancel that handler after the browser handles it.
 await c.route(url=>url.origin!==base,r=>{const u=new URL(r.request().url());report.blocked.push({origin:u.origin,path:u.pathname});return r.abort('blockedbyclient');});
 await c.routeWebSocket('**/*',s=>{report.blocked.push({transport:'websocket'});return s.close({code:1008,reason:'Isolated fixture'});});
 c.on('page',p=>p.on('pageerror',e=>report.errors.push(e.message)));return c;
}
async function capture(page,name){
 currentPage=page;await page.evaluate(()=>document.fonts.ready);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name}: viewport overflow`);
 await page.screenshot({path:path.join(out,name+'.png'),fullPage:true,animations:'disabled',mask:[page.locator('#sales-private-link')]});persist();
}
// Next can stream the shell before notFound(), retaining HTTP 200. Assert the
// actual access-denied UI and absence of record content, not transport status alone.
async function unavailableRecord(page,url,forbidden=[]){
 const response=await page.goto(url);assert([200,404].includes(response.status()));
 await page.getByRole('heading',{name:'This page isn’t available.',exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Hotel stay record',exact:true}).count(),0);
 assert.equal(await page.getByRole('region',{name:'Booking record',exact:true}).count(),0);
 const body=await page.locator('body').innerText(),html=await page.content(),wireHtml=await within(response.text(),10000,'denied page raw response body'),prefix=path.join(out,`unavailable-${page.url().split('/').slice(-2).join('-')}`);
 // Synthetic fixture only. Explicit header allowlist excludes cookies/authentication.
 const headers=response.headers(),safeHeaders=Object.fromEntries(['content-type','cache-control','x-robots-tag','vary'].filter(key=>headers[key]!==undefined).map(key=>[key,headers[key]]));
 fs.writeFileSync(prefix+'.txt',body);fs.writeFileSync(prefix+'.html',html);fs.writeFileSync(prefix+'-response.html',wireHtml);fs.writeFileSync(prefix+'-response.json',JSON.stringify({status:response.status(),headers:safeHeaders},null,2));
 const robots=await page.locator('meta[name="robots"]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('content')??''));assert(robots.some(value=>value.split(/[\s,]+/).includes('noindex')),'Unavailable page must have Next noindex metadata');
 for(const text of forbidden){assert(!body.includes(text),'Unavailable page leaked visible record content');assert(!html.includes(text),'Unavailable page leaked record content in rendered HTML');assert(!wireHtml.includes(text),'Unavailable response leaked record content in streamed HTML');}
}
async function savedAction(page,action,click){
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/sales'&&r.request().method()==='POST'&&r.request().postDataJSON()?.action===action);
 await click();const r=await response;assert(r.ok(),`${action}: ${r.status()} ${await r.text()}`);return r.json();
}
async function postSave(page,pathname,click){const ready=page.waitForResponse(r=>new URL(r.url()).pathname===pathname&&r.request().method()==='POST');await click();const response=await ready;assert(response.ok(),await response.text());return response.json();}
async function draft(page,title,price){
 await page.getByRole('button',{name:'New quote version',exact:true}).click();
 await page.getByLabel('Description / itinerary',{exact:true}).fill(`Synthetic ${title}`);
 await page.getByLabel('Quantity',{exact:true}).fill('2');
 await page.getByLabel('Price per unit (INR)',{exact:true}).fill(price);
 await page.getByLabel('Cost per unit (INR)',{exact:true}).fill('70.11');
 await page.getByLabel('Terms and inclusions',{exact:true}).fill('Synthetic only. No reservation, payment, email or delivery.');
 await page.getByLabel('Valid until',{exact:true}).fill('2099-12-01T12:00');
 return savedAction(page,'quote',()=>page.getByRole('button',{name:'Save draft version',exact:true}).click());
}
// Hold the actual successful server response, not a mocked result. Native repeated clicks must not duplicate it.
async function repeatedWhilePending(page,pattern,action,button){
 let release,committed,failed,count=0;
 const held=new Promise(r=>release=r),ready=new Promise((r,j)=>{committed=r;failed=j;});void ready.catch(()=>{});
 const handler=async route=>{const body=route.request().postDataJSON();if(route.request().method()!=='POST'||body?.action!==action)return route.fallback();count++;try{const response=await route.fetch({timeout:15000});assert(response.ok(),`${action}: ${response.status()}`);committed();await within(held,15000,'held '+action);await route.fulfill({response});}catch(e){failed(e);await route.abort().catch(()=>{});}};
 await page.route(pattern,handler);
 try{
  await button.dblclick();await within(ready,15000,action+' committed');assert(await button.isDisabled(),action+' is disabled while pending');assert.equal(count,1,action+' double click sends one request');
  const response=page.waitForResponse(r=>new URL(r.url()).pathname===new URL(pattern.replace('**',base)).pathname&&r.request().method()==='POST'&&r.request().postDataJSON()?.action===action);
  release();await (await response).finished();return {requests:count};
 }finally{release();await page.unroute(pattern,handler);}
}
await withFixtureCleanup(async()=>{try{await within((async()=>{
 for(let i=0;i<160;i++){assert(!spawnError&&server.exitCode===null&&server.signalCode===null,`Fixture exited ${spawnError}\n${logs}`);if(logs.includes('VISUAL REVIEW READY')&&fs.existsSync(metadata)){fixture=JSON.parse(fs.readFileSync(metadata,'utf8'));break;}await new Promise(r=>setTimeout(r,500));}
 assert(fixture&&fixture.base===base&&fixture.runtime.startsWith(path.resolve('tests/.runtime')+path.sep));
 db=new PrismaClient({datasources:{db:{url:`file:${path.join(fixture.runtime,'test.db')}`}}});
 browser=await chromium.launch({headless:true,timeout:30000});report.engine=browser.browserType().name();report.version=browser.version();
 for(const width of [1440,390]){
  const staff=await context(width),customer=await context(width),page=await staff.newPage(),proposal=await customer.newPage();currentPage=page;
  const title=`Synthetic manual hotel ${width}`;
  const hotelName=width===390?`Synthetic Hotel ${width} `+"H".repeat(180):`Synthetic Hotel ${width}`,hotelReference=width===390?"SYNTHETIC-"+"R".repeat(90):`SYNTHETIC-STAY-${width}`;
  if(width===390){assert.equal(hotelName.length,200);assert.equal(hotelReference.length,100);}
  await page.goto(base+'/login');await page.getByLabel('Work email',{exact:true}).fill('review@visual.test');await page.getByLabel('Password',{exact:true}).fill('Review-Visual-2026!');await page.getByRole('button',{name:'Sign in to workspace',exact:true}).click();await page.waitForURL('**/dashboard');
  const menu=page.getByRole('button',{name:'Open navigation',exact:true});if(await menu.isVisible())await menu.click();await page.locator('#workspace-navigation').getByRole('link',{name:'Enquiries & quotes',exact:true}).click();await page.waitForURL('**/sales');
  await page.getByRole('button',{name:'New enquiry',exact:true}).click();await page.getByLabel('Customer',{exact:true}).selectOption(fixture.customerId);
  await page.getByLabel('Enquiry title',{exact:true}).fill(title);await page.getByLabel('Source',{exact:true}).fill('Synthetic browser fixture');await page.getByLabel('Product',{exact:true}).selectOption('HOTEL');await page.getByLabel('Destination / route',{exact:true}).fill('Kerala');
  const created=await savedAction(page,'create',()=>page.getByRole('button',{name:'Save enquiry',exact:true}).click());assert(created.id);
  await page.getByText('Update stage / follow-up',{exact:true}).click();await page.getByLabel('Enquiry stage',{exact:true}).selectOption('QUALIFIED');await page.getByLabel('Next follow-up',{exact:true}).fill('2099-11-01T10:30');await savedAction(page,'stage',()=>page.getByRole('button',{name:'Save stage / follow-up',exact:true}).click());
  const lead=await db.salesLead.findUniqueOrThrow({where:{id:created.id}});assert.equal(lead.stage,'QUALIFIED');assert.equal(lead.followUpAt.toISOString(),'2099-11-01T05:00:00.000Z');
  const first=await draft(page,'accepted exact v1','123.45');
  page.once('dialog',d=>d.accept());await savedAction(page,'publish',()=>page.getByRole('button',{name:'Publish private proposal',exact:true}).click());
  const privateLink=await page.getByRole('textbox',{name:'Private proposal link',exact:true}).inputValue();assert(new URL(privateLink,base).hash);assert.equal(new URL(privateLink,base).origin,base);
  // A newer private draft must not replace the older proposal the customer actually sees and accepts.
  const second=await draft(page,'unaccepted newer v2','333.33');assert.notEqual(first.quoteId,second.quoteId);
  await proposal.goto(new URL(privateLink,base).href);await proposal.getByRole('heading',{name:title,exact:true}).waitFor();await proposal.getByText('Total ₹246.90',{exact:true}).waitFor();assert.equal(new URL(proposal.url()).hash,'','Private capability is removed from history');
  // Explicit privacy contract: reload does not persist or silently recover a capability. Original link is recoverable.
  await proposal.reload();await proposal.locator('[role="alert"]:not(#__next-route-announcer__)').getByText('Open the private link shared by your travel advisor.',{exact:true}).waitFor();
  await proposal.goto(base+'/login');await proposal.goto(new URL(privateLink,base).href);await proposal.getByRole('heading',{name:title,exact:true}).waitFor();
  await proposal.getByLabel('Your full name',{exact:true}).fill('Synthetic Customer');await proposal.getByRole('checkbox').check();
  const accept=await repeatedWhilePending(proposal,'**/api/proposals','accept',proposal.locator('form button'));
  await proposal.getByText('Accepted by Synthetic Customer. Your advisor can now proceed.',{exact:true}).waitFor();await capture(proposal,`accepted-proposal-${width}`);
  const accepted=await db.salesQuote.findUniqueOrThrow({where:{id:first.quoteId}});assert.equal(accepted.state,'ACCEPTED');assert.equal(accepted.totalMinor,24690);assert(accepted.acceptedAt);
  // Reopen the original private link after a full document replacement: acceptance stays immutable and no second submit exists.
  await proposal.goto(base+'/login');await proposal.goBack();await proposal.goto(base+'/login');await proposal.goto(new URL(privateLink,base).href);await proposal.getByText('Accepted by Synthetic Customer. Your advisor can now proceed.',{exact:true}).waitFor();assert.equal(await proposal.getByRole('button',{name:'Accept quotation',exact:true}).count(),0);
  await page.getByRole('button',{name:'Refresh records',exact:true}).click();
  const conversion=page.getByRole('button',{name:'Create CRM booking from accepted quote',exact:true});await conversion.waitFor();
  assert.equal(await page.getByRole('button',{name:'New quote version',exact:true}).count(),0);
  const convert=await repeatedWhilePending(page,'**/api/sales','convert',conversion);
  const linked=page.getByRole('link',{name:'Open linked booking',exact:true});await linked.waitFor();const href=await linked.getAttribute('href');
  const persisted=await db.salesQuote.findUniqueOrThrow({where:{id:first.quoteId}});assert(persisted.bookingId);assert.equal(href,`/ticketing/${persisted.bookingId}`);
  const booking=await db.booking.findUniqueOrThrow({where:{id:persisted.bookingId}});assert.equal(booking.sellingPrice,246.90);assert.equal(booking.supplierCost,140.22);assert.equal(booking.status,'ENQUIRY');assert.equal(booking.customerId,fixture.customerId);
  assert.equal((await db.salesQuote.findUniqueOrThrow({where:{id:second.quoteId}})).bookingId,null);assert.equal(persisted.acceptedName,accepted.acceptedName);assert.equal(persisted.acceptedAt.toISOString(),accepted.acceptedAt.toISOString());
  assert.equal(await db.auditLog.count({where:{entityId:first.quoteId,action:'CUSTOMER_ACCEPTED_QUOTE'}}),1);
  await capture(page,`converted-exact-version-${width}`);await linked.click();await page.waitForURL('**'+href);await page.getByText(booking.bookingNo,{exact:true}).first().waitFor();await capture(page,`linked-booking-${width}`);
  for(const status of ['TICKETED','PNR_CREATED','CONFIRMED']){const denied=await page.request.post(base+'/api/bookings/status',{data:{bookingId:booking.id,status,confirmationRecorded:true}});assert.equal(denied.status(),400,`${status} without valid hotel stay must be denied`);}assert.equal(await db.ticket.count({where:{bookingId:booking.id}}),0);
  assert.equal(booking.product,'HOTEL');assert.equal(await page.getByRole('button',{name:'Record actual tickets',exact:true}).count(),0);
  await page.getByRole('button',{name:'Record supplier confirmation',exact:true}).click();let hotelDialog=page.getByRole('dialog',{name:'Record hotel supplier confirmation',exact:true});await hotelDialog.locator('[role="alert"]:not(#__next-route-announcer__)').waitFor();assert(await hotelDialog.getByRole('button',{name:'Record confirmed stay',exact:true}).isDisabled());await hotelDialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Edit hotel stay',exact:true}).click();hotelDialog=page.getByRole('dialog',{name:'Edit hotel stay',exact:true});await hotelDialog.getByRole('textbox',{name:'Hotel name',exact:true}).fill(hotelName);await hotelDialog.getByLabel('Check-in date',{exact:true}).fill('2099-11-10');await hotelDialog.getByLabel('Check-out date',{exact:true}).fill('2099-11-09');await hotelDialog.getByRole('textbox',{name:'Supplier confirmation reference',exact:true}).fill(hotelReference);
  const invalid=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/bookings/${booking.id}`&&r.request().method()==='POST');await hotelDialog.getByRole('button',{name:'Save changes',exact:true}).click();assert.equal((await invalid).status(),400);await hotelDialog.locator('[role="alert"]:not(#__next-route-announcer__)').waitFor();assert.equal((await db.booking.findUniqueOrThrow({where:{id:booking.id}})).hotelName,null,'Invalid stay must not partially save');
  await hotelDialog.getByLabel('Check-out date',{exact:true}).fill('2099-11-12');await postSave(page,`/api/bookings/${booking.id}`,()=>hotelDialog.getByRole('button',{name:'Save changes',exact:true}).click());await hotelDialog.waitFor({state:'hidden'});assert.equal((await db.booking.findUniqueOrThrow({where:{id:booking.id}})).status,'ENQUIRY','Reference entry must not invent airline PNR state');
  const changedSnapshot=await page.request.post(base+'/api/bookings/status',{data:{bookingId:booking.id,status:'CONFIRMED',confirmationRecorded:true,confirmationSnapshot:{hotelName:'Obsolete stay'}}});assert.equal(changedSnapshot.status(),409);assert.equal((await db.booking.findUniqueOrThrow({where:{id:booking.id}})).status,'ENQUIRY');
  const draftStay=await db.booking.findUniqueOrThrow({where:{id:booking.id}});const staleSupplier=await page.request.post(base+'/api/bookings/status',{data:{bookingId:booking.id,status:'CONFIRMED',confirmationRecorded:true,confirmationSnapshot:{hotelName:draftStay.hotelName,pnr:draftStay.pnr,supplierId:'obsolete-supplier',hotelCheckIn:draftStay.hotelCheckIn.toISOString(),hotelCheckOut:draftStay.hotelCheckOut.toISOString()}}});assert.equal(staleSupplier.status(),409,'A different supplier snapshot cannot be confirmed');assert.equal((await db.booking.findUniqueOrThrow({where:{id:booking.id}})).status,'ENQUIRY');
  await page.getByRole('button',{name:'Edit guests',exact:true}).click();hotelDialog=page.getByRole('dialog',{name:'Hotel guests',exact:true});await hotelDialog.getByRole('checkbox',{name:'Meera Sharma',exact:true}).check();await postSave(page,`/api/bookings/${booking.id}`,()=>hotelDialog.getByRole('button',{name:'Save guests',exact:true}).click());await hotelDialog.waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Record supplier confirmation',exact:true}).click();hotelDialog=page.getByRole('dialog',{name:'Record hotel supplier confirmation',exact:true});assert(await hotelDialog.getByRole('button',{name:'Record confirmed stay',exact:true}).isDisabled());await hotelDialog.getByRole('checkbox').check();await hotelDialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await db.booking.findUniqueOrThrow({where:{id:booking.id}})).status,'ENQUIRY');
  await page.getByRole('button',{name:'Record supplier confirmation',exact:true}).click();hotelDialog=page.getByRole('dialog',{name:'Record hotel supplier confirmation',exact:true});await capture(page,`hotel-confirmation-review-${width}`);await hotelDialog.getByRole('checkbox').check();const unavailable=route=>route.fulfill({status:503,json:{error:'Synthetic confirmation service unavailable'}});await page.route('**/api/bookings/status',unavailable);await hotelDialog.getByRole('button',{name:'Record confirmed stay',exact:true}).click();await hotelDialog.locator('[role="alert"]:not(#__next-route-announcer__)').waitFor();assert.equal((await db.booking.findUniqueOrThrow({where:{id:booking.id}})).status,'ENQUIRY');await page.unroute('**/api/bookings/status',unavailable);
  await postSave(page,'/api/bookings/status',()=>hotelDialog.getByRole('button',{name:'Record confirmed stay',exact:true}).dblclick());await hotelDialog.waitFor({state:'hidden'});await page.reload();const confirmed=await db.booking.findUniqueOrThrow({where:{id:booking.id}});assert.equal(confirmed.status,'CONFIRMED');assert.equal(confirmed.pnr,hotelReference);assert.equal(confirmed.hotelCheckIn.toISOString(),'2099-11-10T00:00:00.000Z');assert.equal(confirmed.hotelCheckOut.toISOString(),'2099-11-12T00:00:00.000Z');assert.equal(await db.ticket.count({where:{bookingId:booking.id}}),0);assert.equal(await db.auditLog.count({where:{entityId:booking.id,action:'STATUS'}}),1);await capture(page,`hotel-confirmed-${width}`);
  const replay=await page.request.post(base+'/api/bookings/status',{data:{bookingId:booking.id,status:'CONFIRMED',confirmationRecorded:true,confirmationSnapshot:{hotelName:confirmed.hotelName,pnr:confirmed.pnr,supplierId:confirmed.supplierId,hotelCheckIn:confirmed.hotelCheckIn.toISOString(),hotelCheckOut:confirmed.hotelCheckOut.toISOString()}}});assert.equal(replay.status(),200);assert.equal(await db.auditLog.count({where:{entityId:booking.id,action:'STATUS'}}),1);
  assert.equal((await page.request.post(base+`/api/bookings/${booking.id}`,{data:{pnr:'CHANGED-UNREVIEWED'}})).status(),409);assert.equal((await page.request.post(base+'/api/bookings/status',{data:{bookingId:booking.id,status:'ENQUIRY'}})).status(),400);
  assert.equal((await page.request.post(base+'/api/bookings/extend-deadline',{data:{bookingId:booking.id,hours:24}})).status(),400);
  assert.equal((await page.request.post(base+'/api/whatsapp/send',{data:{customerId:booking.customerId,bookingId:booking.id,template:'PNR_EXPIRY',preview:true}})).status(),400,'Hotel reference must never become a flight expiry reminder');
  for(const endpoint of [`/api/bookings/${fixture.onlineBookingId}`,'/api/bookings/status']){assert.equal((await page.request.post(base+endpoint,{data:endpoint.endsWith('/status')?{bookingId:fixture.onlineBookingId,status:'CONFIRMED',confirmationRecorded:true}:{hotelName:'Not editable'}})).status(),409,'Provider-owned hotel remains read-only');}
  const providerRecord=await db.booking.findUniqueOrThrow({where:{id:fixture.onlineBookingId}});const unavailableStay=await staff.newPage();await unavailableRecord(unavailableStay,base+`/ticketing/${fixture.onlineBookingId}/stay`,[providerRecord.hotelName,providerRecord.pnr].filter(Boolean));await capture(unavailableStay,`platform-stay-unavailable-${width}`);await unavailableStay.close();
  const platformView=await staff.newPage();await platformView.goto(base+`/ticketing/${fixture.onlineBookingId}`);await platformView.getByText('Stay details synced from the booking platform. Use Online bookings for supplier status and current documents.',{exact:true}).waitFor();assert.equal(await platformView.getByRole('button',{name:'Edit hotel stay',exact:true}).count(),0);assert.equal(await platformView.getByRole('button',{name:'Record supplier confirmation',exact:true}).count(),0);assert.equal(await platformView.getByRole('link',{name:'Open stay record',exact:true}).count(),0);await platformView.close();
  const stayDocument=await staff.newPage();await stayDocument.goto(base+await page.getByRole('link',{name:'Open stay record',exact:true}).getAttribute('href'));await stayDocument.getByRole('heading',{name:'Hotel stay record',exact:true}).waitFor();await stayDocument.getByText(hotelReference,{exact:true}).waitFor();await stayDocument.getByText('Meera Sharma',{exact:true}).last().waitFor();await stayDocument.getByText(/This is not a hotel voucher/).waitFor();await stayDocument.emulateMedia({media:'print'});assert.equal(await stayDocument.getByRole('button',{name:'Print / save as PDF',exact:true}).isVisible(),false);await stayDocument.emulateMedia({media:'screen'});await capture(stayDocument,`hotel-stay-record-${width}`);await stayDocument.close();
  await page.goBack();await page.waitForURL('**/sales');await page.reload();await page.getByRole('button',{name:`Open enquiry: ${title}`,exact:true}).click();await page.getByRole('link',{name:'Open linked booking',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Create CRM booking from accepted quote',exact:true}).count(),0);
  assert.equal(await db.salesQuote.count({where:{leadId:created.id,bookingId:{not:null}}}),1);
  const customerView=await staff.newPage();await customerView.goto(base+`/customers/${booking.customerId}`);const currentWork=customerView.locator("section").filter({has:customerView.getByRole("heading",{name:"Current work",exact:true})}).locator(`a[href="/ticketing/${booking.id}"]`);await currentWork.getByText(`Synthetic Hotel ${width}`,{exact:false}).waitFor();assert((await currentWork.innerText()).includes('Supplier confirmation reference:'));assert(!(await currentWork.innerText()).includes('Deadline'));await capture(customerView,`customer-hotel-overview-${width}`);
  if(width===390)await customerView.getByRole('combobox',{name:'Customer section',exact:true}).selectOption('trips');else await customerView.getByRole('button',{name:'Trips',exact:true}).click();const trip=customerView.locator(`a[href="/ticketing/${booking.id}"]`);await trip.getByText(`Synthetic Hotel ${width}`,{exact:false}).waitFor();const tripText=await trip.innerText();assert(tripText.includes(`Supplier confirmation reference: ${hotelReference}`));assert(tripText.includes('Check-in')&&tripText.includes('Check-out')&&tripText.includes('2099'));assert(!tripText.includes('PNR ')&&!tripText.includes('Travel '));await capture(customerView,`customer-hotel-trip-${width}`);
  await trip.click();await customerView.waitForURL(`**/ticketing/${booking.id}`);await customerView.getByRole('link',{name:'Open stay record',exact:true}).click();await customerView.waitForURL(`**/ticketing/${booking.id}/stay`);await customerView.getByRole('heading',{name:'Hotel stay record',exact:true}).waitFor();await customerView.getByRole('link',{name:'Back to hotel stay',exact:true}).click();await customerView.waitForURL(`**/ticketing/${booking.id}`);await customerView.close();
  const list=await staff.newPage();await list.goto(base+'/ticketing');await list.getByRole('combobox',{name:'Booking status',exact:true}).selectOption('CONFIRMED');await list.getByRole('button',{name:'Filter',exact:true}).click();await list.locator(`a[href="/ticketing/${booking.id}"]:visible`).waitFor();await capture(list,`hotel-confirmed-list-${width}`);await list.close();
  const owner=await db.user.findUniqueOrThrow({where:{email:'review@visual.test'}});
  for(const roleKey of ['READ_ONLY','TICKETING_EXECUTIVE']){
   const role=await db.role.findUniqueOrThrow({where:{key:roleKey}}),email=`synthetic-${roleKey.toLowerCase()}-${width}@example.test`;await db.user.create({data:{employeeCode:`HOTEL-${roleKey}-${width}`,name:'Synthetic hotel access check',email,phone:'',passwordHash:owner.passwordHash,roleId:role.id,branchId:owner.branchId}});
   const scoped=await context(width),restricted=await scoped.newPage();await restricted.goto(base+'/login');await restricted.getByLabel('Work email',{exact:true}).fill(email);await restricted.getByLabel('Password',{exact:true}).fill('Review-Visual-2026!');await restricted.getByRole('button',{name:'Sign in to workspace',exact:true}).click();await restricted.waitForURL('**/dashboard');
   const viewed=await restricted.goto(base+`/ticketing/${booking.id}`);if(roleKey==='READ_ONLY'){assert.equal(viewed.status(),200);assert.equal(await restricted.getByRole('button',{name:'Edit hotel stay',exact:true}).count(),0);assert.equal(await restricted.getByRole('button',{name:'Record supplier confirmation',exact:true}).count(),0);}else await unavailableRecord(restricted,base+`/ticketing/${booking.id}`,[hotelName,hotelReference]);
   assert.equal((await restricted.request.post(base+`/api/bookings/${booking.id}`,{data:{hotelName:'Forbidden'}})).status(),403);assert.equal((await restricted.request.post(base+'/api/bookings/status',{data:{bookingId:booking.id,status:'CONFIRMED'}})).status(),403);if(roleKey==='READ_ONLY'){await restricted.goto(base+`/ticketing/${booking.id}/stay`);await restricted.getByRole('heading',{name:'Hotel stay record',exact:true}).waitFor();await restricted.getByText(hotelReference,{exact:true}).waitFor();}else await unavailableRecord(restricted,base+`/ticketing/${booking.id}/stay`,[hotelName,hotelReference]);await capture(restricted,`hotel-stay-access-${roleKey}-${width}`);await scoped.close();
  }
  const invoice=await page.request.post(base+'/api/invoices',{data:{customerId:booking.customerId,bookingId:booking.id,amount:246.9,description:'Synthetic hotel linked invoice guard'}});assert(invoice.ok(),await invoice.text());assert.equal((await page.request.post(base+`/api/bookings/${booking.id}`,{data:{fare:247.9}})).status(),400,'Committed invoice locks hotel financial correction');assert.equal((await db.booking.findUniqueOrThrow({where:{id:booking.id}})).sellingPrice,246.9);assert.equal(await db.ticket.count({where:{bookingId:booking.id}}),0);
  report.scenarios.push({width,passed:true,acceptRequests:accept.requests,conversionRequests:convert.requests,acceptedVersion:1,newerDraftVersion:2,sellingPrice:booking.sellingPrice,cost:booking.supplierCost,bookingStatus:booking.status,manualHotelStatus:confirmed.status,airlineTickets:0,capabilityReload:'Requires reopening original private link; no storage/history retention'});persist();
  await staff.close();await customer.close();
 }
 assert.equal(await db.whatsAppMessage.count({where:{direction:'OUT'}}),0,'No supplier/customer contact from recording a hotel confirmation');assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);report.passed=true;persist();console.log('PASS manual HOTEL UI: login → create enquiry → follow-up → quote v1 → publish → newer private v2 → customer acceptance → exact v1 CRM booking; repeated clicks, slow committed responses, Back/reload, immutable consent → hotel stay editing/invalid dates → explicit supplier confirmation with cancel/503/repeated submit → truthful stay record; no airline tickets; 1440/390.');
 })(),240000,'contiguous sales UI fixture');}catch(e){report.failure=String(e);persist();if(currentPage)await currentPage.screenshot({path:path.join(out,'failure.png'),timeout:3000,mask:[currentPage.locator('#sales-private-link')]}).catch(()=>{});throw e;}
},async()=>{
 persist();const errors=[];if(browser)try{await within(browser.close(),3000,'browser close');}catch(e){errors.push(e);}if(db)try{await db.$disconnect();}catch(e){errors.push(e);}
 if(server.pid){const signal=s=>{try{process.kill(-server.pid,s);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};const gone=async ms=>{const end=Date.now()+ms;while(Date.now()<end){if(!signal(0))return;await new Promise(r=>setTimeout(r,100));}if(signal(0))throw Error('Owned fixture still alive');};try{if(signal('SIGTERM'))try{await gone(3000);}catch{signal('SIGKILL');await gone(2000);}}catch(e){errors.push(e);}}
 if(errors.length)throw new AggregateError(errors,'Fixture cleanup incomplete');process.removeListener('exit',stopOwnedOnExit);
},e=>{report.passed=false;report.cleanupFailure=String(e);persist();});
