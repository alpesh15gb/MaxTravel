import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdirSync,copyFileSync,cpSync,writeFileSync} from "node:fs";
import path from "node:path";
import type {SessionUser} from "../src/lib/session";

async function run(){
 const root=process.cwd(),runtime=path.join(root,"tests/.runtime",`reporting-${Date.now()}`);
 mkdirSync(path.join(runtime,"legacy/migrations"),{recursive:true});
 const database=`file:${path.join(runtime,"test.db").replaceAll("\\","/")}`;process.env.DATABASE_URL=database;
 writeFileSync(path.join(runtime,"test.db"),Buffer.alloc(0));
 process.env.JWT_SECRET="reporting-test-only-secret-at-least-32-characters";
 const cli=path.join(root,"node_modules/prisma/build/index.js");
 copyFileSync("prisma/schema.prisma",path.join(runtime,"legacy/schema.prisma"));
 for(const m of ["0_init","20261012010000_evolution_whatsapp"])cpSync(path.join(root,"prisma/migrations",m),path.join(runtime,"legacy/migrations",m),{recursive:true});
 copyFileSync("prisma/migrations/migration_lock.toml",path.join(runtime,"legacy/migrations/migration_lock.toml"));
 execFileSync(process.execPath,[cli,"migrate","deploy","--schema",path.join(runtime,"legacy/schema.prisma")],{env:process.env,stdio:"pipe"});
 const {prisma}=await import("../src/lib/db");
 const branch=await prisma.branch.create({data:{name:"Reporting office",code:"RP",city:"Pune"}});
 const role=await prisma.role.create({data:{key:"OWNER",name:"Owner",desc:"Reporting fixture"}});
 const owner=await prisma.user.create({data:{name:"Finance owner",email:"reports@example.test",phone:"9000000000",passwordHash:"unused-test-hash",employeeCode:"EMP-RP",roleId:role.id,branchId:branch.id}});
 const user={...owner,role:"OWNER",roleName:"Owner",branchName:branch.name,accessMode:"ALL",permissions:["payment:view","supplier:view","refund:view","export:data"]} as unknown as SessionUser;
 // Seed the legacy schema using only legacy columns. The current generated client
 // includes new booking-platform columns that intentionally do not exist until migration.
 const customer={id:"reporting-legacy-customer"},booking={id:"reporting-legacy-booking"};
 await prisma.$executeRaw`INSERT INTO "Customer" ("id","name","code","phone","city","branchId","assignedToId") VALUES (${customer.id},'Statement Customer','C-RP','9000000001','Pune',${branch.id},${owner.id})`;
 await prisma.$executeRaw`INSERT INTO "Booking" ("id","bookingNo","customerId","branchId","ownerId","sellingPrice","supplierCost","status","pnr","updatedAt") VALUES (${booking.id},'BK-RP',${customer.id},${branch.id},${owner.id},120,80,'PNR_CREATED','RP1234',${new Date()})`;
 await prisma.payment.create({data:{receiptNo:"RCP-OLD",customerId:customer.id,bookingId:booking.id,amount:30}});
 const supplier=await prisma.supplier.create({data:{name:"Reporting Supplier"}});
 const due=await prisma.supplierDue.create({data:{supplierId:supplier.id,description:"Ticket bill",amount:100,paidAmount:20,dueDate:new Date("2026-01-01")}});
 execFileSync(process.execPath,[cli,"migrate","deploy"],{env:process.env,stdio:"pipe"});
 const {journalEntity}=await import("../src/lib/financial-journal");const {buildAccountReport}=await import("../src/lib/account-reports");
 const {accountCsv,accountWorkbook,accountPdf}=await import("../src/lib/report-export");
 let passed=0;function check(name:string,fn:()=>void){fn();passed++;console.log(`✓ ${name}`);}
 const today=new Date(Date.now()+330*60000).toISOString().slice(0,10);
 const yesterday=new Date(Date.now()+330*60000-86400000).toISOString().slice(0,10);
 await prisma.settings.update({where:{key:"financialJournal.cutover"},data:{value:`${yesterday}T00:00:00+05:30`}});
 await prisma.financialEntry.updateMany({where:{opening:true},data:{effectiveAt:new Date(`${yesterday}T00:00:00+05:30`)}});
 const report=(key:string,extra:Record<string,string>={},exporting=false)=>buildAccountReport(user,new URLSearchParams({report:key,from:today,to:today,...extra}),exporting);
 const statement=()=>report("statement",{customerId:customer.id});
 const value=(r:Awaited<ReturnType<typeof report>>,name:string)=>r.summary.find(s=>s.label===name)!.value;
 let s=await statement();check("Migration preserves customer opening without invented historical rows",()=>{assert.equal(value(s,"Opening balance"),90);assert.equal(s.totalRows,0);});
 let sp=await report("supplier-statement",{supplierId:supplier.id});check("Migration preserves partial supplier settlement",()=>assert.equal(value(sp,"Opening balance"),80));
 const before=await prisma.financialEntry.count();await prisma.$transaction(tx=>journalEntity(tx,"Booking",booking.id,owner.id));const after=await prisma.financialEntry.count();check("Repeated journal sync is idempotent",()=>assert.equal(before,after));
 async function modify(){await prisma.$transaction(async tx=>{await tx.booking.update({where:{id:booking.id},data:{sellingPrice:150}});await journalEntity(tx,"Booking",booking.id,owner.id);});}
 // Use explicit assertions for async checks so failures cannot be skipped by a callback.
 await modify();s=await statement();check("Price edit posts only a delta",()=>{assert.equal(value(s,"Opening balance"),90);assert.equal(value(s,"Closing balance"),120);assert.equal(s.rows[0].debit,30);});
 const invoice=await prisma.$transaction(async tx=>{const i=await tx.invoice.create({data:{invoiceNo:"INV-LINK",customerId:customer.id,bookingId:booking.id,amount:150,dueDate:new Date("2026-01-01")}});await journalEntity(tx,"Invoice",i.id,owner.id);return i;});
 await prisma.$transaction(async tx=>{const p=await tx.payment.create({data:{receiptNo:"RCP-LINK",customerId:customer.id,bookingId:booking.id,invoiceId:invoice.id,amount:20}});await journalEntity(tx,"Payment",p.id,owner.id);});
 s=await statement();check("Linked invoice and receipt are counted once",()=>assert.equal(value(s,"Closing balance"),100));
 const asOf=await report("ageing",{from:yesterday,to:yesterday});check("Historical ageing excludes later receipts and price edits",()=>assert.equal(value(asOf,"Total open obligations"),90));
 const ageing=await report("ageing");check("No guessed overdue dates for booking charges",()=>{assert.equal(value(ageing,"No due date"),100);assert.equal(value(ageing,"Overdue 90+"),0);});
 await prisma.$transaction(async tx=>{await tx.booking.update({where:{id:booking.id},data:{paymentDueDate:new Date(`${yesterday}T00:00:00+05:30`)}});await journalEntity(tx,"Booking",booking.id,owner.id);});
 const terms=await report("ageing");check("Explicit work terms populate ageing without changing balance",()=>{assert.equal(value(terms,"Overdue 1–30"),100);assert.equal(value(terms,"No due date"),0);});
 const pastTerms=await report("ageing",{from:yesterday,to:yesterday});check("Changing terms preserves historical due-date state",()=>assert.equal(value(pastTerms,"No due date"),90));
 await prisma.$transaction(async tx=>{await tx.supplierDue.update({where:{id:due.id},data:{paidAmount:50}});await journalEntity(tx,"SupplierDue",due.id,owner.id);});
 sp=await report("supplier-statement",{supplierId:supplier.id});check("Partial supplier settlement creates dated movement",()=>{assert.equal(value(sp,"Closing balance"),50);assert.equal(sp.rows[0].credit,30);});
 await prisma.$transaction(async tx=>{await tx.supplierDue.update({where:{id:due.id},data:{paidAmount:0}});await journalEntity(tx,"SupplierDue",due.id,owner.id);});
 sp=await report("supplier-statement",{supplierId:supplier.id});check("Reopening payable appends reversal and retains history",()=>{assert.equal(value(sp,"Closing balance"),100);assert.equal(sp.rows.length,2);});
 const refund=await prisma.refund.create({data:{refundNo:"RF-RP",customerId:customer.id,bookingId:booking.id,amount:10,status:"REQUESTED"}});
 await prisma.$transaction(tx=>journalEntity(tx,"Refund",refund.id,owner.id));s=await statement();check("Pending refund is not cash already returned",()=>{assert.equal(value(s,"Closing balance"),100);assert.equal(value(s,"Pending refunds now (separate)"),10);});
 await prisma.$transaction(async tx=>{await tx.refund.update({where:{id:refund.id},data:{status:"PAID",paidOn:new Date()}});await journalEntity(tx,"Refund",refund.id,owner.id);});
 s=await statement();check("Paid refund posts cash return under existing app policy",()=>assert.equal(value(s,"Closing balance"),110));
 await prisma.$transaction(async tx=>{await tx.booking.update({where:{id:booking.id},data:{status:"CANCELLED"}});await journalEntity(tx,"Booking",booking.id,owner.id);});
 s=await statement();check("Cancellation posts charge credit without erasing cash history",()=>assert.equal(value(s,"Closing balance"),-40));
 const count=await prisma.financialEntry.count();await statement();await report("ageing");const afterReads=await prisma.financialEntry.count();check("Report GETs do not mutate journal",()=>assert.equal(count,afterReads));
 const stranger={...user,id:"someone-else",accessMode:"ASSIGNED"} as SessionUser;
 await assert.rejects(()=>buildAccountReport(stranger,new URLSearchParams({report:"statement",customerId:customer.id})),/not available/);passed++;console.log("✓ Cross-scope statements rejected");
 await assert.rejects(()=>buildAccountReport(stranger,new URLSearchParams({report:"supplier-statement",supplierId:supplier.id})),/agency-wide/);passed++;console.log("✓ Scoped staff cannot export global supplier accounts");
 await assert.rejects(()=>report("statement",{customerId:customer.id,from:"2020-01-01",to:"2020-01-02"}),/Historical balances/);passed++;console.log("✓ Unsupported historical statements rejected");
 for(let n=0;n<60;n++)await prisma.$transaction(async tx=>{const p=await tx.payment.create({data:{receiptNo:`ADV-${n}`,customerId:customer.id,amount:1.01}});await journalEntity(tx,"Payment",p.id,owner.id);});
 const full=await report("statement",{customerId:customer.id},true);s=await statement();check("Pagination keeps full totals",()=>{assert.equal(s.rows.length,50);assert(full.rows.length>50);assert.equal(value(s,"Closing balance"),value(full,"Closing balance"));});
 const final=full.rows.at(-1)!;check("Exact paise balance and running totals",()=>{assert.equal(final.balance,-100.6);assert.equal(Math.round(value(full,"Opening balance")*100)+Math.round(value(full,"Period debits")*100)-Math.round(value(full,"Period credits")*100),Math.round(value(full,"Closing balance")*100));});
 const hostile={...full,party:{name:"=HYPERLINK(\"bad\")",code:"C-X",address:null},rows:[{...full.rows[0],description:"=HYPERLINK(\"bad\")"}]};
 check("CSV neutralizes formula-like text",()=>assert(accountCsv(hostile).includes("'=HYPERLINK")));
 const xlsx=await accountWorkbook(full);const {default:ExcelJS}=await import("exceljs");const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(xlsx as never);check("Excel contains all movements as numeric amounts",()=>{assert.equal(workbook.getWorksheet("Transactions")!.rowCount,full.rows.length+1);assert.equal(typeof workbook.getWorksheet("Transactions")!.getCell("D2").value,"number");});
 const pdf=await accountPdf(full);writeFileSync(path.join(runtime,"customer-statement.pdf"),pdf);writeFileSync(path.join(runtime,"customer-statement.xlsx"),xlsx);writeFileSync(path.join(runtime,"statement.json"),JSON.stringify(full,null,2));check("PDF export produces a real PDF",()=>assert.equal(pdf.subarray(0,4).toString(),"%PDF"));
 const sales=await report("sales");check("Withdrawn booking is excluded from current sales",()=>assert(!sales.rows.some(row=>row.reference==="BK-RP")));
 await prisma.$transaction(async tx=>{const i=await tx.invoice.create({data:{invoiceNo:"INV-LARGE",customerId:customer.id,amount:30000000}});await journalEntity(tx,"Invoice",i.id,owner.id);});
 const large=await statement();check("Journal supports more than 32-bit paise",()=>assert.equal(value(large,"Closing balance"),29999899.4));
 execFileSync(process.execPath,["scripts/reconcile-reporting.mjs"],{env:process.env,stdio:"pipe"});passed++;console.log("✓ All journal sources reconcile after mutations");
 console.log(`${passed} reporting checks passed. Artifacts: ${runtime}`);await prisma.$disconnect();
}
// Top-level await is avoided because this repository's tsx mode is CommonJS.
run().catch(e=>{console.error(e);process.exit(1);});
