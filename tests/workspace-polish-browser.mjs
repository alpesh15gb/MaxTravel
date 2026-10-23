// Synthetic comparison only. Baseline records old geometry; candidate enforces the new task handoff.
// Run after build: node --import tsx tests/research-revamp-browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { chromium } from './browser.mjs';
import { within, withFixtureCleanup } from './fixture-lifecycle.mjs';
import { ROLE_PERMISSIONS } from '../src/lib/permissions.ts';
import { emptyPackage } from '../src/lib/travel-packages.ts';

const before = process.env.WORKSPACE_COMPARISON === 'before';
assert(['before', 'after'].includes(process.env.WORKSPACE_COMPARISON ?? 'after'));
const out = path.resolve('test-artifacts/workspace-polish', before ? 'before' : 'after');
const port = 3377, base = `http://127.0.0.1:${port}`;
const range = fs.readFileSync('/proc/sys/net/ipv4/ip_local_port_range', 'utf8').trim().split(/\s+/).map(Number);
assert(range.length === 2 && range.every(Number.isInteger) && (port < range[0] || port > range[1]));
const fixturePath = path.resolve('tests/.runtime/visual-review-current.json');
fs.mkdirSync(out, { recursive: true }); fs.rmSync(fixturePath, { force: true });
const navContract = {
  '/dashboard':'dashboard:view', '/sales':'customer:view', '/customers':'customer:view', '/tasks':'task:view',
  '/visa':'visa:view', '/ticketing':'ticketing:view', '/online-bookings':'ticketing:view', '/documents':'document:view',
  '/payments':'payment:view', '/advances':'payment:view', '/reports':'payment:view', '/refunds':'refund:view', '/suppliers':'supplier:view',
  '/incoming-documents':'whatsapp:view', '/whatsapp':'whatsapp:view', '/employees':'employee:view', '/customer-tools':'customer:create',
  '/checklists':'checklist:view', '/audit':'audit:view', '/travel-packages':'settings:manage', '/settings':'settings:manage',
};
const navSource = fs.readFileSync('src/components/Shell.tsx', 'utf8').split('const QUICK:')[0];
const actualNav = Object.fromEntries([...navSource.matchAll(/href:\s*"([^"]+)"[^}]*?perm:\s*"([^"]+)"/g)].map(match => [match[1], match[2]]));
assert.deepEqual(actualNav, navContract, 'All21 existing navigation routes retain their exact permission');
const report = {
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding:'utf8' }).trim(), baseline:'24267f5872b8f22af75e0d0a34e1c9366b1da44d',
  mode: before ? 'baseline-observation' : 'candidate-gate', fixtureSha256:createHash('sha256').update(fs.readFileSync('tests/visual-review-server.mjs')).digest('hex'),
  scope:'Synthetic Chromium viewport comparison, not physical devices or speed benchmark. Identical seed definitions; runtime-relative timestamps are not pixel goldens.',
  limitations:['Chromium emulation and computed text resize only; dedicated sales-draft-recovery workflow covers history recovery.'],
  scenarios:[], errors:[], blocked:[], passed:false,
};
const server = spawn(process.execPath, ['tests/visual-review-server.mjs'], {
  detached:true, stdio:['ignore','pipe','pipe'], env:{...process.env, REVIEW_PORT:String(port), REVIEW_DEV:'0', WA_PROVIDER:'manual', APP_ORIGIN:base},
});
let logs='', spawnError='', browser, page, db;
server.stdout.on('data', value => logs += value); server.stderr.on('data', value => logs += value); server.on('error', error => spawnError=String(error));
function persist() { fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)); fs.writeFileSync(path.join(out,'server.log'),logs); }
async function capture(name) {
  await page.evaluate(async()=>{await document.fonts.ready; await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const overflow=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
  if(!before) assert(overflow.scrollWidth<=overflow.width+1, `${name}: no horizontal overflow`);
  report.scenarios.push({name,overflow}); await page.screenshot({path:path.join(out,`${name}.png`),animations:'disabled',timeout:5000}); persist();
}
async function handoff(heading, field, name) {
  await heading.waitFor();
  if(!before) { const handle=await heading.elementHandle(); try { await page.waitForFunction(el=>document.activeElement===el,handle,{timeout:5000}); } finally {await handle.dispose();} }
  const geometry=await heading.evaluate(node=>{const b=node.getBoundingClientRect();return {heading:{top:b.top,bottom:b.bottom},focused:document.activeElement===node,height:innerHeight};});
  const box=await field.boundingBox(); geometry.field=box ? {top:box.y,bottom:box.y+box.height}:null;
  report.scenarios.push({name,...geometry});
  if(!before) {assert(geometry.focused,`${name}: application focuses editor heading`);for(const b of [geometry.heading,geometry.field])assert(b&&b.top>=64&&b.bottom<=geometry.height,`${name}: heading/firstfield visible without test scrolling`);}
}
function sectionPicker() {
  // The pinned baseline uses an implicit label containing all option text.
  return before ? page.locator('label.package-section-picker select') : page.getByLabel('Edit section',{exact:true});
}
async function keyboardSlugAboveSaveBar(name) {
  const field=page.getByLabel('Public URL slug',{exact:false});
  // Start from the app-focused editor heading. No locator focus/click/scroll may
  // mask a keyboard handoff defect behind the sticky save bar.
  let reached=false;
  for(let i=0;i<20;i++){
    if(await field.evaluate(node=>document.activeElement===node)){reached=true;break;}
    await page.keyboard.press('Tab');
  }
  assert(reached,`${name}: keyboard reaches the slug without scripted focus`);
  const handle=await field.elementHandle();assert(handle,'Keyboard-focused slug exists');let settlingError;
  try{
    await page.waitForFunction(node=>{
      const footer=node.closest('section[aria-label="Package editor"]')?.lastElementChild;
      if(!footer)return false;
      const r=node.getBoundingClientRect(),bar=footer.getBoundingClientRect();
      const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return document.activeElement===node&&r.left>=0&&r.right<=innerWidth&&r.top>=64&&r.bottom<=innerHeight&&r.bottom<=bar.top&&bar.top<innerHeight&&hit===node;
    },handle,{timeout:5000});
  }catch(error){settlingError=error;}finally{await handle.dispose();}
  const geometry=await field.evaluate(node=>{
    const r=node.getBoundingClientRect(),bar=node.closest('section[aria-label="Package editor"]').lastElementChild.getBoundingClientRect();
    const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return {focused:document.activeElement===node,field:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},footer:{top:bar.top,bottom:bar.bottom},pointerReachable:hit===node,width:innerWidth,height:innerHeight};
  });
  report.scenarios.push({name,...geometry});persist();
  if(!before)assert(geometry.focused&&geometry.field.left>=0&&geometry.field.right<=geometry.width&&geometry.field.top>=64&&geometry.field.bottom<=geometry.height&&geometry.field.bottom<=geometry.footer.top&&geometry.footer.top<geometry.height&&geometry.pointerReachable,`${name}: complete focused slug is above sticky save bar and pointer-reachable`);
  if(!before&&settlingError)throw settlingError;
  await capture(name);
}
async function login(context,email='review@visual.test') {
  page=await context.newPage(); page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(base+'/login'); await page.getByLabel('Work email',{exact:true}).fill(email);
  await page.getByLabel('Password',{exact:true}).fill('Review-Visual-2026!');
  await page.getByRole('button',{name:'Sign in to workspace',exact:true}).click(); await page.waitForURL('**/dashboard');
}
async function contextFor(width,height) {
  const context=await within(browser.newContext({viewport:{width,height},deviceScaleFactor:1,locale:'en-IN',timezoneId:'Asia/Kolkata',serviceWorkers:'block'}),30000,'context creation');
  context.setDefaultTimeout(15000);context.setDefaultNavigationTimeout(30000);
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===base)return route.continue();report.blocked.push({origin:url.origin,path:url.pathname});return route.abort('blockedbyclient');});
  await context.routeWebSocket('**/*',socket=>{report.blocked.push({transport:'websocket'});return socket.close({code:1008,reason:'Fixture only'});});
  return context;
}
async function openDrawer() {
  await page.getByRole('button',{name:'Open navigation',exact:true}).click();
  await page.waitForFunction(()=>{const node=document.querySelector('#workspace-navigation[data-drawer="open"]');if(!node)return false;const r=node.getBoundingClientRect();return r.left>=-.5&&r.right<=innerWidth+.5&&r.width>200;},undefined,{timeout:5000});
}
async function checkNav(role) {
  const nav=page.locator('#workspace-navigation');
  for(const button of await nav.locator('button[aria-expanded]').all())if(await button.getAttribute('aria-expanded')==='false')await button.click();
  const hrefs=await nav.locator('a.nav-link').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')).sort());
  assert.deepEqual(hrefs,Object.entries(navContract).filter(([,perm])=>ROLE_PERMISSIONS[role].includes(perm)).map(([href])=>href).sort(),`${role}: nav exactly permission-filtered`);
  report.scenarios.push({role,nav:hrefs});
}
async function backToEnquiries(title) {
  await page.getByRole('button',{name:'Back to enquiries',exact:true}).click();
  const row=page.getByRole('button',{name:`Open enquiry: ${title}`,exact:true});
  const handle=await row.elementHandle();assert(handle,'Returning enquiry row exists');
  try{await page.waitForFunction(node=>document.activeElement===node,handle,{timeout:5000});}finally{await handle.dispose();}
  const box=await row.boundingBox(), height=await page.evaluate(()=>innerHeight);
  assert(box&&box.y>=64&&box.y+box.height<=height,'Back to enquiries restores focus to a visible originating row');
}
async function openQuote(title) {
  {await page.getByRole('button',{name:`Open enquiry: ${title}`,exact:true}).click();await page.getByRole('region',{name:'Selected enquiry',exact:true}).getByRole('button',{name:'New quote version',exact:true}).click();}
}
async function json(context,url,method='GET',data) {
  const response=await context.request.fetch(base+url,{method,data,headers:{Origin:base},timeout:15000});
  assert(response.ok(),`${method} ${url}: ${response.status()} ${await response.text()}`);return response.json();
}
await withFixtureCleanup(async()=>{
 try { await within((async()=>{
  let fixture;
  for(let i=0;i<160;i++){assert(!spawnError&&server.exitCode===null&&server.signalCode===null,`Owned server exited: ${spawnError}\n${logs}`);if(logs.includes('VISUAL REVIEW READY')&&fs.existsSync(fixturePath)){fixture=JSON.parse(fs.readFileSync(fixturePath,'utf8'));break;}await new Promise(r=>setTimeout(r,500));}
  assert(fixture);assert.equal(fixture.base,base);assert(Number.isInteger(fixture.serverPid));
  db=new PrismaClient({datasources:{db:{url:`file:${path.join(fixture.runtime,'test.db')}`}}});
  const owner=await db.user.findUniqueOrThrow({where:{email:'review@visual.test'}});
  const role=await db.role.findUniqueOrThrow({where:{key:'READ_ONLY'}});
  await db.user.create({data:{employeeCode:'RESEARCH-READONLY',name:'Review Reader',email:'reader@visual.test',phone:'',passwordHash:owner.passwordHash,roleId:role.id}});
  browser=await chromium.launch({headless:true,timeout:30000});report.engine=browser.browserType().name();report.version=browser.version();
  const setup=await contextFor(1440,1000);await login(setup);
  const title='Kerala family enquiry';
  const lead=await json(setup,'/api/sales','POST',{action:'create',data:{customerId:fixture.customerId,title,source:'Synthetic visual review',product:'HOTEL',budgetMinor:8000000,destination:'Kerala',notes:'A relaxed family holiday. Enquiry only; no reservation.'}});
  const draft={...emptyPackage,title:'Kerala discovery',destination:'Kerala',summary:'A thoughtfully paced backwater journey.',description:'Synthetic published catalogue content for visual comparison.',itinerary:[{day:1,title:'Arrive and explore',description:'Local arrival transfer followed by time at leisure.'}],inclusions:['Arrival transfer'],exclusions:['Flights'],terms:'A tailored quote must be accepted before payment.',cancellationPolicy:'Supplier cancellation terms apply to the confirmed quote.',availabilityNotes:'Dates and accommodation require confirmation.',contactEmail:'review@example.test',internalNotes:'PRIVATE REVIEW NOTE'};
  let item=(await json(setup,'/api/travel-packages','POST',{slug:'kerala-review',draft})).package;
  item=(await json(setup,`/api/travel-packages/${item.id}`,'PATCH',{action:'PUBLISH',slug:item.slug,draft,revision:item.revision})).package;
  const published=await json(setup,'/api/public/travel-packages/kerala-review');assert(!JSON.stringify(published).includes('PRIVATE REVIEW'));
  await within(setup.close(),3000,'setup context close');
  for(const [width,height] of [[1440,1000],[390,844],[320,844]]){
    const context=await contextFor(width,height);await login(context);await page.locator('main h1').waitFor();
    await page.goto(base+'/sales');await page.getByRole('button',{name:`Open enquiry: ${title}`,exact:true}).waitFor();if(!before){const row=page.getByRole('button',{name:`Open enquiry: ${title}`,exact:true});await row.getByText('Follow-up not scheduled',{exact:true}).waitFor();await row.getByText('New',{exact:true}).waitFor();}await capture(`${width}-enquiry-list`);
    await openQuote(title);const quoteHeading=page.getByRole('heading',{name:`Quotation · ${title}`,exact:true});const description=page.getByLabel('Description / itinerary',{exact:true});
    await handoff(quoteHeading,description,`${width}-quote-handoff`);await capture(`${width}-quote-editor`);
    await description.fill('Two travellers, a considered itinerary');await page.getByLabel('Price per unit (INR)',{exact:true}).fill('12500');
    await page.getByLabel('Quantity',{exact:true}).fill('2');
    if(!before){const overview=page.getByRole('region',{name:'Quotation overview',exact:true});const value=await overview.locator('.sales-draft-total').innerText();assert.equal(Number(value.replace(/[^0-9.]/g,'')),25000,'Draft total derives from actual quantity and entered unit price');let writes=0;const observe=request=>{if(new URL(request.url()).pathname==='/api/sales'&&request.method()==='POST')writes++;};page.on('request',observe);try{await page.getByRole('button',{name:'Continue to validity & terms',exact:true}).click();const expiry=page.getByLabel('Valid until',{exact:true});const handle=await expiry.elementHandle();assert(handle);try{await page.waitForFunction(node=>{const r=node.getBoundingClientRect();return document.activeElement===node&&r.top>=64&&r.bottom<=innerHeight;},handle,{timeout:5000});}finally{await handle.dispose();}assert.equal(writes,0,'Section jump neither saves nor publishes');await capture(`${width}-quote-validity-jump`);}finally{page.off('request',observe);}}

    // Authored-content view, after the separate unassisted handoff gate.
    await quoteHeading.scrollIntoViewIfNeeded();await capture(`${width}-quote-authored-content`);
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Close quotation',exact:true}).click();
    await page.goto(base+'/travel-packages');await page.getByRole('button').filter({has:page.getByRole('heading',{name:'Kerala discovery',exact:true})}).click();
    const editor=page.getByRole('region',{name:'Package editor',exact:true});await handoff(editor.getByRole('heading',{name:'Kerala discovery',exact:true}),page.getByLabel('Package title',{exact:true}),`${width}-package-handoff`);
    await page.getByText('Website: Published snapshot',{exact:true}).waitFor();await capture(`${width}-published-package`);
    if(!before){
      const status=page.locator('.package-version-context');await status.getByText('Private draft',{exact:true}).waitFor();await status.getByText('Saved',{exact:true}).waitFor();
      let writes=0;const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/travel-packages')&&!['GET','HEAD'].includes(request.method()))writes++;};page.on('request',observe);
      try{
        if(width<768){await sectionPicker().selectOption('Preview');await editor.getByRole('heading',{name:'Kerala discovery',exact:true,level:3}).waitFor();await editor.getByText(/Text-only draft preview — not the published website/).waitFor();await sectionPicker().selectOption('Overview');}
        await page.getByText('More actions',{exact:true}).click();await page.getByRole('button',{name:'Unpublish',exact:true}).waitFor();assert.equal(writes,0,'Opening sections or actions never writes');
        const confirmations=[];const dismiss=async dialog=>{confirmations.push(dialog.message());await dialog.dismiss();};page.on('dialog',dismiss);try{await page.getByRole('button',{name:'Unpublish',exact:true}).click();await page.getByRole('button',{name:'Archive',exact:true}).click();}finally{page.off('dialog',dismiss);}
        assert.deepEqual(confirmations,['Remove this package from the customer website? The editable draft will be retained.','Archive this package and remove it from the customer website? You can restore it later.']);assert.equal(writes,0,'Dismissing consequential confirmations performs no write');
        await page.getByLabel('Package title',{exact:true}).fill('Unsaved private comparison');await status.getByText('Unsaved edits',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'Unpublish',exact:true}).isDisabled());assert(await page.getByRole('button',{name:'Archive',exact:true}).isDisabled());assert.equal(writes,0);assert.deepEqual(await json(context,'/api/public/travel-packages/kerala-review'),published);
      }finally{page.off('request',observe);}
      page.once('dialog',dialog=>dialog.accept());
    }
    await page.getByRole('button',{name:'Close editor',exact:true}).click();await page.getByRole('button',{name:'+ Create package',exact:true}).click();
    await handoff(page.getByRole('heading',{name:'New package',exact:true}),page.getByLabel('Package title',{exact:true}),`${width}-new-package`);await capture(`${width}-new-package`);
    if(width<768){
      await keyboardSlugAboveSaveBar(`${width}-keyboard-slug`);
      await page.getByRole('button',{name:'Close editor',exact:true}).click();await page.getByRole('button',{name:'+ Create package',exact:true}).click();
      const heading=await page.getByRole('heading',{name:'New package',exact:true}).elementHandle();assert(heading);try{await page.waitForFunction(node=>document.activeElement===node,heading,{timeout:5000});}finally{await heading.dispose();}
      // Deliberately doubles existing computed text sizes, not browser chrome zoom.
      await editor.evaluate(root=>{const sizes=[root,...root.querySelectorAll('*')].filter(n=>n instanceof HTMLElement).map(node=>{const s=getComputedStyle(node);return {node,font:parseFloat(s.fontSize),line:parseFloat(s.lineHeight)};});for(const {node,font,line} of sizes){if(Number.isFinite(font))node.style.fontSize=`${font*2}px`;if(Number.isFinite(line))node.style.lineHeight=`${line*2}px`;}});
      await keyboardSlugAboveSaveBar(`${width}-keyboard-slug-text200`);
      const picker=sectionPicker();assert.equal(await picker.evaluate(node=>node.labels.length),1,'Section picker retains a real associated label');
      const clearance=await picker.evaluate(node=>{const s=getComputedStyle(node),b=node.getBoundingClientRect();return {height:b.height,needed:parseFloat(s.lineHeight)+parseFloat(s.paddingTop)+parseFloat(s.paddingBottom)+parseFloat(s.borderTopWidth)+parseFloat(s.borderBottomWidth),font:s.fontSize,label:node.selectedOptions[0].textContent,available:b.width-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)-parseFloat(s.borderLeftWidth)-parseFloat(s.borderRightWidth),labels:[...node.options].map(option=>{const context=document.createElement('canvas').getContext('2d');context.font=s.font;return {label:option.textContent,width:context.measureText(option.textContent).width};})};});
      report.scenarios.push({name:`${width}-picker-text200-clearance`,...clearance});if(!before){assert(clearance.height>=clearance.needed-.5,'200% text select has complete vertical text clearance');assert(clearance.labels.every(label=>label.width<=clearance.available),'200% section labels fit native select content width');}persist();
    }
    await within(context.close(),3000,'viewport context close');page=undefined;
  }
  const context=await contextFor(390,844);await login(context);await page.goto(base+'/travel-packages');
  await page.getByRole('button').filter({has:page.getByRole('heading',{name:'Kerala discovery',exact:true})}).click();
  await page.getByLabel('Package title',{exact:true}).fill('Kerala discovery — private revision');await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Draft saved. Any published version is unchanged.',{exact:true}).waitFor();
  assert.deepEqual(await json(context,'/api/public/travel-packages/kerala-review'),published,'Save draft never changes published snapshot');await capture('390-private-saved-revision');await within(context.close(),3000,'owner context close');
  // Identical retained-copy states on both revisions; only candidate visual hierarchy is gated here.
  const recoveryContext=await contextFor(390,844);await login(recoveryContext);await page.locator('main h1').waitFor();await openDrawer();await page.locator('#workspace-navigation').getByRole('link',{name:'Enquiries & quotes',exact:true}).click();await page.waitForURL('**/sales');await openQuote(title);await page.getByLabel('Description / itinerary',{exact:true}).fill('Synthetic retained comparison draft');
  const historyReturn=async()=>{await page.goBack({waitUntil:'domcontentloaded'});await page.waitForURL('**/dashboard');await page.goForward({waitUntil:'domcontentloaded'});await page.waitForURL('**/sales');};
  const hierarchy=async(state,action)=>{const region=page.locator(`section[aria-label="Quotation recovery"][data-recovery-state="${state}"]`);await region.waitFor();const button=region.getByRole('button',{name:action,exact:true});await button.waitFor();if(!before){assert((await button.getAttribute('class')).split(/\s+/).includes('btn-primary'),`${state}: intended next step is primary`);assert.equal(await region.locator('button.btn-primary').count(),1,`${state}: one primary recovery action`);assert(!(await page.getByRole('button',{name:'New enquiry',exact:true}).getAttribute('class')).split(/\s+/).includes('btn-primary'),'New enquiry does not compete with recovery');}await region.scrollIntoViewIfNeeded();await capture(`390-recovery-${state}`);};
  await historyReturn();await hierarchy('ready','Restore quotation');
  await db.salesLead.update({where:{id:lead.id},data:{updatedAt:new Date(Date.now()+1000)}});await historyReturn();await hierarchy('stale','Review latest enquiry');
  await page.goBack({waitUntil:'domcontentloaded'});await page.waitForURL('**/dashboard');await page.route('**/api/sales?leadId=*',route=>route.abort('failed'));await page.goForward({waitUntil:'domcontentloaded'});await page.waitForURL('**/sales');await hierarchy('unavailable','Retry recovery check');await page.unroute('**/api/sales?leadId=*');await within(recoveryContext.close(),3000,'recovery comparison context close');page=undefined;
  const restricted=await contextFor(1440,1000);await login(restricted,'reader@visual.test');await page.locator('main h1').waitFor();await checkNav('READ_ONLY');assert.equal((await restricted.request.get(base+'/api/travel-packages',{timeout:15000})).status(),403,'Read-only staff cannot configure agency packages');await within(restricted.close(),3000,'restricted context close');page=undefined;
  assert.deepEqual(report.errors,[],'No runtime errors');assert.deepEqual(report.blocked,[],'No external traffic');report.passed=true;persist();
 })(),420000,'complete workspace polish comparison');
 }catch(error){report.failure=String(error);persist();if(page)await within(page.screenshot({path:path.join(out,'failure.png'),timeout:3000}),3000,'failure screenshot').catch(()=>{});throw error;}
},async()=>{
 persist();const errors=[];
 if(browser)try{await within(browser.close(),3000,'browser close');}catch(e){errors.push(e);}
 if(db)try{await within(db.$disconnect(),3000,'database close');}catch(e){errors.push(e);}
 if(server.pid){const signal=s=>{try{process.kill(-server.pid,s);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
 const waitGone=async ms=>{const end=Date.now()+ms;while(Date.now()<end){if(!signal(0))return;await new Promise(r=>setTimeout(r,100));}if(signal(0))throw Error('Owned process group still alive');};
 try{if(signal('SIGTERM')){try{await within(waitGone(3000),3500,'fixture SIGTERM');}catch(e){if(e?.code&&e.code!=='ESRCH')throw e;signal('SIGKILL');await within(waitGone(2000),2500,'fixture SIGKILL');}}}catch(e){errors.push(e);}}
 if(errors.length)throw new AggregateError(errors,'Fixture cleanup incomplete');
},error=>{report.passed=false;report.cleanupFailure=String(error);persist();});
