// Isolated browser/API verification. No live database or external messaging provider.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdirSync,readFileSync,createWriteStream,writeFileSync} from "node:fs";
import path from "node:path";
import net from "node:net";
import {chromium} from "./browser.mjs";
import {PrismaClient} from "@prisma/client";
import {createReportDiagnostics,reportClientState,probeReportServer} from "./reporting-diagnostics.mjs";
const root=process.cwd(),artifactDir=path.join("test-artifacts/reporting",`${Date.now()}-${process.pid}`);mkdirSync(artifactDir,{recursive:true});
const diagnostic=createReportDiagnostics(),lastReportReads=new WeakMap();
function observeReports(target) {
 target.on("request",request=>{diagnostic.request(request);const url=new URL(request.url());if(request.method()==="GET"&&url.origin===base&&url.pathname==="/api/reports/accounts"&&url.searchParams.has("report")&&!url.searchParams.has("format"))lastReportReads.set(target,request.url());});
 target.on("response",diagnostic.response);target.on("requestfinished",diagnostic.finished);target.on("requestfailed",diagnostic.failed);
}
writeFileSync(path.join(artifactDir,"invocation.json"),JSON.stringify({startedAt:new Date().toISOString(),commit:process.env.GITHUB_SHA||null,run:process.env.GITHUB_RUN_ID||null,pid:process.pid},null,2));
console.log(`Reporting evidence: ${artifactDir}`);
// Capture real settled UI, not a responsive drawer transition or an autoscrolled sticky header.
// No CSS injection, forced focus, hidden UI or suppressed application animation is used.
async function settleShell(target) {
 await target.evaluate(()=>document.fonts.ready);
 await target.waitForFunction(()=>{const rail=document.querySelector("aside.app-sidebar");if(!rail)return false;const style=getComputedStyle(rail);const settled=rail.getAnimations().every(a=>!a.pending&&a.playState!=="running");return settled&&(window.innerWidth>=1024?style.visibility!=="hidden":rail.getAttribute("data-drawer")==="closed"&&style.visibility==="hidden");});
 await target.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
async function viewport(target,width,height) { await target.setViewportSize({width,height});await settleShell(target); }
async function capture(target,name,fullPage=true) {
 await settleShell(target);
 await target.evaluate(()=>window.scrollTo({top:0,left:0,behavior:"instant"}));
 await target.waitForFunction(()=>window.scrollY===0&&window.scrollX===0);
 await target.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await target.screenshot({path:path.join(artifactDir,`${name}.png`),fullPage});
}

const port=await new Promise(resolve=>{const s=net.createServer().listen(0,"127.0.0.1",()=>{const port=s.address().port;s.close(()=>resolve(port));});});
const base=`http://127.0.0.1:${port}`,log=createWriteStream(path.join(artifactDir,"browser-server.log"));
const server=spawn(process.execPath,["tests/visual-review-server.mjs"],{cwd:root,env:{...process.env,REVIEW_PORT:String(port)},stdio:["ignore","pipe","pipe"]});server.stdout.pipe(log);server.stderr.pipe(log);
let output="",browser,fixture,page,activePage,db;server.stdout.on("data",c=>output+=c.toString());
try{
 for(let i=0;i<180;i++){if(server.exitCode!==null)throw new Error("Review server failed; inspect browser-server.log");if(output.includes("VISUAL REVIEW READY"))break;await new Promise(r=>setTimeout(r,500));}
 assert(output.includes("VISUAL REVIEW READY"),"Review server timeout");fixture=JSON.parse(readFileSync("tests/.runtime/visual-review-current.json","utf8"));assert.equal(fixture.base,base);
 assert(fixture.runtime.startsWith(path.resolve("tests/.runtime")+path.sep),"Only an owned isolated fixture database is allowed");
 db=new PrismaClient({datasources:{db:{url:`file:${path.join(fixture.runtime,"test.db")}`}}});
 const owner=await db.user.findUniqueOrThrow({where:{email:"review@visual.test"}}),readerRole=await db.role.findUniqueOrThrow({where:{key:"READ_ONLY"}});
 await db.user.create({data:{employeeCode:"REPORT-READER",name:"Report reader",email:"report-reader@visual.test",phone:"",passwordHash:owner.passwordHash,roleId:readerRole.id}});
 browser=await chromium.launch({headless:true});diagnostic.mark("browser-version",{version:browser.version()});const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const login=await context.request.post(base+"/api/auth/login",{data:{email:"review@visual.test",password:"Review-Visual-2026!"}});assert(login.ok());
 const supplierResponse=await context.request.post(base+"/api/suppliers",{data:{name:"Aero consolidator",type:"CONSOLIDATOR"}});assert(supplierResponse.ok());const supplier=(await supplierResponse.json()).supplier;
 const dueResponse=await context.request.post(base+"/api/suppliers/dues",{data:{supplierId:supplier.id,description:"Review airline settlement",amount:18000,dueDate:new Date(Date.now()+330*60000).toISOString().slice(0,10)}});assert(dueResponse.ok());
 page=await context.newPage();activePage=page;page.setDefaultTimeout(15000);const errors=[];page.on("pageerror",e=>errors.push(e.message));
 observeReports(page);
 await page.goto(base+`/reports?report=statement&customerId=${fixture.customerId}`);
 await page.getByRole("button",{name:"Generate report",exact:true}).waitFor({state:"visible"});await page.waitForFunction(()=>{const button=Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Generate report");return button&&!button.disabled;});
 await page.getByRole("navigation",{name:"Report catalogue",exact:true}).getByText("Customer accounts",{exact:true}).waitFor();
 await page.getByRole("searchbox",{name:"Search reports",exact:true}).fill("supplier");
 assert.equal(await page.getByRole("button",{name:"Sales & margin",exact:true}).count(),0);
 assert.equal(await page.getByRole("button",{name:"Supplier statement",exact:true}).count(),1);
 await page.getByRole("searchbox",{name:"Search reports",exact:true}).fill("no-such-report");
 await page.getByRole("button",{name:"Clear search",exact:true}).click();
 await capture(page,"catalogue-1440");
 for(const width of [390,320]){
  await viewport(page,width,844);await page.evaluate(()=>window.scrollTo(0,0));
  const bounds=await page.getByRole("button",{name:"Generate report",exact:true}).boundingBox();
  assert(bounds&&bounds.y>=64&&bounds.y+bounds.height<=844,`${width}px: initial Generate action is visible without autoscroll`);
  await capture(page,`catalogue-${width}-viewport`,false);
 }
 await viewport(page,1440,1000);

 await page.getByRole("button",{name:"Generate report",exact:true}).click();
 await page.getByRole("table",{name:"Customer statement",exact:true}).waitFor();
 assert(await page.getByText("₹81,400",{exact:true}).count()>=1,"Customer closing balance should be 81400");
 await capture(page,"statement-desktop");
 const pdfResponse=await context.request.get(base+`/api/reports/accounts?report=statement&customerId=${fixture.customerId}&format=pdf`);assert.equal(pdfResponse.status(),200);writeFileSync(path.join(artifactDir,"customer-statement.pdf"),await pdfResponse.body());
 const downloadPromise=page.waitForEvent("download");await page.getByRole("link",{name:"Download XLSX",exact:true}).click();const download=await downloadPromise;await download.saveAs(path.join(root,path.join(artifactDir,"customer-statement.xlsx")));
 await page.getByRole("button",{name:"Outstanding & ageing",exact:true}).click();await page.getByRole("button",{name:"Generate report",exact:true}).click();await page.getByRole("table",{name:"Customer outstanding and ageing",exact:true}).waitFor();
 await page.getByRole("button",{name:"Set payment terms",exact:true}).click();await page.getByRole("heading",{name:"Set payment terms",exact:true}).waitFor();
 assert.equal(await page.getByRole("combobox",{name:"Obligation",exact:true}).getByRole("option",{name:/ON-2026-0001/}).count(),0,"Platform-managed terms must not be offered for editing");
 assert.match(await page.getByRole("combobox",{name:"Obligation",exact:true}).locator("option:checked").innerText(),/BK-2026-0001/,"Largest eligible local booking is selected by default");
 let releaseTerms,termsHandled=false;const termsReceived=new Promise((resolve,reject)=>{releaseTerms={ready:resolve,failed:reject,finish:null};});
 // The route can reject before click() resolves; awaiting the original gate below still propagates its failure.
 void termsReceived.catch(()=>{});
 // Keep this narrow handler registered: Chromium <155 can orphan the next fetch when
 // the final times:1 route triggers Fetch.disable (microsoft/playwright#41802).
 await page.route("**/api/reports/terms",async route=>{if(termsHandled)return route.continue();termsHandled=true;try{diagnostic.mark("held-terms-start");const response=await route.fetch();diagnostic.mark("held-terms-server-response",{status:response.status()});assert(response.ok(),"The real payment-terms write must succeed before testing its pending UI");releaseTerms.finish=async()=>{diagnostic.mark("held-terms-release-start");await route.fulfill({response});diagnostic.mark("held-terms-release-finished");};releaseTerms.ready();}catch(error){diagnostic.mark("held-terms-failed",{name:error?.name||"Error"});releaseTerms.failed(error);await route.abort().catch(()=>{});}});
 await page.getByLabel("Payment due date",{exact:true}).fill(new Date(Date.now()+330*60000-86400000).toISOString().slice(0,10));await page.getByRole("button",{name:"Save payment terms",exact:true}).click();await termsReceived;assert(await page.getByRole("button",{name:"Cancel",exact:true}).isDisabled(),"Pending terms cannot be dismissed and later refresh another report");assert(await page.getByLabel("Payment due date",{exact:true}).isDisabled());await page.keyboard.press("Escape");assert(await page.getByRole("dialog",{name:"Payment terms",exact:true}).isVisible());await releaseTerms.finish();await page.getByRole("heading",{name:"Set payment terms",exact:true}).waitFor({state:"hidden"});diagnostic.mark("terms-modal-closed");writeFileSync(path.join(artifactDir,"after-terms-client-state.json"),JSON.stringify(await page.evaluate(reportClientState),null,2));await page.getByRole("table",{name:"Customer outstanding and ageing",exact:true}).waitFor();assert(await page.getByText("1 days overdue",{exact:true}).count()>=1);
 await page.getByRole("button",{name:"Sales & margin",exact:true}).click();
 await page.getByRole("combobox",{name:"Staff / owner",exact:true}).selectOption({label:"Asha Verma"});
 await page.getByRole("combobox",{name:"Current status / stage",exact:true}).selectOption("CONFIRMED");
 await page.getByRole("button",{name:"Generate report",exact:true}).click();
 await page.getByRole("table",{name:"Sales and cost coverage",exact:true}).waitFor();
 const workLink=page.getByRole("link",{name:"ON-2026-0001",exact:true});assert(await workLink.count()===1,"Filtered work has a source drill-down");
 assert((await workLink.getAttribute("href")).startsWith("/ticketing/"));
 const filteredExport=await page.getByRole("link",{name:"Download CSV",exact:true}).getAttribute("href");
 assert(filteredExport.includes("status=CONFIRMED")&&filteredExport.includes("ownerId="),"Export uses applied staff/status filters");
 const appliedSummary=page.getByRole("region",{name:"Applied report filters",exact:true});
 assert.match(await appliedSummary.innerText(),/Asha Verma/);assert.match(await appliedSummary.innerText(),/CONFIRMED/);
 const selectedOwner=await page.getByRole("combobox",{name:"Staff / owner",exact:true}).inputValue();assert(!(await appliedSummary.innerText()).includes(selectedOwner),"Staff summary uses the human name, not the internal identifier");
 assert.equal(await page.getByRole("table",{name:"Sales and cost coverage",exact:true}).getByRole("cell",{name:"Hotel",exact:true}).count(),1,"Online hotel is not mislabeled Ticketing");
 const exported=await context.request.get(base+filteredExport);assert(exported.ok());const exportedCsv=await exported.text();
 assert(exportedCsv.includes('"Account","Meera Sharma · '));assert(exportedCsv.includes('"Current status / stage","CONFIRMED"'));assert(exportedCsv.includes('"Date basis","Booking date / visa creation date · current prices and status"'));
 assert(exportedCsv.includes(selectedOwner),"Technical export metadata retains the exact applied owner identifier");
 writeFileSync(path.join(artifactDir,"filtered-sales.csv"),exportedCsv);
 // Real text geometry, not only CSS declarations: adjacent cells must not visually touch.
 const tableGeometry=await page.getByRole("table",{name:"Sales and cost coverage",exact:true}).evaluate(table=>{
  const rows=[table.tHead.rows[0],table.tBodies[0].rows[0]];
  const measurements=rows.map(row=>{const cells=[...row.cells];return{padding:cells.map(cell=>{const css=getComputedStyle(cell);return{left:parseFloat(css.paddingLeft),right:parseFloat(css.paddingRight)};}),gaps:cells.slice(0,-1).map((cell,index)=>{const left=document.createRange(),right=document.createRange();left.selectNodeContents(cell);right.selectNodeContents(cells[index+1]);return right.getBoundingClientRect().left-left.getBoundingClientRect().right;})};});
  const region=table.closest(".report-table-scroll");return{measurements,overflow:region.scrollWidth>region.clientWidth,focusable:region.tabIndex===0};
 });
 assert(tableGeometry.measurements.every(row=>row.padding.every(p=>p.left>=12&&p.right>=12)),"Every report header/data cell needs horizontal breathing room");
 assert(tableGeometry.measurements.every(row=>row.gaps.every(gap=>gap>=20)),"Adjacent rendered report values and headers must stay at least 20px apart");
 assert(tableGeometry.overflow&&tableGeometry.focusable,"Wide register keeps a focusable horizontal scrolling region");
 writeFileSync(path.join(artifactDir,"table-geometry.json"),JSON.stringify(tableGeometry,null,2));
 await capture(page,"filtered-sales-1440");
 const reportScroller=page.getByRole("region",{name:"Sales and cost coverage details",exact:true});
 const rightmost=await reportScroller.evaluate(region=>{region.scrollLeft=region.scrollWidth;return region.scrollLeft;});assert(rightmost>0,"Rightmost report columns remain reachable");
 await capture(page,"filtered-sales-right-columns-1440");await reportScroller.evaluate(region=>{region.scrollLeft=0;});

 // Editing draft controls must not silently change the export of the displayed report.
 await page.getByRole("combobox",{name:"Current status / stage",exact:true}).selectOption("");
 assert.equal(await page.getByRole("link",{name:"Download CSV",exact:true}).getAttribute("href"),filteredExport);
 await page.getByText("Filter changes not applied.",{exact:false}).waitFor();
 assert.match(await appliedSummary.innerText(),/CONFIRMED/);
 await capture(page,"dirty-filters-1440");
 for(const width of [390,320]){
  await viewport(page,width,844);
  await page.getByRole("list",{name:"Report record cards",exact:true}).waitFor();
  assert(await page.getByRole("heading",{name:"Costed confirmed booking margin",exact:true}).isVisible());
  await page.getByRole("list",{name:"Report record cards",exact:true}).getByText("All record details",{exact:true}).click();
  assert(await page.getByRole("list",{name:"Report record cards",exact:true}).getByText("Supplier cost",{exact:true}).isVisible());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`${width}px: generated report must not overflow`);
  await capture(page,`filtered-dirty-sales-${width}`);
  await page.getByRole("list",{name:"Report record cards",exact:true}).getByText("All record details",{exact:true}).click();
 }
 await viewport(page,1440,1000);
 await page.getByRole("button",{name:"Restore applied filters",exact:true}).click();
 assert.equal(await page.getByRole("combobox",{name:"Current status / stage",exact:true}).inputValue(),"CONFIRMED");
 assert.equal(await page.getByText("Filter changes not applied.",{exact:false}).count(),0);
 // A preset edits controls, never silently regenerates or relabels current results.
 let presetRequests=0;const observePreset=req=>{if(req.url().includes("/api/reports/accounts?")&&!req.url().includes("options=1"))presetRequests++;};page.on("request",observePreset);
 await page.getByRole("button",{name:"Today",exact:true}).click();
 assert.equal(await page.getByRole("link",{name:"Download CSV",exact:true}).getAttribute("href"),filteredExport);
 assert.equal(presetRequests,0);page.off("request",observePreset);
 await page.getByRole("combobox",{name:"Current status / stage",exact:true}).selectOption("");

 await page.getByRole("button",{name:"Work & travel",exact:true}).click();
 await page.getByRole("button",{name:"Generate report",exact:true}).click();
 await page.getByRole("table",{name:"Work and travel register",exact:true}).waitFor();
 assert(await page.locator('table a[href^="/visa/"]').count()>0,"Work report links directly to visa workspace");
 const workCsv=await context.request.get(base+await page.getByRole("link",{name:"Download CSV",exact:true}).getAttribute("href"));assert(workCsv.ok());assert((await workCsv.text()).includes('"Currency","All currencies · no monetary totals"'));
 await page.getByRole("button",{name:"Receipts & refunds",exact:true}).click();
 assert.equal(await page.getByRole("combobox",{name:"Staff / owner",exact:true}).count(),0,"Work-only filters are not applied to receipt accounts");
 await page.getByRole("button",{name:"Generate report",exact:true}).click();
 await page.getByRole("table",{name:"Receipt and refund register",exact:true}).waitFor();
 assert(await page.locator('table a[href*="tab=payments"]').count()>0,"Receipt links open customer payments");
 await page.getByRole("button",{name:"Cancellations",exact:true}).click();
 await page.getByRole("button",{name:"Generate report",exact:true}).click();
 await page.getByRole("table",{name:"Cancellation register",exact:true}).waitFor();
 assert(await page.getByText(/Filtered by cancellation date, not booking date/).count()>0);
 await page.getByRole("button",{name:"Supplier statement",exact:true}).click();await page.getByRole("combobox",{name:/Supplier/}).selectOption({label:"Aero consolidator"});
 await page.getByRole("button",{name:"Generate report",exact:true}).click();await page.getByRole("table",{name:"Supplier statement",exact:true}).waitFor();
 await page.getByRole("button",{name:"Customer statement",exact:true}).click();await page.getByRole("button",{name:"Generate report",exact:true}).click();await page.getByRole("table",{name:"Customer statement",exact:true}).waitFor();
 await viewport(page,390,844);await page.locator("aside.app-sidebar[data-drawer='closed']").waitFor({state:"hidden"});await capture(page,"statement-phone");
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),"No phone page overflow outside report table");
 // Delayed JSON from an aborted report must never replace the report chosen later.
 await viewport(page,1440,1000);
 await page.addInitScript(()=>{const original=window.fetch.bind(window);window.fetch=async(input,init)=>{const url=String(input);if(window.__holdNextReport&&url.startsWith("/api/reports/accounts?")&&!url.includes("options=1")){window.__holdNextReport=false;const response=await original(input,{...init,signal:undefined}),body=await response.json();return{ok:response.ok,status:response.status,json:()=>new Promise(resolve=>{window.__releaseReport=()=>resolve(body);})};}return original(input,init);};});
 await page.goto(base+`/reports?report=sales&customerId=${fixture.customerId}`);
 await page.waitForFunction(()=>{const button=Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Generate report");return button&&!button.disabled;});
 await page.evaluate(()=>{window.__holdNextReport=true;});await page.getByRole("button",{name:"Generate report",exact:true}).click();
 await page.waitForFunction(()=>typeof window.__releaseReport==="function");
 await page.getByRole("button",{name:"Work & travel",exact:true}).click();await page.getByRole("button",{name:"Generate report",exact:true}).click();
 await page.getByRole("table",{name:"Work and travel register",exact:true}).waitFor();
 const currentExport=await page.getByRole("link",{name:"Download CSV",exact:true}).getAttribute("href");
 await page.evaluate(async()=>{window.__releaseReport();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
 assert.equal(await page.getByRole("table",{name:"Sales and cost coverage",exact:true}).count(),0);
 assert.equal(await page.getByRole("link",{name:"Download CSV",exact:true}).getAttribute("href"),currentExport);
 // Overview locks dates while applying to avoid silently discarding newer edits.
 let finishOverview;const overviewStarted=new Promise(resolve=>{finishOverview={ready:resolve,finish:null};});
 await page.route("**/api/reports",async route=>{const response=await route.fetch();finishOverview.finish=()=>route.fulfill({response});finishOverview.ready();},{times:1});
 await page.getByRole("button",{name:"Business overview",exact:true}).click();await overviewStarted;
 assert(await page.getByLabel("From",{exact:true}).isDisabled());assert(await page.getByLabel("To",{exact:true}).isDisabled());
 await finishOverview.finish();await page.getByRole("region",{name:"Overview coverage",exact:true}).waitFor();
 assert(!(await page.getByLabel("From",{exact:true}).isDisabled()));
 const overviewExport=await page.getByRole("link",{name:"Export CSV",exact:true}).getAttribute("href");
 const monthStart=new Date(Date.now()+330*60000).toISOString().slice(0,7)+"-01";
 await page.getByLabel("From",{exact:true}).fill(monthStart.slice(0,7)+"-02");
 await page.getByText("Date changes not applied.",{exact:false}).waitFor();
 assert.equal(await page.getByRole("link",{name:"Export CSV",exact:true}).getAttribute("href"),overviewExport);
 // Options errors are recoverable; no report generation occurs until retry succeeds.
 await page.route("**/api/reports/accounts?options=1",route=>route.fulfill({status:503,json:{error:"Synthetic report options temporarily unavailable"}}),{times:1});
 await page.goto(base+`/reports?report=ageing&customerId=${fixture.customerId}`);
 await page.getByRole("button",{name:"Retry loading report accounts",exact:true}).waitFor();
 assert(await page.getByRole("button",{name:"Generate report",exact:true}).isDisabled());
 await capture(page,"options-error-1440");
 await page.getByRole("button",{name:"Retry loading report accounts",exact:true}).click();
 await page.waitForFunction(()=>{const button=Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Generate report");return button&&!button.disabled;});
 let historicalRequests=0;
 const historyFailure=async route=>{const p=new URL(route.request().url()).searchParams;if(p.get("report")==="ageing"){historicalRequests++;return route.fulfill({status:409,json:{error:"Historical ageing is unavailable: receipt allocation history cannot be verified. Use today's ageing or a customer statement."}});}return route.continue();};
 await page.route("**/api/reports/accounts?*",historyFailure);
 await page.getByRole("button",{name:"Generate report",exact:true}).click();await page.getByRole("button",{name:"Use today's balance",exact:true}).waitFor();
 assert.equal(historicalRequests,1,"Historical error never silently retries a different date");
 assert.equal(await page.getByRole("link",{name:"Download CSV",exact:true}).count(),0,"No stale download after a failed run");
 assert.equal(await page.getByRole("combobox",{name:"Customer",exact:true}).inputValue(),fixture.customerId);
 assert(await page.getByRole("button",{name:"Open customer statement",exact:true}).isVisible());
 for(const width of [1440,390,320]){await viewport(page,width,844);await capture(page,`history-error-${width}`);}
 await page.unroute("**/api/reports/accounts?*",historyFailure);await page.getByRole("button",{name:"Use today's balance",exact:true}).click();
 await page.getByRole("list",{name:"Report record cards",exact:true}).waitFor();
 assert.match(await page.getByRole("region",{name:"Applied report filters",exact:true}).innerText(),new RegExp(`As of ${new Date(Date.now()+330*60000).toISOString().slice(0,10)}`));
 // Real limited-role session proves export controls AND direct export endpoint enforcement.
 const readerContext=await browser.newContext({viewport:{width:1440,height:1000}});
 const readerLogin=await readerContext.request.post(base+"/api/auth/login",{data:{email:"report-reader@visual.test",password:"Review-Visual-2026!"}});assert(readerLogin.ok());
 const denied=await readerContext.request.get(base+`/api/reports/accounts?report=statement&customerId=${fixture.customerId}&format=csv`);assert.equal(denied.status(),403);
 const readerPage=await readerContext.newPage();activePage=readerPage;readerPage.on("pageerror",e=>errors.push(e.message));
 await readerPage.goto(base+`/reports?report=statement&customerId=${fixture.customerId}`);
 await readerPage.waitForFunction(()=>{const button=Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Generate report");return button&&!button.disabled;});
 await readerPage.getByRole("button",{name:"Generate report",exact:true}).click();await readerPage.getByRole("table",{name:"Customer statement",exact:true}).waitFor();
 assert.equal(await readerPage.getByRole("link",{name:/Download (CSV|XLSX|PDF)/}).count(),0);
 for(const width of [1440,390]){await viewport(readerPage,width,844);await capture(readerPage,`read-only-${width}`);}
 await readerContext.close();activePage=page;
 // A separate controlled page proves recovery from an actually stalled read, not a longer ordinary wait.
 const timeoutPage=await context.newPage();activePage=timeoutPage;timeoutPage.on("pageerror",e=>errors.push(e.message));timeoutPage.setDefaultTimeout(15000);await timeoutPage.clock.install();
 observeReports(timeoutPage);
 await timeoutPage.addInitScript(()=>{const original=window.fetch.bind(window);window.fetch=async(input,init)=>{if(window.__holdReportBody&&String(input).startsWith("/api/reports/accounts?")&&!String(input).includes("options=1")){window.__holdReportBody=false;const response=await original(input,{...init,signal:undefined});return{ok:response.ok,status:response.status,json:()=>new Promise(resolve=>{window.__releaseReportBody=async()=>{const body=await response.json();body.title="Stale delayed report";resolve(body);};})};}return original(input,init);};});
 await timeoutPage.goto(base+`/reports?report=ageing&customerId=${fixture.customerId}`);
 await timeoutPage.waitForFunction(()=>{const button=[...document.querySelectorAll("button")].find(b=>b.textContent==="Generate report");return button&&!button.disabled;});
 await timeoutPage.evaluate(()=>{window.__holdReportBody=true;});await timeoutPage.getByRole("button",{name:"Generate report",exact:true}).click();await timeoutPage.waitForFunction(()=>typeof window.__releaseReportBody==="function");
 await timeoutPage.clock.fastForward(35001);await timeoutPage.getByRole("alert").filter({hasText:"The report took too long to respond."}).waitFor();await capture(timeoutPage,"bounded-read-error");
 assert.equal(await timeoutPage.getByRole("table").count(),0);assert.equal(await timeoutPage.getByRole("link",{name:"Download CSV",exact:true}).count(),0,"Timed-out reads never expose fabricated or stale totals/exports");
 await timeoutPage.getByRole("button",{name:"Retry same report",exact:true}).click();await timeoutPage.getByRole("table",{name:"Customer outstanding and ageing",exact:true}).waitFor();
 const retryExport=await timeoutPage.getByRole("link",{name:"Download CSV",exact:true}).getAttribute("href");
 await timeoutPage.evaluate(()=>window.__releaseReportBody());assert.equal(await timeoutPage.getByRole("link",{name:"Download CSV",exact:true}).getAttribute("href"),retryExport);assert.equal(await timeoutPage.getByRole("main").getByRole("alert").count(),0,"No report errors remain after retry; the framework route announcer is not a report error");assert.equal(await timeoutPage.getByRole("table",{name:"Stale delayed report",exact:true}).count(),0);await timeoutPage.getByRole("table",{name:"Customer outstanding and ageing",exact:true}).waitFor();await capture(timeoutPage,"bounded-read-retried");
 assert.deepEqual(errors,[]);await timeoutPage.close();activePage=page;
 assert.deepEqual(errors,[]);console.log("PASS reporting browser: customer statements, 81400 closing balance, Excel download, PDF API, due-date editing, scoped staff/status filters, applied export filters, work and cash drill-downs, supplier statement, catalogue search, truthful CSV metadata, dirty filters, responsive full-detail cards at 1440/390/320, delayed-response protection, recoverable errors, read-only export denial, phone layout, no runtime errors.");
 }catch(e){
 diagnostic.mark("assertion-failed",{name:e?.name||"Error"});
 if(activePage){try{writeFileSync(path.join(artifactDir,"browser-failure.html"),await activePage.content());writeFileSync(path.join(artifactDir,"failure-client-state.json"),JSON.stringify(await activePage.evaluate(reportClientState),null,2));await activePage.screenshot({path:path.join(artifactDir,"browser-failure.png"),fullPage:true});}catch(diagnosticError){console.error("Reporting failure capture could not complete:",diagnosticError?.name);}}
 // A second, bounded read only diagnoses server availability; it cannot rescue the failed assertion.
 if(activePage&&lastReportReads.has(activePage)){diagnostic.mark("failure-server-probe",await probeReportServer(activePage.context().request,lastReportReads.get(activePage)));}
 throw e;
 }finally{
 try{writeFileSync(path.join(artifactDir,"network-timing.json"),JSON.stringify(diagnostic.snapshot(),null,2));}catch(diagnosticError){console.error("Reporting network diagnostics could not be saved:",diagnosticError?.name);}
 if(fixture?.runtime?.startsWith(path.resolve("tests/.runtime")+path.sep)){try{writeFileSync(path.join(artifactDir,"application-server.log"),readFileSync(path.join(fixture.runtime,"server.log")));}catch{}}
 await db?.$disconnect();await browser?.close();if(fixture?.serverPid)try{process.kill(fixture.serverPid);}catch{}server.kill();log.end();
 }
