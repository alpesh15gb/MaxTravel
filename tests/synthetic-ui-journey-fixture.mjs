// Shared disposable browser fixture for complete UI journeys; never accepts a deployed URL/database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {chromium} from './browser.mjs';
import {within,withFixtureCleanup} from './fixture-lifecycle.mjs';
export async function runSyntheticJourney(name,port,work){
 const base=`http://127.0.0.1:${port}`,out=path.resolve('test-artifacts',name),metadata=path.resolve('tests/.runtime/visual-review-current.json');
 assert(Number.isInteger(port)&&port>1024&&port<32768);fs.mkdirSync(out,{recursive:true});fs.rmSync(metadata,{force:true});
 const report={scope:'Synthetic real UI and disposable SQLite; no provider delivery, real money or production data',checks:[],errors:[],blocked:[],passed:false};
 let logs='',spawnError='',browser,db,fixture,currentPage;
 const server=spawn(process.execPath,['tests/visual-review-server.mjs'],{detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,REVIEW_PORT:String(port),REVIEW_DEV:'0',APP_ORIGIN:base,WA_PROVIDER:'manual'}});
 // Exit hook is synchronous and targets only this detached process group; errors still fail normally.
 const stopOwnedOnExit=()=>{if(server.pid)try{process.kill(-server.pid,'SIGKILL');}catch{}};process.once('exit',stopOwnedOnExit);
 server.stdout.on('data',v=>logs+=v);server.stderr.on('data',v=>logs+=v);server.on('error',e=>spawnError=String(e));
 const persist=()=>{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(out,'server.log'),logs.replace(/^Review login:.*$/gm,'Review login: [synthetic credentials redacted]'));};
 await withFixtureCleanup(async()=>{try{await within((async()=>{
  for(let i=0;i<160;i++){assert(!spawnError&&server.exitCode===null&&server.signalCode===null,`Fixture exited ${spawnError}\n${logs}`);if(logs.includes('VISUAL REVIEW READY')&&fs.existsSync(metadata)){fixture=JSON.parse(fs.readFileSync(metadata,'utf8'));break;}await new Promise(r=>setTimeout(r,500));}
  assert(fixture&&fixture.base===base&&fixture.runtime.startsWith(path.resolve('tests/.runtime')+path.sep));db=new PrismaClient({datasources:{db:{url:`file:${path.join(fixture.runtime,'test.db')}`}}});
  browser=await chromium.launch({headless:true,timeout:30000});report.engine=browser.browserType().name();report.version=browser.version();
  async function session(width,login=true){
   const context=await browser.newContext({viewport:{width,height:width===1440?1000:844},timezoneId:'Asia/Kolkata',locale:'en-IN',serviceWorkers:'block'});context.setDefaultTimeout(15000);context.setDefaultNavigationTimeout(30000);
   await context.route(url=>url.origin!==base,r=>{const u=new URL(r.request().url());report.blocked.push({origin:u.origin,path:u.pathname});return r.abort('blockedbyclient');});
   await context.routeWebSocket('**/*',s=>{report.blocked.push({transport:'websocket'});return s.close({code:1008,reason:'Isolated fixture'});});
   const page=await context.newPage();currentPage=page;page.on('pageerror',e=>report.errors.push(e.message));
   if(login){await page.goto(base+'/login');await page.getByLabel('Work email',{exact:true}).fill('review@visual.test');await page.getByLabel('Password',{exact:true}).fill('Review-Visual-2026!');await page.getByRole('button',{name:'Sign in to workspace',exact:true}).click();await page.waitForURL('**/dashboard');}return {page,context};
  }
  async function capture(page,label){currentPage=page;await page.evaluate(()=>document.fonts.ready);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' overflow');await page.screenshot({path:path.join(out,label+'.png'),fullPage:true,animations:'disabled'});persist();}
  function observePage(page,phase){currentPage=page;report.phase=phase;persist();}
  async function postResult(page,pathname,click,predicate=()=>true){
   const safePath=pathname.replace(/^(\/api\/upload\/)[^/]+$/,'$1[private-capability]');currentPage=page;
   report.observer={path:safePath,stage:'awaiting UI action and POST response'};persist();
   // Read once as soon as headers arrive, before a successful UI action navigates.
   // Handle rejection immediately; a click failure must not leave an orphan waiter.
   const ready=page.waitForResponse(r=>new URL(r.url()).pathname===pathname&&r.request().method()==='POST'&&predicate((r.request().headers()['content-type']??'').includes('application/json')?r.request().postDataJSON():null),{timeout:20000}).then(async r=>{
    report.observer={path:safePath,stage:'reading response body',status:r.status()};persist();
    const body=await within(r.text(),10000,`${safePath} response body`);assert(r.ok(),`${safePath}: ${r.status()} ${body}`);
    const value=JSON.parse(body);report.observer={path:safePath,stage:'response complete',status:r.status()};persist();return {value};
   }).catch(error=>({error}));
   await click();const result=await ready;if(result.error)throw result.error;return result.value;
  }
  // First request really commits, then loses its acknowledgement. Staff explicitly retries the unchanged form.
  async function lostResponseRetry(page,pathname,button,alert,identity='requestKey'){
   let original,key,calls=0;
   const handler=async route=>{if(route.request().method()!=='POST')return route.fallback();calls++;key=route.request().postDataJSON()[identity];assert(key,'Financial write requires stable request identity');const response=await route.fetch();assert(response.ok());original=await response.json();await route.abort('failed');};
   await page.route('**'+pathname,handler);await button.click();await alert.waitFor();assert.equal(calls,1,'No automatic replay');await page.unroute('**'+pathname,handler);
   const result=await postResult(page,pathname,()=>button.click(),body=>{assert.equal(body[identity],key,'Explicit retry uses original identity');return true;});return {original,result,key};
  }
  await work({base,out,report,db,fixture,session,capture,postResult,lostResponseRetry,observePage,check:(label)=>{report.checks.push(label);persist();}});
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);report.passed=true;persist();console.log(`PASS ${name}: ${report.checks.length} complete UI groups`);
 })(),360000,name);}catch(e){report.failure=String(e);persist();if(currentPage)await currentPage.screenshot({path:path.join(out,'failure.png'),timeout:3000,mask:[currentPage.locator('input[type="password"], code, pre'),...(/\/(account-security|recover)(?:[?#]|$)/.test(currentPage.url())?[currentPage.locator('main')]:[])]}).catch(()=>{});throw e;}
 },async()=>{persist();const errors=[];if(browser)try{await within(browser.close(),3000,'browser close');}catch(e){errors.push(e);}if(db)try{await db.$disconnect();}catch(e){errors.push(e);}if(server.pid){const signal=s=>{try{process.kill(-server.pid,s);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};const gone=async ms=>{const end=Date.now()+ms;while(Date.now()<end){if(!signal(0))return;await new Promise(r=>setTimeout(r,100));}if(signal(0))throw Error('Owned fixture still alive');};try{if(signal('SIGTERM'))try{await gone(3000);}catch{signal('SIGKILL');await gone(2000);}}catch(e){errors.push(e);}}if(errors.length)throw new AggregateError(errors,'Fixture cleanup incomplete');process.removeListener('exit',stopOwnedOnExit);},e=>{report.passed=false;report.cleanupFailure=String(e);persist();});
}
