// Complete screen inventory and daily transactions in a disposable CRM fixture.
// Does not start workers or call suppliers, payment gateways or messaging services.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import { PrismaClient } from "@prisma/client";
import { chromium } from "./browser.mjs";

const root=process.cwd(),out=path.resolve("test-artifacts/crm-revamp-2026-10-30");
mkdirSync(out,{recursive:true});
const port=await new Promise((resolve,reject)=>{const socket=net.createServer();socket.on("error",reject);socket.listen(0,"127.0.0.1",()=>{const value=socket.address().port;socket.close(()=>resolve(value));});});
const base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,["tests/visual-review-server.mjs"],{cwd:root,env:{...process.env,REVIEW_PORT:String(port),REVIEW_DEV:"0",WA_PROVIDER:"manual",APP_ORIGIN:base},stdio:["ignore","pipe","pipe"]});
let logs="",fixture,browser,db,page;
child.stdout.on("data",value=>logs+=value);child.stderr.on("data",value=>logs+=value);
const report={screens:[],transactions:[],externalRequestsBlocked:0,runtimeErrors:[],passed:false};
const persist=()=>{writeFileSync(path.join(out,"report.json"),JSON.stringify(report,null,2));writeFileSync(path.join(out,"server.log"),logs);};
async function snapshot(name){await page.evaluate(()=>document.fonts.ready);const geometry=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));assert(geometry.width<=geometry.viewport+1,`${name}: page must not overflow horizontally (${geometry.width}/${geometry.viewport})`);await page.screenshot({path:path.join(out,`${name}.png`),fullPage:true,animations:"disabled"});return geometry;}
async function go(route){const response=await page.goto(base+route,{waitUntil:"networkidle"});assert(response&&response.status()<400,`${route} returned ${response?.status()}`);await page.locator("main h1").first().waitFor();}
async function login(context,email="review@visual.test"){const response=await context.request.post(base+"/api/auth/login",{data:{email,password:"Review-Visual-2026!"}});assert(response.ok(),"Synthetic user must sign in");}
try{
  for(let attempt=0;attempt<180;attempt++){if(child.exitCode!==null)throw Error("Fixture server exited before ready");if(logs.includes("VISUAL REVIEW READY"))break;await new Promise(resolve=>setTimeout(resolve,500));}
  assert(logs.includes("VISUAL REVIEW READY"),"Fixture did not become ready");
  fixture=JSON.parse(readFileSync("tests/.runtime/visual-review-current.json","utf8"));assert.equal(fixture.base,base);assert(fixture.runtime.startsWith(path.resolve("tests/.runtime")+path.sep));
  db=new PrismaClient({datasources:{db:{url:`file:${path.join(fixture.runtime,"test.db")}`}}});
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:"en-IN",timezoneId:"Asia/Kolkata"});
  await context.route("**/*",route=>{if(new URL(route.request().url()).origin===base)return route.continue();report.externalRequestsBlocked++;return route.abort();});
  await login(context);page=await context.newPage();page.setDefaultTimeout(15000);page.on("pageerror",error=>report.runtimeErrors.push(error.message));page.on("console",message=>{if(message.type()==="error"&&/hydration|server rendered HTML|Encountered a script tag/i.test(message.text()))report.runtimeErrors.push(message.text());});
  const owner=await db.user.findUniqueOrThrow({where:{email:"review@visual.test"}});
  const invoice=await db.invoice.findFirstOrThrow({where:{customerId:fixture.customerId}});
  const routes=[
    ["today","/dashboard"],["start-work","/work"],["sales","/sales"],["customers","/customers"],["customer",`/customers/${fixture.customerId}`],
    ["tasks","/tasks"],["bookings","/ticketing"],["new-flight","/ticketing/new"],["new-hotel","/ticketing/new?product=HOTEL"],["booking",`/ticketing/${fixture.bookingId}`],
    ["online-bookings","/online-bookings"],["hotel-booking",`/ticketing/${fixture.onlineBookingId}`],["stay-record",`/ticketing/${fixture.onlineBookingId}/stay`],
    ["visa","/visa"],["new-visa","/visa/new"],["visa-case",`/visa/${fixture.visaCaseId}`],["requirements",`/visa-requirements?case=${fixture.visaCaseId}`],
    ["documents","/documents"],["incoming","/incoming-documents"],["whatsapp","/whatsapp"],["payments","/payments"],["invoice-print",`/payments/print?invoice=${invoice.id}`],
    ["advances","/advances"],["refunds","/refunds"],["suppliers","/suppliers"],["reports","/reports"],["packages","/travel-packages"],
    ["team","/employees"],["employee",`/employees/${owner.id}`],["import","/customer-tools"],["checklists","/checklists"],["audit","/audit"],
    ["settings","/settings"],["notifications","/notifications"],["account-security","/account-security"],
  ];
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:width===1440?1000:844});
    for(const [name,route]of routes){await go(route);assert.equal(await page.getByRole("main").getByRole("heading",{level:1}).count(),1,`${name}: one clear page title`);const geometry=await snapshot(`${width}-${name}`);report.screens.push({name,route:route.split("?")[0].replace(/\/c[a-z0-9]{20,}/g,"/{record}"),width,...geometry});persist();}
  }
  await page.setViewportSize({width:1440,height:1000});
  await go("/work");await page.getByRole("button",{name:"Screen guide",exact:true}).click();assert(await page.getByRole("dialog",{name:"Start work",exact:true}).isVisible());await page.getByRole("button",{name:"Close screen guide",exact:true}).click();
  await page.getByRole("searchbox",{name:"Find a workflow",exact:true}).fill("customer payment");assert.equal(await page.locator(".workflow-card").count(),1);assert.equal(await page.locator(".workflow-card").getAttribute("href"),"/payments?action=record");
  report.transactions.push("Searchable role-scoped transaction launch and screen guide");

  // New hotel records must remain HOTEL enquiries; a supplied reference cannot invent confirmation.
  await go(`/ticketing/new?customer=${fixture.customerId}&product=HOTEL`);
  await page.getByRole("group",{name:"Travellers",exact:true}).getByRole("checkbox").first().check();await page.getByRole("button",{name:"Continue",exact:true}).click();
  await page.getByLabel("Hotel name *",{exact:true}).fill("Synthetic daily-work hotel");await page.getByLabel("Check-in *",{exact:true}).fill("2027-02-20");await page.getByLabel("Check-out *",{exact:true}).fill("2027-02-19");await page.getByRole("button",{name:"Continue",exact:true}).click();assert(await page.getByRole("alert").filter({hasText:"Check-out must be after check-in"}).isVisible());
  await page.getByLabel("Check-out *",{exact:true}).fill("2027-02-24");await page.getByLabel("Supplier confirmation reference (optional)",{exact:true}).fill("SYN-HOTEL-1");await page.getByRole("button",{name:"Continue",exact:true}).click();
  await page.getByLabel("Stay price before taxes (INR)",{exact:true}).fill("10000");await page.getByLabel("Taxes (INR)",{exact:true}).fill("1000");await page.getByLabel("Markup (INR)",{exact:true}).fill("500");await page.getByLabel("Service fee (INR)",{exact:true}).fill("500");await page.getByLabel("Known supplier cost (INR)",{exact:true}).fill("9500");
  await snapshot("transaction-hotel-review");const createdResponse=page.waitForResponse(response=>response.url()===base+"/api/bookings"&&response.request().method()==="POST");await page.getByRole("button",{name:"Create booking",exact:true}).click();const created=await(await createdResponse).json();assert(created.bookingId);await page.waitForURL(base+`/ticketing/${created.bookingId}`);
  const hotel=await db.booking.findUniqueOrThrow({where:{id:created.bookingId}});assert.equal(hotel.product,"HOTEL");assert.equal(hotel.status,"ENQUIRY");assert.equal(hotel.sellingPrice,12000);assert.equal(hotel.ticketingDeadline,null);assert.equal(hotel.hotelName,"Synthetic daily-work hotel");
  const invalid=await context.request.post(base+"/api/bookings",{data:{customerId:fixture.customerId,product:"HOTEL",hotelName:"Invalid stay",hotelCheckIn:"2027-02-24",hotelCheckOut:"2027-02-20",travellerIds:[]}});assert.equal(invalid.status(),400);
  report.transactions.push("Guided hotel entry, invalid-date rejection, correct product/price and no invented confirmation");

  await page.getByRole("link",{name:"Record payment",exact:true}).click();const dialog=page.getByRole("dialog",{name:"Record a payment",exact:true});await dialog.waitFor();await dialog.getByLabel(/^03 \/ Amount received \(INR\) \*/).fill("1000");assert(await dialog.getByRole("region",{name:"Review transaction before saving"}).isVisible());const paidResponse=page.waitForResponse(response=>response.url()===base+"/api/payments"&&response.request().method()==="POST");await dialog.getByRole("button",{name:"Save receipt",exact:true}).click();const paid=await(await paidResponse).json();assert(paid.receiptNo);const receipt=await db.payment.findUniqueOrThrow({where:{id:paid.payment.id}});assert.equal(receipt.bookingId,hotel.id);assert.equal(receipt.amount,1000);report.transactions.push("Contextual payment handoff, explicit review, real fixture receipt and booking allocation");

  await go(`/visa/new?customer=${fixture.customerId}`);await page.getByRole("group",{name:"Applicants",exact:true}).getByRole("checkbox").first().check();await page.getByRole("button",{name:"Continue",exact:true}).click();await page.getByLabel("Destination country *",{exact:true}).fill("Schengen (Germany)");await page.getByLabel("Visa type *",{exact:true}).fill("Tourist");await page.getByLabel(/^Checklist/).selectOption({index:1});await page.getByRole("button",{name:"Continue",exact:true}).click();await page.getByLabel("Visa fee (INR)",{exact:true}).fill("7500");await page.getByLabel("Service fee (INR)",{exact:true}).fill("2500");await snapshot("transaction-visa-review");const visaResponse=page.waitForResponse(response=>response.url()===base+"/api/visa/cases"&&response.request().method()==="POST");await page.getByRole("button",{name:"Create visa case",exact:true}).click();const visa=await(await visaResponse).json();assert(visa.caseId);await page.waitForURL(base+`/visa/${visa.caseId}`);assert.equal(await db.document.count({where:{visaCaseId:visa.caseId}}),2);report.transactions.push("Guided visa entry with matching per-applicant checklist and fees");

  await go("/sales?action=new");await page.getByRole("heading",{name:"New enquiry",exact:true}).waitFor();await page.waitForURL(base+"/sales");await go("/tasks?action=new");assert(await page.getByRole("dialog").isVisible());await page.waitForURL(base+"/tasks");await page.getByRole("dialog").getByRole("button",{name:"Cancel",exact:true}).click();report.transactions.push("Enquiry and follow-up launch links open the entry workspace directly");

  await go("/reports?report=receipts");const generate=page.getByRole("button",{name:"Generate report",exact:true});await generate.waitFor();await page.waitForFunction(()=>!document.querySelector('button[form="report-filters"]').disabled);await generate.click();await page.getByRole("table").waitFor();assert(await page.getByRole("link",{name:paid.receiptNo,exact:true}).isVisible());const exportHref=await page.getByRole("link",{name:"Download CSV",exact:true}).getAttribute("href");const csvResponse=await context.request.get(base+exportHref);assert(csvResponse.ok());assert((await csvResponse.text()).includes(paid.receiptNo));const appliedURL=page.url();assert(appliedURL.includes("report=receipts")&&appliedURL.includes("from=")&&appliedURL.includes("to="));const originalTo=await page.getByLabel("Through",{exact:true}).inputValue();await page.getByLabel("Through",{exact:true}).fill("2026-10-01");assert.equal(await page.getByRole("link",{name:"Download CSV",exact:true}).getAttribute("href"),exportHref);await page.getByRole("button",{name:"Restore applied filters",exact:true}).click();assert.equal(await page.getByLabel("Through",{exact:true}).inputValue(),originalTo);await page.reload();await page.getByRole("button",{name:"Generate report",exact:true}).waitFor();assert.equal(await page.getByLabel("Through",{exact:true}).inputValue(),originalTo);await page.getByRole("button",{name:"Browse report library",exact:true}).click();assert(await page.getByRole("dialog",{name:"Report library",exact:true}).isVisible());await page.getByRole("searchbox",{name:"Search reports",exact:true}).fill("supplier");assert.equal(await page.getByRole("button",{name:"Customer statement",exact:true}).count(),0);await snapshot("report-library-filtered");await page.getByRole("dialog").getByRole("button",{name:"Close",exact:true}).click();report.transactions.push("Receipt report reconciles to a new transaction, complete CSV, draft/applied filter isolation and reloadable criteria");

  const readRole=await db.role.findUniqueOrThrow({where:{key:"READ_ONLY"}});await db.user.create({data:{employeeCode:"REVAMP-READER",name:"Revamp reader",email:"revamp-reader@visual.test",phone:"",passwordHash:owner.passwordHash,roleId:readRole.id}});const readContext=await browser.newContext({viewport:{width:390,height:844}});await login(readContext,"revamp-reader@visual.test");const reader=await readContext.newPage();await reader.goto(base+"/work");await reader.getByRole("heading",{name:"What do you need to do?",exact:true}).waitFor();assert.equal(await reader.locator('.workflow-card[href="/ticketing/new"]').count(),0);assert.equal(await reader.locator('.workflow-card[href="/payments?action=record"]').count(),0);const forbidden=await readContext.request.post(base+"/api/bookings",{data:{product:"HOTEL"}});assert.equal(forbidden.status(),403);await readContext.close();report.transactions.push("Read-only staff have no write launchers and remain denied by the server");
  const publicContext=await browser.newContext({viewport:{width:390,height:844}});const publicPage=await publicContext.newPage();for(const route of ["/login","/recover","/proposal","/setup"]){await publicPage.goto(base+route,{waitUntil:"networkidle"});const width=await publicPage.evaluate(()=>document.documentElement.scrollWidth);assert(width<=391,`Public screen ${route} must fit phone width`);await publicPage.screenshot({path:path.join(out,`390-public-${route.slice(1)}.png`),fullPage:true});}await publicContext.close();
  assert.deepEqual(report.runtimeErrors,[]);report.passed=true;persist();console.log(`PASS ${report.screens.length} desktop/phone screen captures and ${report.transactions.length} daily-work journeys. Artifacts: ${out}`);
}catch(error){if(page){try{await page.screenshot({path:path.join(out,"failure.png"),fullPage:true});writeFileSync(path.join(out,"failure.html"),await page.content());}catch{}}throw error;}
finally{persist();await db?.$disconnect();await browser?.close();if(fixture?.serverPid)try{process.kill(fixture.serverPid);}catch{}child.kill();}
