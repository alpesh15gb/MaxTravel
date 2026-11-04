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
const child=spawn(process.execPath,["tests/visual-review-server.mjs"],{windowsHide:true,env:{...process.env,REVIEW_PORT:String(port),REVIEW_DEV:"0",APP_ORIGIN:base},stdio:["ignore","pipe","pipe"]});
let logs="",browser,db,fixture,page;child.stdout.on("data",c=>logs+=c);child.stderr.on("data",c=>logs+=c);
const report={checks:[],screens:[],errors:[],passed:false};
const save=()=>{writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));writeFileSync(path.join(out,"server.log"),logs);};
async function shot(name){await page.evaluate(()=>document.fonts.ready);const geometry=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}));assert(geometry.width<=geometry.viewport+1,`${name} must fit viewport`);await page.screenshot({path:path.join(out,name+".png"),fullPage:true,animations:"disabled"});report.screens.push(name);save();}
async function login(context,email){const r=await context.request.post(base+"/api/auth/login",{data:{email,password:"Review-Visual-2026!"}});assert(r.ok(),"Fixture login must succeed");}
const sections=[["/today","Today"],["/trips","Trips"],["/masters","Customers"],["/work","Team work"],["/suppliers","Suppliers & payables"],["/reports","Reports"],["/workspace/administration","Settings"]];
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
      if(["/workspace/finance","/workspace/administration"].includes(route))await main.getByRole("button",{name:"Refresh workspace",exact:true}).waitFor();
      assert.equal(await main.locator("h1").count(),1);
      assert.equal(await main.locator("a.btn-primary:visible,button.btn-primary:visible").count(),1,"One primary action per screen: "+route);
      if(width===390)await page.getByRole("button",{name:"Open navigation",exact:true}).click();
      const nav=page.getByRole("navigation",{name:"Main navigation",exact:true});
      assert.equal(await page.getByRole("link",{name:/WhatsApp/i}).count(),0,"Removed channel has no remaining navigation or action");
      assert.deepEqual(await nav.getByRole("link").allTextContents(),["Today","Trips","Customers","Suppliers","Reports"]);
      if(width===390){await page.keyboard.press("Escape");await page.getByRole("button",{name:"Open navigation",exact:true}).waitFor({state:"visible"});}
      await shot(`${width}-${route.split("/").filter(Boolean).join("-")}`);
    }
  }
  report.checks.push("Five primary destinations, legacy routes, single primary action, desktop/phone fit, keyboard drawer closure");
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+"/today",{waitUntil:"networkidle"});
  const api=await(await context.request.get(base+"/api/pulse?section=today")).json();
  assert.equal(api.stats.length,3);
  const total=await db.serviceCase.count({where:{closedAt:null,status:{notIn:["COMPLETED","CANCELLED"]}}});
  assert.equal(api.stats.find(s=>s.label==="Active Max IDs").value,String(total));
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

  // Today's New trip → existing customer → what they need → a permanent Max ID linked to the booking form.
  await page.getByRole("main").getByRole("link",{name:"New trip",exact:true}).click();await page.waitForURL(base+"/trips/new");
  await page.getByLabel("Search customers").fill(c.code);
  await page.getByRole("main").getByRole("button").filter({hasText:c.code}).first().click();
  await page.getByRole("radio",{name:/^Flight/}).click();
  await page.getByLabel("Trip name (optional)").fill("Today section registration");
  const created=page.waitForResponse(r=>r.url()===base+"/api/cases"&&r.request().method()==="POST");
  await page.getByRole("button",{name:"Start trip",exact:true}).click();
  const createdData=await(await created).json();assert(createdData.caseId);await page.waitForURL(`${base}/ticketing/new?case=${createdData.caseId}&product=FLIGHT`);
  assert.equal((await db.serviceCase.findUniqueOrThrow({where:{id:createdData.caseId}})).customerId,c.id);
  report.checks.push("Today New trip → existing customer → permanent Max ID → booking form for that trip");

  const role=await db.role.findUniqueOrThrow({where:{key:"TICKETING_EXECUTIVE"}});
  const staff=await db.user.create({data:{name:"Section Staff",employeeCode:"SECTIONS-STAFF",email:"sections-staff@visual.test",phone:"",passwordHash:owner.passwordHash,roleId:role.id,branchId:c.branchId}});
  const mine=await db.customer.create({data:{code:"SECTION-MINE",name:"Assigned Section Customer",phone:"+919000001011",city:"Test",branchId:c.branchId,assignedToId:staff.id}});
  const staffContext=await browser.newContext({viewport:{width:390,height:844}});await login(staffContext,staff.email);
  const restricted=await(await staffContext.request.get(base+"/api/pulse?section=today")).json();
  assert.equal(restricted.mode,"personal");assert.equal(restricted.scope,"Assigned to you");assert.equal(restricted.stats.find(s=>s.label==="Active Max IDs").value,"0");
  assert(!JSON.stringify(restricted).includes(c.name));assert(!restricted.sections.some(s=>s.id==="administration"));assert(restricted.sections.some(s=>s.id==="reports"&&s.href==="/reports/work"));
  assert.equal((await staffContext.request.get(base+"/api/pulse?section=administration")).status(),403);
  const personalReports=await staffContext.request.get(base+"/api/pulse?section=reports");assert.equal(personalReports.status(),200);assert((await personalReports.json()).links.every(l=>l.href==="/reports/work"));
  assert.equal((await staffContext.request.post(base+"/api/payments",{data:{customerId:mine.id,amount:1}})).status(),403);
  const staffPage=await staffContext.newPage();await staffPage.goto(base+"/today",{waitUntil:"networkidle"});await staffPage.getByRole("heading",{name:"Today",exact:true}).waitFor();
  await staffPage.goto(base+"/trips/new",{waitUntil:"networkidle"});
  await staffPage.getByLabel("Search customers").fill(mine.code);
  assert.equal(await staffPage.getByRole("main").getByRole("button").filter({hasText:c.code}).count(),0,"Assigned staff cannot pick other customers");
  await staffPage.getByRole("main").getByRole("button").filter({hasText:mine.code}).first().click();
  assert.deepEqual((await staffPage.getByRole("radio").allTextContents()).map(t=>t.replace(/(Book|Bus|Start|Not).*/,"").trim()),["Flight","Hotel","Other"]);
  await staffPage.getByRole("radio",{name:/^Flight/}).click();await staffPage.getByLabel("Trip name (optional)").fill("Assigned staff ticket request");
  const staffCreated=staffPage.waitForResponse(r=>r.url()===base+"/api/cases"&&r.request().method()==="POST");await staffPage.getByRole("button",{name:"Start trip",exact:true}).click();assert((await staffCreated).ok());
  const staffPulse=await(await staffContext.request.get(base+"/api/pulse?section=today")).json();assert.equal(staffPulse.stats.find(s=>s.label==="Active Max IDs").value,"1");
  await staffPage.goto(base+"/workspace/administration");await staffPage.waitForURL("**/today?denied=**");
  await staffContext.close();report.checks.push("Staff assignment isolation, permission-filtered sections/services, server-side denied finance/admin writes, and staff case continuity");

  const readerRole=await db.role.findUniqueOrThrow({where:{key:"READ_ONLY"}});
  const reader=await db.user.create({data:{name:"Section Reader",employeeCode:"SECTIONS-READER",email:"sections-reader@visual.test",phone:"",passwordHash:owner.passwordHash,roleId:readerRole.id}});
  const readerContext=await browser.newContext();await login(readerContext,reader.email);
  const readerData=await(await readerContext.request.get(base+"/api/pulse?section=customers")).json();
  assert.deepEqual(readerData.caseServices,[],"Read-only staff cannot launch new service work");
  assert.deepEqual(readerData.actions.map(({id,href,permission})=>({id,href,permission})),[{id:"documents",href:"/documents",permission:"document:view"}],"Read-only Masters offers exactly the permitted document-view action and no write launchers");
  assert.equal((await readerContext.request.get(base+"/documents")).status(),200,"Read-only staff can open the document register");
  const protectedDocument=await db.document.findFirstOrThrow({where:{customerId:fixture.customerId}});
  const deniedReview=await readerContext.request.post(base+"/api/documents/verify",{data:{documentId:protectedDocument.id,decision:"ACCEPTED"}});
  assert.equal(deniedReview.status(),403,"Document view permission never authorizes verification");
  assert.deepEqual(await db.document.findUniqueOrThrow({where:{id:protectedDocument.id}}),protectedDocument,"Denied verification leaves all document fields unchanged");
  await readerContext.close();report.checks.push("Read-only staff can inspect documents, receive no write launchers, and cannot verify or mutate a document");
  assert.deepEqual(report.errors,[]);report.passed=true;save();console.log(`PASS workspace sections: ${report.screens.length} captures, ${report.checks.length} navigation/scope/transaction checks. Artifacts: ${out}`);
}catch(e){if(page)await page.screenshot({path:path.join(out,"failure.png"),fullPage:true}).catch(()=>{});throw e;}
finally{save();await db?.$disconnect();await browser?.close();if(fixture?.serverPid)try{process.kill(fixture.serverPid);}catch{}child.kill();}
