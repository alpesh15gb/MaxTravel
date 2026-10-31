// Disposable SQLite fixture and loopback browser only. No provider calls or workers.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import { PrismaClient } from "@prisma/client";
import { chromium } from "./browser.mjs";

const out=path.resolve("test-artifacts/workspace-sections"); mkdirSync(out,{recursive:true});
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.on("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const base=`http://127.0.0.1:${port}`, fixtureFile=path.resolve("tests/.runtime/visual-review-current.json");
const child=spawn(process.execPath,["tests/visual-review-server.mjs"],{windowsHide:true,env:{...process.env,REVIEW_PORT:String(port),REVIEW_DEV:"0",WA_PROVIDER:"",APP_ORIGIN:base},stdio:["ignore","pipe","pipe"]});
let logs="",browser,db,fixture,page;child.stdout.on("data",c=>logs+=c);child.stderr.on("data",c=>logs+=c);
const report={checks:[],screens:[],errors:[],passed:false};
const save=()=>{writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));writeFileSync(path.join(out,"server.log"),logs);};
async function shot(name){await page.evaluate(()=>document.fonts.ready);const geometry=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}));assert(geometry.width<=geometry.viewport+1,`${name} must fit viewport`);await page.screenshot({path:path.join(out,name+".png"),fullPage:true,animations:"disabled"});report.screens.push(name);save();}
async function login(context,email){const r=await context.request.post(base+"/api/auth/login",{data:{email,password:"Review-Visual-2026!"}});assert(r.ok(),"Fixture login must succeed");}
const sections=[["/dashboard","Agency overview"],["/workspace/customers","Customers & cases"],["/workspace/operations","Travel operations"],["/workspace/finance","Finance"],["/workspace/communications","Communications"],["/reports","Reports & insights"],["/workspace/administration","Administration"]];
try{
  for(let i=0;i<180&&!logs.includes("VISUAL REVIEW READY");i++){if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,500));}
  assert(logs.includes("VISUAL REVIEW READY"),logs);
  fixture=JSON.parse(readFileSync(fixtureFile,"utf8"));assert.equal(fixture.base,base);assert(fixture.runtime.startsWith(path.resolve("tests/.runtime")+path.sep));
  db=new PrismaClient({datasources:{db:{url:"file:"+path.join(fixture.runtime,"test.db").replaceAll("\\","/")}}});
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:"Asia/Kolkata"});
  await context.route("**/*",r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await login(context,"review@visual.test"); page=await context.newPage(); page.on("pageerror",e=>report.errors.push(e.message));
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:width===1440?1000:844});
    for(const [route,title]of sections){
      await page.goto(base+route,{waitUntil:"networkidle"});
      const main=page.getByRole("main");await main.getByRole("heading",{level:1,name:title,exact:true}).waitFor();
      if(route!=="/reports")await main.getByRole("button",{name:"Refresh workspace",exact:true}).waitFor();
      assert.equal(await main.locator("h1").count(),1);
      assert.equal(await main.locator("a.btn-primary:visible,button.btn-primary:visible").count(),1,"One primary action per screen");
      if(width===390)await page.getByRole("button",{name:"Open navigation",exact:true}).click();
      const nav=page.getByRole("navigation",{name:"Main navigation",exact:true});
      assert.equal(await nav.locator('.workspace-section-nav-heading button[aria-expanded="true"]').count(),1,"Only active section opens");
      assert.equal(await nav.locator(".workspace-nav-section").count(),7);
      if(width===390){await page.keyboard.press("Escape");await page.getByRole("button",{name:"Open navigation",exact:true}).waitFor({state:"visible"});}
      await shot(`${width}-${route.split("/").filter(Boolean).join("-")}`);
    }
  }
  report.checks.push("Seven section destinations, single primary action, one open group, desktop/phone fit, keyboard drawer closure");
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+"/dashboard",{waitUntil:"networkidle"});
  const api=await(await context.request.get(base+"/api/pulse?section=today")).json();
  assert.equal(api.stats.length,4);
  const total=await db.serviceCase.count({where:{closedAt:null,status:{notIn:["COMPLETED","CANCELLED"]}}});
  assert.equal(api.stats.find(s=>s.label==="Active cases").value,String(total));
  const owner=await db.user.findUniqueOrThrow({where:{email:"review@visual.test"}});
  const c=await db.customer.findUniqueOrThrow({where:{id:fixture.customerId}});
  const now=Date.now(),end=Math.floor((now+330*60000)/86400000)*86400000-330*60000+86400000;
  const due=new Date(now+Math.max(1,Math.floor((end-now)/2)));
  const task=await db.task.create({data:{title:"Later today, India time",ownerId:owner.id,branchId:c.branchId,dueAt:due,status:"OPEN",priority:"MEDIUM"}});
  const tomorrow=await db.task.create({data:{title:"Tomorrow must stay outside today's follow-ups",ownerId:owner.id,branchId:c.branchId,dueAt:new Date(end+3600000),status:"OPEN",priority:"MEDIUM"}});
  const urgent=await db.task.create({data:{title:"Urgent future task remains a decision",ownerId:owner.id,branchId:c.branchId,dueAt:new Date(end+7200000),status:"OPEN",priority:"URGENT"}});
  const today=await(await context.request.get(base+"/api/pulse?section=today")).json();
  assert(today.followups.some(i=>i.id===`task:${task.id}`)); assert(!today.followups.some(i=>i.id===`task:${tomorrow.id}`));
  assert(!today.followups.some(i=>i.id===`task:${urgent.id}`));assert(today.items.some(i=>i.id===`task:${urgent.id}`&&i.severity==="URGENT"));
  assert.equal((await context.request.get(base+"/api/pulse?section=invalid")).status(),400);
  report.checks.push("Exact scoped case count and India-day future follow-up boundary");

  // Main entry point creates a real fixture case ID and opens the same journey.
  await page.getByRole("button",{name:"New case",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Register client request",exact:true});
  await dialog.getByRole("combobox",{name:"Customer *",exact:true}).selectOption(c.id);
  await dialog.getByLabel("Request title *",{exact:true}).fill("Dashboard section registration");
  const created=page.waitForResponse(r=>r.url()===base+"/api/cases"&&r.request().method()==="POST");
  await dialog.getByRole("button",{name:"Create case ID",exact:true}).click();
  const createdData=await(await created).json();assert(createdData.caseId);await page.waitForURL(base+"/cases/"+createdData.caseId);
  assert.equal((await db.serviceCase.findUniqueOrThrow({where:{id:createdData.caseId}})).customerId,c.id);
  report.checks.push("Dashboard New case → existing customer → permanent case ID → journey");

  const role=await db.role.findUniqueOrThrow({where:{key:"TICKETING_EXECUTIVE"}});
  const staff=await db.user.create({data:{name:"Section Staff",employeeCode:"SECTIONS-STAFF",email:"sections-staff@visual.test",phone:"",passwordHash:owner.passwordHash,roleId:role.id,branchId:c.branchId}});
  const mine=await db.customer.create({data:{code:"SECTION-MINE",name:"Assigned Section Customer",phone:"+919000001011",city:"Test",branchId:c.branchId,assignedToId:staff.id}});
  const staffContext=await browser.newContext({viewport:{width:390,height:844}});await login(staffContext,staff.email);
  const restricted=await(await staffContext.request.get(base+"/api/pulse?section=today")).json();
  assert.equal(restricted.mode,"personal");assert.equal(restricted.scope,"Assigned to you");assert.equal(restricted.stats.find(s=>s.label==="Active cases").value,"0");
  assert(!JSON.stringify(restricted).includes(c.name));assert(!restricted.sections.some(s=>s.id==="reports"||s.id==="administration"));
  assert.equal((await staffContext.request.get(base+"/api/pulse?section=administration")).status(),403);
  assert.equal((await staffContext.request.get(base+"/api/pulse?section=reports")).status(),403);
  assert.equal((await staffContext.request.post(base+"/api/payments",{data:{customerId:mine.id,amount:1}})).status(),403);
  const staffPage=await staffContext.newPage();await staffPage.goto(base+"/dashboard",{waitUntil:"networkidle"});await staffPage.getByRole("heading",{name:"My work",exact:true}).waitFor();
  await staffPage.getByRole("button",{name:"New case",exact:true}).click();const staffDialog=staffPage.getByRole("dialog",{name:"Register client request",exact:true});
  await staffDialog.getByRole("combobox",{name:"Customer *",exact:true}).selectOption(mine.id);
  assert.equal(await staffDialog.getByRole("link",{name:"Add a new customer in another tab"}).count(),0);
  assert.deepEqual(await staffDialog.getByRole("combobox",{name:"Requested service",exact:true}).locator("option").evaluateAll(options=>options.map(o=>o.value)),["FLIGHT","HOTEL"]);
  await staffDialog.getByLabel("Request title *",{exact:true}).fill("Assigned staff ticket request");
  const staffCreated=staffPage.waitForResponse(r=>r.url()===base+"/api/cases"&&r.request().method()==="POST");await staffDialog.getByRole("button",{name:"Create case ID",exact:true}).click();assert((await staffCreated).ok());
  const staffPulse=await(await staffContext.request.get(base+"/api/pulse?section=today")).json();assert.equal(staffPulse.stats.find(s=>s.label==="Active cases").value,"1");
  await staffPage.goto(base+"/workspace/administration");await staffPage.waitForURL("**/dashboard?denied=**");
  await staffContext.close();report.checks.push("Staff assignment isolation, permission-filtered sections/services, server-side denied finance/admin writes, and staff case continuity");

  const readerRole=await db.role.findUniqueOrThrow({where:{key:"READ_ONLY"}});
  const reader=await db.user.create({data:{name:"Section Reader",employeeCode:"SECTIONS-READER",email:"sections-reader@visual.test",phone:"",passwordHash:owner.passwordHash,roleId:readerRole.id}});
  const readerContext=await browser.newContext();await login(readerContext,reader.email);
  const readerData=await(await readerContext.request.get(base+"/api/pulse?section=customers")).json();assert.deepEqual(readerData.caseServices,[]);assert.equal(readerData.actions.length,0);
  await readerContext.close();report.checks.push("Read-only access exposes section tools without write launchers");
  assert.deepEqual(report.errors,[]);report.passed=true;save();console.log(`PASS workspace sections: ${report.screens.length} captures, ${report.checks.length} navigation/scope/transaction checks. Artifacts: ${out}`);
}catch(e){if(page)await page.screenshot({path:path.join(out,"failure.png"),fullPage:true}).catch(()=>{});throw e;}
finally{save();await db?.$disconnect();await browser?.close();if(fixture?.serverPid)try{process.kill(fixture.serverPid);}catch{}child.kill();}
