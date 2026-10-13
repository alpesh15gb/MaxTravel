// Isolated browser/API verification. No live database or external messaging provider.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdirSync,readFileSync,createWriteStream,writeFileSync} from "node:fs";
import path from "node:path";
import net from "node:net";
import {chromium} from "./browser.mjs";
const root=process.cwd();mkdirSync("test-artifacts/reporting",{recursive:true});
const port=await new Promise(resolve=>{const s=net.createServer().listen(0,"127.0.0.1",()=>{const port=s.address().port;s.close(()=>resolve(port));});});
const base=`http://127.0.0.1:${port}`,log=createWriteStream("test-artifacts/reporting/browser-server.log");
const server=spawn(process.execPath,["tests/visual-review-server.mjs"],{cwd:root,env:{...process.env,REVIEW_PORT:String(port)},stdio:["ignore","pipe","pipe"]});server.stdout.pipe(log);server.stderr.pipe(log);
let output="",browser,fixture,page;server.stdout.on("data",c=>output+=c.toString());
try{
 for(let i=0;i<180;i++){if(server.exitCode!==null)throw new Error("Review server failed; inspect browser-server.log");if(output.includes("VISUAL REVIEW READY"))break;await new Promise(r=>setTimeout(r,500));}
 assert(output.includes("VISUAL REVIEW READY"),"Review server timeout");fixture=JSON.parse(readFileSync("tests/.runtime/visual-review-current.json","utf8"));assert.equal(fixture.base,base);
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const login=await context.request.post(base+"/api/auth/login",{data:{email:"review@visual.test",password:"Review-Visual-2026!"}});assert(login.ok());
 const supplierResponse=await context.request.post(base+"/api/suppliers",{data:{name:"Aero consolidator",type:"CONSOLIDATOR"}});assert(supplierResponse.ok());const supplier=(await supplierResponse.json()).supplier;
 const dueResponse=await context.request.post(base+"/api/suppliers/dues",{data:{supplierId:supplier.id,description:"Review airline settlement",amount:18000,dueDate:new Date(Date.now()+330*60000).toISOString().slice(0,10)}});assert(dueResponse.ok());
 page=await context.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(base+`/reports?report=statement&customerId=${fixture.customerId}`);
 await page.getByRole("button",{name:"Generate report",exact:true}).waitFor({state:"visible"});await page.waitForFunction(()=>!Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Generate report")?.disabled);
 await page.getByRole("button",{name:"Generate report",exact:true}).click();
 await page.getByRole("table",{name:"Customer statement",exact:true}).waitFor();
 assert(await page.getByText("₹32,500",{exact:true}).count()>=1,"Customer closing balance should be 32500");
 await page.screenshot({path:"test-artifacts/reporting/statement-desktop.png",fullPage:true});
 const pdfResponse=await context.request.get(base+`/api/reports/accounts?report=statement&customerId=${fixture.customerId}&format=pdf`);assert.equal(pdfResponse.status(),200);writeFileSync("test-artifacts/reporting/customer-statement.pdf",await pdfResponse.body());
 const downloadPromise=page.waitForEvent("download");await page.getByRole("link",{name:"Download XLSX",exact:true}).click();const download=await downloadPromise;await download.saveAs(path.join(root,"test-artifacts/reporting/customer-statement.xlsx"));
 await page.getByRole("button",{name:"Outstanding & ageing",exact:true}).click();await page.getByRole("button",{name:"Generate report",exact:true}).click();await page.getByRole("table",{name:"Customer outstanding and ageing",exact:true}).waitFor();
 await page.getByRole("button",{name:"Set payment terms",exact:true}).click();await page.getByRole("heading",{name:"Set payment terms",exact:true}).waitFor();
 await page.getByLabel("Payment due date",{exact:true}).fill(new Date(Date.now()+330*60000-86400000).toISOString().slice(0,10));await page.getByRole("button",{name:"Save payment terms",exact:true}).click();await page.getByRole("heading",{name:"Set payment terms",exact:true}).waitFor({state:"hidden"});await page.getByRole("table",{name:"Customer outstanding and ageing",exact:true}).waitFor();assert(await page.getByText("1 days overdue",{exact:true}).count()>=1);
 await page.getByRole("button",{name:"Supplier statement",exact:true}).click();await page.getByRole("combobox",{name:/Supplier/}).selectOption({label:"Aero consolidator"});
 await page.getByRole("button",{name:"Generate report",exact:true}).click();await page.getByRole("table",{name:"Supplier statement",exact:true}).waitFor();
 await page.getByRole("button",{name:"Customer statement",exact:true}).click();await page.getByRole("button",{name:"Generate report",exact:true}).click();await page.getByRole("table",{name:"Customer statement",exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});await page.locator("aside.app-sidebar[data-drawer='closed']").waitFor({state:"hidden"});await page.screenshot({path:"test-artifacts/reporting/statement-phone.png",fullPage:true});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),"No phone page overflow outside report table");
 assert.deepEqual(errors,[]);console.log("PASS reporting browser: customer statements, 32500 closing balance, Excel download, PDF API, due-date editing, supplier statement, phone layout, no runtime errors.");
}catch(e){if(page){writeFileSync("test-artifacts/reporting/browser-failure.html",await page.content());await page.screenshot({path:"test-artifacts/reporting/browser-failure.png",fullPage:true});}throw e;}finally{await browser?.close();if(fixture?.serverPid)try{process.kill(fixture.serverPid);}catch{}server.kill();log.end();}
