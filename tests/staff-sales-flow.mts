import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import bcrypt from "bcryptjs";
import {prisma} from "../src/lib/db";
import {PrismaClient} from "@prisma/client";
import {totp,hashToken} from "../src/lib/staff-security";
if(process.env.DATABASE_URL!=="file:./security-verification.db")throw Error("Use only the isolated security-verification.db.");
process.env.CRM_DATA_ENCRYPTION_KEY=randomBytes(32).toString("hex");
const origin="http://127.0.0.1:3217",suffix=randomUUID(),password=`Fixture-${randomBytes(20).toString("hex")}`;
const role=await prisma.role.upsert({where:{key:"OWNER"},create:{key:"OWNER",name:"Owner",desc:"Fixture reference role"},update:{}});
const branch=await prisma.branch.create({data:{code:`SEC-${suffix}`,name:"Synthetic branch",city:"Test"}});
const user=await prisma.user.create({data:{employeeCode:`SEC-${suffix}`,email:`security-${suffix}@example.test`,name:"Synthetic owner",phone:"",passwordHash:await bcrypt.hash(password,12),roleId:role.id,branchId:branch.id}});
const customer=await prisma.customer.create({data:{code:`SEC-${suffix}`,name:"Synthetic customer",phone:"",city:"Test",branchId:branch.id,assignedToId:user.id}});
const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-p","3217","-H","127.0.0.1"],{env:{...process.env,APP_ORIGIN:origin,JWT_SECRET:randomBytes(48).toString("hex"),CRM_DATA_ENCRYPTION_KEY:process.env.CRM_DATA_ENCRYPTION_KEY,WA_PROVIDER:"manual"},stdio:["ignore","pipe","pipe"]});let logs="";server.stdout.on("data",v=>logs+=v);server.stderr.on("data",v=>logs+=v);
async function post(path:string,body:unknown,cookie=""){const response=await fetch(origin+path,{method:"POST",headers:{"Content-Type":"application/json",Origin:origin,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});const data=await response.json();return {response,data,cookie:response.headers.get("set-cookie")?.split(";")[0]??""};}
async function currentSales(leadId:string,cookie:string){const response=await fetch(origin+`/api/sales?leadId=${encodeURIComponent(leadId)}`,{headers:{Cookie:cookie},signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);assert.match(response.headers.get("cache-control")??"",/no-store/);return response.json();}
try{
 let ready=false;for(let attempt=0;attempt<80;attempt++){try{const r=await fetch(origin+"/api/health");if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert(ready,logs);
 const signed=await post("/api/auth/login",{email:user.email,password});assert.equal(signed.response.status,200);assert(signed.cookie);const cookie=signed.cookie;
 const second=await post("/api/auth/login",{email:user.email,password});assert(second.cookie);
 const sessionList=await fetch(origin+"/api/auth/security",{headers:{Cookie:cookie}}).then(r=>r.json());assert.equal(sessionList.sessions.length,2);
 const revoke=await post("/api/auth/security",{action:"revoke",password},cookie);assert.equal(revoke.response.status,200);assert.equal((await fetch(origin+"/api/auth/security",{headers:{Cookie:second.cookie}})).status,401);
 const enrol=await post("/api/auth/security",{action:"enrol",password},cookie);assert.equal(enrol.response.status,200);const code=totp(enrol.data.secret,Math.floor(Date.now()/30000));
 const confirm=await post("/api/auth/security",{action:"confirm",password,code},cookie);assert.equal(confirm.response.status,200);assert.equal(confirm.data.recovery.length,10);
 assert.equal((await post("/api/auth/login",{email:user.email,password})).response.status,401);
 assert.equal((await post("/api/auth/login",{email:user.email,password,code})).response.status,401,"Used TOTP must not be replayed");
 const recovered=await post("/api/auth/login",{email:user.email,password,code:confirm.data.recovery[0]});assert.equal(recovered.response.status,200);
 assert.equal((await post("/api/auth/login",{email:user.email,password,code:confirm.data.recovery[0]})).response.status,401,"Recovery code must be single-use");
 const lead=await post("/api/sales",{action:"create",data:{customerId:customer.id,title:"Test hotel stay",source:"Fixture",product:"HOTEL",budgetMinor:50000,destination:"Test city"}},cookie);assert.equal(lead.response.status,200,JSON.stringify(lead.data));
 const initialSales=await currentSales(lead.data.id,cookie);
 assert.match(initialSales.recoveryContext,/^[a-f0-9]{64}$/);assert.match(initialSales.lead.baseRevision,/^[a-f0-9]{64}$/);
 assert.notEqual(initialSales.recoveryContext,(await currentSales(lead.data.id,recovered.cookie)).recoveryContext,"A different login session must not recover another session's local draft");
 const quoteInput={action:"quote",leadId:lead.data.id,items:[{description:"Fixture revision test",quantity:1,priceMinor:10000,costMinor:7000}],terms:"No reservation made.",expiresAt:new Date(Date.now()+3600000).toISOString()};
 const missingBase=await post("/api/sales",quoteInput,cookie);assert.equal(missingBase.response.status,409);assert.equal(missingBase.data.code,"QUOTE_REVISION_CONFLICT");assert.equal(await prisma.salesQuote.count({where:{leadId:lead.data.id}}),0);
 const quote=await post("/api/sales",{action:"quote",leadId:lead.data.id,baseRevision:(await currentSales(lead.data.id,cookie)).lead.baseRevision,items:[{description:"Two nights with breakfast",quantity:2,priceMinor:10000,costMinor:7000}],terms:"Synthetic terms: no reservation or payment made.",expiresAt:new Date(Date.now()+3600000).toISOString()},cookie);assert.equal(quote.response.status,200,JSON.stringify(quote.data));
 const staleBase=await post("/api/sales",{...quoteInput,baseRevision:initialSales.lead.baseRevision},cookie);assert.equal(staleBase.response.status,409);assert.equal(staleBase.data.code,"QUOTE_REVISION_CONFLICT");assert.equal(await prisma.salesQuote.count({where:{leadId:lead.data.id}}),1,"Stale retry cannot create a duplicate quotation");
 const publish=await post("/api/sales",{action:"publish",leadId:lead.data.id,quoteId:quote.data.quoteId},cookie);assert.equal(publish.response.status,200);const token=publish.data.sharePath.split("#")[1];
 const view=await post("/api/proposals",{action:"view",token});assert.equal(view.response.status,200);assert.equal(view.data.totalMinor,20000);assert(!JSON.stringify(view.data).includes("costMinor"));
 assert.equal((await post("/api/proposals",{action:"accept",token,name:"Customer"})).response.status,400);
 const accept=await post("/api/proposals",{action:"accept",token,name:"Synthetic customer",consent:true});assert.equal(accept.response.status,200);assert.equal(accept.data.state,"ACCEPTED");
 const converted=await post("/api/sales",{action:"convert",leadId:lead.data.id,quoteId:quote.data.quoteId},cookie);assert.equal(converted.response.status,200,JSON.stringify(converted.data));assert(converted.data.bookingId);
 const duplicate=await post("/api/sales",{action:"convert",leadId:lead.data.id,quoteId:quote.data.quoteId},cookie);assert.equal(duplicate.data.bookingId,converted.data.bookingId);
 const booking=await prisma.booking.findUniqueOrThrow({where:{id:converted.data.bookingId}});assert.equal(booking.sellingPrice,200);assert.equal(booking.supplierCost,140);assert.equal(booking.status,"ENQUIRY");
 // Regression: a manual edit must not claim integration ownership and lock staff out.
 assert.equal((await post(`/api/bookings/${booking.id}`,{gdsSource:"TRIPJACK_API"},cookie)).response.status,400);
 assert.equal((await post("/api/bookings",{customerId:customer.id,gdsSource:"TRIPJACK_API"},cookie)).response.status,400);
 assert.notEqual((await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).gdsSource,"TRIPJACK_API");
 const task=await post("/api/tasks",{title:"Regression follow-up",customerId:customer.id},cookie);assert.equal(task.response.status,200,JSON.stringify(task.data));
 const completed=await post("/api/tasks/status",{taskId:task.data.task.id,status:"DONE"},cookie);assert.equal(completed.response.status,200);
 const repeated=await post("/api/tasks/status",{taskId:task.data.task.id,status:"DONE"},cookie);assert.equal(repeated.data.task.completedAt,completed.data.task.completedAt,"Repeated completion preserves original timestamp");
 assert.equal(await prisma.auditLog.count({where:{entity:"Task",entityId:task.data.task.id,action:"STATUS"}}),1,"Each actual task transition is audited exactly once");
 const reopened=await post("/api/tasks/status",{taskId:task.data.task.id,status:"OPEN"},cookie);assert.equal(reopened.data.task.completedAt,null);
 const lostLead=await post("/api/sales",{action:"create",data:{customerId:customer.id,title:"Closed enquiry regression",source:"Fixture",product:"HOTEL",budgetMinor:10000}},cookie);
 const lostQuote=await post("/api/sales",{action:"quote",leadId:lostLead.data.id,baseRevision:(await currentSales(lostLead.data.id,cookie)).lead.baseRevision,items:[{description:"Fixture stay",quantity:1,priceMinor:10000,costMinor:7000}],terms:"No real reservation.",expiresAt:new Date(Date.now()+3600000).toISOString()},cookie);
 assert.equal((await post("/api/sales",{action:"stage",leadId:lostLead.data.id,baseRevision:(await currentSales(lostLead.data.id,cookie)).lead.baseRevision,stage:"LOST",lostReason:"Customer cancelled"},cookie)).response.status,200);
 assert.equal((await post("/api/sales",{action:"publish",leadId:lostLead.data.id,quoteId:lostQuote.data.quoteId},cookie)).response.status,409,"Publishing must not silently reopen lost work");
 assert.equal((await post("/api/sales",{action:"stage",leadId:lostLead.data.id,baseRevision:(await currentSales(lostLead.data.id,cookie)).lead.baseRevision,stage:"QUALIFIED"},cookie)).response.status,200);
 const reopenedQuote=await post("/api/sales",{action:"publish",leadId:lostLead.data.id,quoteId:lostQuote.data.quoteId},cookie);assert.equal(reopenedQuote.response.status,200);
 assert.equal((await post("/api/proposals",{action:"accept",token:reopenedQuote.data.sharePath.split("#")[1],name:"Synthetic customer",consent:true})).response.status,200);
 assert.equal((await post("/api/sales",{action:"stage",leadId:lostLead.data.id,baseRevision:(await currentSales(lostLead.data.id,cookie)).lead.baseRevision,stage:"LOST",lostReason:"Customer withdrew accepted quote"},cookie)).response.status,200);
 assert.equal((await post("/api/sales",{action:"convert",leadId:lostLead.data.id,quoteId:lostQuote.data.quoteId},cookie)).response.status,409,"Lost accepted quotes need explicit reopening before creating a booking");
 const supplierResult=await post("/api/suppliers",{name:`Ledger supplier ${suffix}`,type:"HOTEL",paymentDueDays:10},cookie);assert.equal(supplierResult.response.status,200,JSON.stringify(supplierResult.data));const supplier=supplierResult.data.supplier;
 await prisma.booking.update({where:{id:booking.id},data:{supplierId:supplier.id}});
 const payableResult=await post("/api/suppliers/dues",{supplierId:supplier.id,bookingId:booking.id,supplierInvoiceNo:"HOT-778",description:"Two-night hotel supplier bill",amount:100,dueDate:"2026-11-01"},cookie);assert.equal(payableResult.response.status,200,JSON.stringify(payableResult.data));const payable=payableResult.data.due;assert.equal(payable.bookingId,booking.id);assert.equal(payable.supplierInvoiceNo,"HOT-778");
 const requestKey=randomUUID();const partPayment=await post("/api/suppliers/dues",{dueId:payable.id,amount:30,method:"UPI",reference:"UTR-123",settledOn:"2026-10-18",requestKey},cookie);assert.equal(partPayment.response.status,200,JSON.stringify(partPayment.data));assert.equal(partPayment.data.due.paidAmount,30);assert.equal(partPayment.data.settlement.reference,"UTR-123");
 assert.equal((await post("/api/suppliers/dues",{action:"edit",dueId:payable.id,amount:110},cookie)).response.status,409,"A payable with recorded settlement history is locked until the payment is reversed");
 const replayPayment=await post("/api/suppliers/dues",{dueId:payable.id,amount:30,method:"UPI",reference:"UTR-123",settledOn:"2026-10-18",requestKey},cookie);assert.equal(replayPayment.response.status,200);assert.equal(replayPayment.data.replayed,true);assert.equal(await prisma.supplierSettlement.count({where:{dueId:payable.id}}),1);
 assert.equal((await post("/api/suppliers/dues",{dueId:payable.id,amount:71,method:"NEFT",requestKey:randomUUID()},cookie)).response.status,400,"Supplier settlement cannot exceed the outstanding payable");
 const reversal=await post("/api/suppliers/dues",{action:"reverse",dueId:payable.id,settlementId:partPayment.data.settlement.id,reason:"Bank entry was duplicated"},cookie);assert.equal(reversal.response.status,200,JSON.stringify(reversal.data));assert.equal(reversal.data.paidAmount,0);assert((await prisma.supplierSettlement.findUniqueOrThrow({where:{id:partPayment.data.settlement.id}})).reversedOn);
 const finalPayment=await post("/api/suppliers/dues",{dueId:payable.id,amount:100,method:"BANK_TRANSFER",reference:"UTR-456",requestKey:randomUUID()},cookie);assert.equal(finalPayment.response.status,200,JSON.stringify(finalPayment.data));assert.equal(finalPayment.data.due.paid,true);assert.equal(finalPayment.data.due.paidAmount,100);
 const payableJournal=await prisma.financialEntry.findMany({where:{sourceType:"SupplierDue",sourceId:payable.id},orderBy:{revision:"asc"}});assert.deepEqual(payableJournal.map(row=>Number(row.amountMinor)),[10000]);const settlementJournal=await prisma.financialEntry.findMany({where:{sourceType:"SupplierSettlement",sourceId:payable.id},orderBy:{revision:"asc"}});assert.deepEqual(settlementJournal.map(row=>Number(row.amountMinor)),[0,-3000,3000,-10000]);
 const passport=`P${randomBytes(5).toString("hex").toUpperCase()}`;
 const traveller=await post("/api/travellers",{customerId:customer.id,fullName:"Synthetic adult",dateOfBirth:"1990-01-01",passportNumber:passport},cookie);assert.equal(traveller.response.status,200,JSON.stringify(traveller.data));
 const rawClient=new PrismaClient();try{const raw=await rawClient.traveller.findUniqueOrThrow({where:{id:traveller.data.travellerId}});assert(raw.passportNumber?.startsWith("enc:v1."));assert.notEqual(raw.passportNumber,passport);assert(raw.passportLookup);}finally{await rawClient.$disconnect();}
 const lookup=await fetch(origin+`/api/search?q=${passport}`,{headers:{Cookie:cookie}}).then(r=>r.json());assert(JSON.stringify(lookup).includes("Synthetic adult"),"Exact encrypted passport lookup must find the traveller");
 const receipt=await post("/api/payments",{customerId:customer.id,amount:50,mode:"UPI"},cookie);assert.equal(receipt.response.status,200,JSON.stringify(receipt.data));
 const allocation=await post("/api/payments/allocate",{paymentId:receipt.data.payment.id,bookingId:booking.id},cookie);assert.equal(allocation.response.status,200,JSON.stringify(allocation.data));assert.equal((await prisma.payment.findUniqueOrThrow({where:{id:receipt.data.payment.id}})).amount,50);assert.equal((await post("/api/payments/allocate",{paymentId:receipt.data.payment.id,bookingId:booking.id},cookie)).response.status,409);
 const child=await post("/api/travellers",{customerId:customer.id,fullName:"Synthetic child",dateOfBirth:"2016-01-01"},cookie);assert.equal(child.response.status,200);
 await prisma.visaStage.upsert({where:{key:"ENQUIRY"},create:{key:"ENQUIRY",name:"Enquiry",seq:0,system:true},update:{}});
 const adultChecklist=await prisma.checklist.create({data:{country:`Testland-${suffix}`,visaType:"Visitor",applicantType:"SALARIED",items:{create:{name:"Passport",required:true}}}});
 const minorChecklist=await prisma.checklist.create({data:{country:`Testland-${suffix}`,visaType:"Visitor",applicantType:"MINOR",items:{create:{name:"Birth certificate",required:true,travellerType:"MINOR"}}}});
 const visa=await post("/api/visa/cases",{customerId:customer.id,destination:`Testland-${suffix}`,visaType:"Visitor",travellerIds:[traveller.data.travellerId,child.data.travellerId],checklistId:adultChecklist.id},cookie);assert.equal(visa.response.status,200,JSON.stringify(visa.data));
 const requirements=await post("/api/visa/requirements",{caseId:visa.data.caseId,travellerId:child.data.travellerId,checklistId:minorChecklist.id},cookie);assert.equal(requirements.response.status,200,JSON.stringify(requirements.data));
 const applicantDocs=await prisma.document.findMany({where:{visaCaseId:visa.data.caseId,travellerId:child.data.travellerId}});assert.equal(applicantDocs.length,1);assert.equal(applicantDocs[0].docType,"Birth certificate");await prisma.document.update({where:{id:applicantDocs[0].id},data:{status:"RECEIVED"}});
 assert.equal((await post("/api/visa/requirements",{caseId:visa.data.caseId,travellerId:child.data.travellerId,checklistId:adultChecklist.id},cookie)).response.status,409,"Never replace received applicant requirements");
 const csv=`name,phone,email,city\nImported Customer,+9198${Date.now().toString().slice(-8)},import-${suffix}@example.test,Test`;
 const preview=await post("/api/customers/import",{action:"preview",csv,branchId:branch.id},cookie);assert.equal(preview.response.status,200,JSON.stringify(preview.data));assert.equal(preview.data.duplicates.length,0);
 const imported=await post("/api/customers/import",{action:"commit",csv,branchId:branch.id,requestId:preview.data.requestId},cookie);assert.equal(imported.response.status,200,JSON.stringify(imported.data));assert.equal(imported.data.created,1);
 const importedAgain=await post("/api/customers/import",{action:"commit",csv,branchId:branch.id,requestId:preview.data.requestId},cookie);assert.equal(importedAgain.data.replayed,true);
 const mergeSource=await prisma.customer.create({data:{code:`MERGE-${suffix}`,name:"Duplicate fixture",phone:"+919876500000",city:"Test",branchId:branch.id,assignedToId:user.id,travellers:{create:{fullName:"Duplicate traveller"}}}});
 const mergeTarget=await prisma.customer.create({data:{code:`KEEP-${suffix}`,name:"Retained fixture",phone:"+919876500000",city:"Test",branchId:branch.id,assignedToId:user.id}});
 const merged=await post("/api/customers/merge",{sourceId:mergeSource.id,targetId:mergeTarget.id,confirm:`${mergeSource.code} -> ${mergeTarget.code}`},cookie);assert.equal(merged.response.status,200,JSON.stringify(merged.data));assert.equal((await prisma.customer.findUniqueOrThrow({where:{id:mergeSource.id}})).mergedIntoId,mergeTarget.id);assert.equal(await prisma.traveller.count({where:{customerId:mergeTarget.id}}),1);
 const blockedMerge=await post("/api/customers/merge",{sourceId:customer.id,targetId:mergeTarget.id,confirm:`${customer.code} -> ${mergeTarget.code}`},cookie);assert.equal(blockedMerge.response.status,409,"Never merge a source with financial history");
 // The revision includes older proposals, not only the most recent draft.
 const historyLead=await post("/api/sales",{action:"create",data:{customerId:customer.id,title:"Historical proposal revision",source:"Fixture",product:"HOTEL",budgetMinor:10000}},cookie);
 const historyInput={...quoteInput,leadId:historyLead.data.id};
 const historyFirst=await post("/api/sales",{...historyInput,baseRevision:(await currentSales(historyLead.data.id,cookie)).lead.baseRevision},cookie);assert.equal(historyFirst.response.status,200);
 const historyPublished=await post("/api/sales",{action:"publish",leadId:historyLead.data.id,quoteId:historyFirst.data.quoteId},cookie);assert.equal(historyPublished.response.status,200);
 const historySecond=await post("/api/sales",{...historyInput,items:[{description:"Different newer draft",quantity:1,priceMinor:33300,costMinor:22200}],baseRevision:(await currentSales(historyLead.data.id,cookie)).lead.baseRevision},cookie);assert.equal(historySecond.response.status,200);
 const beforeOldAcceptance=await currentSales(historyLead.data.id,cookie);
 const olderAccepted=await post("/api/proposals",{action:"accept",token:historyPublished.data.sharePath.split("#")[1],name:"Synthetic customer",consent:true});assert.equal(olderAccepted.response.status,200);
 const afterOldAcceptance=await currentSales(historyLead.data.id,cookie);assert.notEqual(beforeOldAcceptance.lead.baseRevision,afterOldAcceptance.lead.baseRevision);
 const staleWithdrawal=await post("/api/sales",{action:"withdraw",leadId:historyLead.data.id,quoteId:historyFirst.data.quoteId,baseRevision:beforeOldAcceptance.lead.baseRevision},cookie);
 assert.equal(staleWithdrawal.response.status,409);assert.equal(staleWithdrawal.data.code,"WITHDRAWAL_REVISION_CONFLICT");
 assert.equal((await prisma.salesQuote.findUniqueOrThrow({where:{id:historyFirst.data.quoteId}})).state,"ACCEPTED","A stale withdrawal must not erase a newly recorded acceptance");
 const historicalConflict=await post("/api/sales",{...historyInput,baseRevision:beforeOldAcceptance.lead.baseRevision},cookie);assert.equal(historicalConflict.response.status,409);assert.equal(historicalConflict.data.code,"QUOTE_REVISION_CONFLICT");assert.equal(await prisma.salesQuote.count({where:{leadId:historyLead.data.id}}),2);
 const acceptedHistoryPublish=await post("/api/sales",{action:"publish",leadId:historyLead.data.id,quoteId:historySecond.data.quoteId},cookie);
 assert.equal(acceptedHistoryPublish.response.status,409,"An older accepted proposal must block publishing a newer draft");
 const acceptedHistoryDraft=await post("/api/sales",{...historyInput,baseRevision:afterOldAcceptance.lead.baseRevision},cookie);
 assert.equal(acceptedHistoryDraft.response.status,409,"An older accepted proposal must block creating another draft");
 const missingStageBase=await post("/api/sales",{action:"stage",leadId:historyLead.data.id,stage:"LOST",lostReason:"Must not apply"},cookie);
 assert.equal(missingStageBase.response.status,409);assert.equal(missingStageBase.data.code,"STAGE_REVISION_CONFLICT");
 const stageBefore=await prisma.salesLead.findUniqueOrThrow({where:{id:historyLead.data.id}});
 const auditBefore=await prisma.auditLog.count({where:{entity:"SalesLead",entityId:historyLead.data.id,action:"STAGE"}});
 const staleStage=await post("/api/sales",{action:"stage",leadId:historyLead.data.id,baseRevision:beforeOldAcceptance.lead.baseRevision,stage:"LOST",lostReason:"Must not apply",followUpAt:"2099-01-01T12:00:00.000Z"},cookie);
 assert.equal(staleStage.response.status,409);assert.equal(staleStage.data.code,"STAGE_REVISION_CONFLICT");
 assert.deepEqual(await prisma.salesLead.findUniqueOrThrow({where:{id:historyLead.data.id}}),stageBefore,"A stale stage request must not change the enquiry or follow-up");
 assert.equal(await prisma.auditLog.count({where:{entity:"SalesLead",entityId:historyLead.data.id,action:"STAGE"}}),auditBefore,"Rejected writes must not record successful stage audits");
 const beforeStage=afterOldAcceptance.lead.baseRevision;
 assert.equal((await post("/api/sales",{action:"stage",leadId:historyLead.data.id,baseRevision:(await currentSales(historyLead.data.id,cookie)).lead.baseRevision,stage:"QUALIFIED"},cookie)).response.status,200);
 assert.notEqual(beforeStage,(await currentSales(historyLead.data.id,cookie)).lead.baseRevision);
 assert.equal((await post("/api/sales",{...historyInput,baseRevision:beforeStage},cookie)).data.code,"QUOTE_REVISION_CONFLICT");
 // Historical acceptance remains immutable and converts the exact accepted values, not the newer draft.
 const acceptedEvidence=await prisma.salesQuote.findUniqueOrThrow({where:{id:historyFirst.data.quoteId}});
 await prisma.salesQuote.update({where:{id:acceptedEvidence.id},data:{expiresAt:new Date("2020-01-01")}});
 const acceptedReplay=await post("/api/proposals",{action:"accept",token:historyPublished.data.sharePath.split("#")[1],name:"Different replay name",consent:true});
 assert.equal(acceptedReplay.response.status,200);assert.equal(acceptedReplay.data.acceptedName,acceptedEvidence.acceptedName);assert.equal(acceptedReplay.data.acceptedAt,acceptedEvidence.acceptedAt!.toISOString());
 assert.equal(await prisma.auditLog.count({where:{entityId:acceptedEvidence.id,action:"CUSTOMER_ACCEPTED_QUOTE"}}),1);
 const historicalConversion=await post("/api/sales",{action:"convert",leadId:historyLead.data.id,quoteId:acceptedEvidence.id},cookie);
 assert.equal(historicalConversion.response.status,200,JSON.stringify(historicalConversion.data));
 const historicalBooking=await prisma.booking.findUniqueOrThrow({where:{id:historicalConversion.data.bookingId}});
 assert.equal(historicalBooking.sellingPrice,acceptedEvidence.totalMinor/100);assert.equal(historicalBooking.supplierCost,acceptedEvidence.costMinor/100);
 assert.equal(historicalBooking.status,"ENQUIRY");assert.equal((await prisma.salesQuote.findUniqueOrThrow({where:{id:historySecond.data.quoteId}})).bookingId,null);
 const repeatedConversion=await post("/api/sales",{action:"convert",leadId:historyLead.data.id,quoteId:acceptedEvidence.id},cookie);
 assert.equal(repeatedConversion.data.bookingId,historicalBooking.id);
 // Pre-existing inconsistent data must require staff review, not silently pick newest consent.
 const conflictLead=await prisma.salesLead.create({data:{title:"Conflicting historical fixture",source:"Fixture",customerId:customer.id,branchId:branch.id,ownerId:user.id,stage:"QUOTED"}});
 const conflictBase={leadId:conflictLead.id,items:JSON.stringify(quoteInput.items),terms:quoteInput.terms,totalMinor:10000,costMinor:7000,expiresAt:new Date("2099-01-01"),createdBy:user.id};
 const conflictFirst=await prisma.salesQuote.create({data:{...conflictBase,version:1,state:"ACCEPTED",acceptedName:"First evidence",acceptedAt:new Date()}});
 await prisma.salesQuote.create({data:{...conflictBase,version:2,state:"ACCEPTED",acceptedName:"Second evidence",acceptedAt:new Date()}});
 const conflictToken=randomBytes(32).toString("hex");
 const conflictPending=await prisma.salesQuote.create({data:{...conflictBase,version:3,state:"PUBLISHED",shareHash:hashToken(conflictToken)}});
 const conflictConversion=await post("/api/sales",{action:"convert",leadId:conflictLead.id,quoteId:conflictFirst.id},cookie);
 assert.equal(conflictConversion.response.status,409);assert.match(conflictConversion.data.error,/another accepted or linked/);
 assert.equal((await prisma.salesQuote.findUniqueOrThrow({where:{id:conflictFirst.id}})).bookingId,null);
 assert.equal((await post("/api/proposals",{action:"accept",token:conflictToken,name:"Must not add consent",consent:true})).response.status,409);
 assert.equal((await prisma.salesQuote.findUniqueOrThrow({where:{id:conflictPending.id}})).acceptedAt,null);
 // An unaccepted expired offer is still invalid, unlike previously recorded acceptance.
 await prisma.salesQuote.update({where:{id:conflictPending.id},data:{expiresAt:new Date("2020-01-01")}});
 assert.equal((await post("/api/proposals",{action:"accept",token:conflictToken,name:"Expired fixture",consent:true})).response.status,410);
 // Race acceptance against replacement. A transaction failure is not treated as success.
 const raceLead=await post("/api/sales",{action:"create",data:{customerId:customer.id,title:"Acceptance replacement race",source:"Fixture",product:"HOTEL",budgetMinor:10000}},cookie);
 const raceInput={...quoteInput,leadId:raceLead.data.id};
 const raceFirst=await post("/api/sales",{...raceInput,baseRevision:(await currentSales(raceLead.data.id,cookie)).lead.baseRevision},cookie);
 const racePublished=await post("/api/sales",{action:"publish",leadId:raceLead.data.id,quoteId:raceFirst.data.quoteId},cookie);
 const raceSecond=await post("/api/sales",{...raceInput,baseRevision:(await currentSales(raceLead.data.id,cookie)).lead.baseRevision},cookie);
 const raced=await Promise.all([
   post("/api/proposals",{action:"accept",token:racePublished.data.sharePath.split("#")[1],name:"Race customer",consent:true}),
   post("/api/sales",{action:"publish",leadId:raceLead.data.id,quoteId:raceSecond.data.quoteId},cookie),
 ]);
 assert(!(raced[0].response.ok&&raced[1].response.ok),"Acceptance and replacement cannot both succeed");
 const raceVersions=await prisma.salesQuote.findMany({where:{leadId:raceLead.data.id},orderBy:{version:"asc"}});
 assert(!(raceVersions[0].state==="ACCEPTED"&&raceVersions[1].state==="PUBLISHED"));
 if(raced[0].response.ok)assert.equal(raceVersions[0].state,"ACCEPTED");
 if(raced[1].response.ok)assert.equal(raceVersions[0].state,"SUPERSEDED");
 // Regression coverage: exact financial identity, acceptance/withdrawal race and conversion replay.
 for(let attempt=0;attempt<3;attempt++){
  const rlead=await prisma.salesLead.create({data:{title:`Synthetic race ${attempt}`,source:"Synthetic regression",customerId:customer.id,branchId:branch.id,ownerId:user.id,stage:"QUOTED"}});
  const rt=randomBytes(32).toString("hex");
  const rq=await prisma.salesQuote.create({data:{leadId:rlead.id,version:1,state:"PUBLISHED",shareHash:hashToken(rt),items:JSON.stringify([{description:"Unique regression amount",quantity:2,priceMinor:7654,costMinor:4321}]),terms:"Synthetic regression only",totalMinor:15308,costMinor:8642,expiresAt:new Date("2099-01-01"),createdBy:user.id}});
  const base=(await currentSales(rlead.id,cookie)).lead.baseRevision;
  const operations=[()=>post("/api/proposals",{action:"accept",token:rt,name:"Synthetic exact consent",consent:true}),()=>post("/api/sales",{action:"withdraw",leadId:rlead.id,quoteId:rq.id,baseRevision:base},cookie)];
  const results=await Promise.all((attempt%2?operations.slice().reverse():operations).map(fn=>fn()));
  const [accept,withdraw]=attempt%2?results.slice().reverse():results;
  assert(!(accept.response.ok&&withdraw.response.ok),"Old-base withdrawal and acceptance cannot both succeed");
  let persisted=await prisma.salesQuote.findUniqueOrThrow({where:{id:rq.id}});
  assert.equal(persisted.totalMinor,15308);assert.equal(persisted.costMinor,8642);assert.equal(persisted.items,rq.items);assert.equal(persisted.terms,rq.terms);
  if(accept.response.ok){assert.equal(persisted.state,"ACCEPTED");assert.equal(persisted.acceptedName,"Synthetic exact consent");assert(persisted.acceptedAt);}
  if(withdraw.response.ok){assert.equal(persisted.state,"WITHDRAWN");assert.equal(persisted.acceptedAt,null);assert.equal(persisted.shareHash,null);}
  console.log("Acceptance-withdraw race",attempt,accept.response.status,withdraw.response.status,persisted.state);
  // Arrange recorded consent independently when withdrawal won, then test intentional withdrawal evidence.
  if(persisted.state!=="ACCEPTED") persisted=await prisma.salesQuote.update({where:{id:rq.id},data:{state:"ACCEPTED",acceptedName:"Synthetic exact consent",acceptedAt:new Date()}});
  const evidence={acceptedAt:persisted.acceptedAt,acceptedName:persisted.acceptedName};
  if(attempt===0){
   const wr=await post("/api/sales",{action:"withdraw",leadId:rlead.id,quoteId:rq.id,baseRevision:(await currentSales(rlead.id,cookie)).lead.baseRevision},cookie);assert.equal(wr.response.status,200);
   const after=await prisma.salesQuote.findUniqueOrThrow({where:{id:rq.id}});assert.equal(after.state,"WITHDRAWN");assert.deepEqual({acceptedAt:after.acceptedAt,acceptedName:after.acceptedName},evidence);assert.equal(after.totalMinor,15308);assert.equal(after.items,rq.items);
  }else{
   const convert=()=>post("/api/sales",{action:"convert",leadId:rlead.id,quoteId:rq.id},cookie);
   const cc=await Promise.all([convert(),convert()]);
   const after=await prisma.salesQuote.findUniqueOrThrow({where:{id:rq.id}});assert(after.bookingId);
   for(const result of cc.filter(r=>r.response.ok))assert.equal(result.data.bookingId,after.bookingId);
   const bk=await prisma.booking.findUniqueOrThrow({where:{id:after.bookingId}});assert.equal(bk.sellingPrice,153.08);assert.equal(bk.supplierCost,86.42);assert.equal(bk.customerId,customer.id);assert.equal(bk.branchId,branch.id);assert.equal(bk.status,"ENQUIRY");
   const replay=await convert();assert.equal(replay.response.status,200);assert.equal(replay.data.bookingId,bk.id);
   assert.equal(await prisma.auditLog.count({where:{entity:"Booking",action:"CREATE",entityId:bk.id}}),1);
   assert.equal(await prisma.booking.count({where:{customerId:customer.id,sellingPrice:153.08}}),attempt);
   assert.deepEqual({acceptedAt:after.acceptedAt,acceptedName:after.acceptedName},evidence);
   console.log("Conversion race",attempt,cc.map(r=>r.response.status),bk.id);
  }
 }
 // Deterministic withdrawal-first ordering: the invalidated token cannot record later consent.
 const withdrawnFirstLead=await prisma.salesLead.create({data:{title:"Withdraw before acceptance",source:"Synthetic regression",customerId:customer.id,branchId:branch.id,ownerId:user.id,stage:"QUOTED"}});
 const withdrawnFirstToken=randomBytes(32).toString("hex");
 const withdrawnFirst=await prisma.salesQuote.create({data:{...conflictBase,leadId:withdrawnFirstLead.id,version:1,state:"PUBLISHED",shareHash:hashToken(withdrawnFirstToken)}});
 assert.equal((await post("/api/sales",{action:"withdraw",leadId:withdrawnFirstLead.id,quoteId:withdrawnFirst.id,baseRevision:(await currentSales(withdrawnFirstLead.id,cookie)).lead.baseRevision},cookie)).response.status,200);
 assert.equal((await post("/api/proposals",{action:"accept",token:withdrawnFirstToken,name:"Too late",consent:true})).response.status,404);
 assert.equal((await prisma.salesQuote.findUniqueOrThrow({where:{id:withdrawnFirst.id}})).acceptedAt,null);
 assert.equal(await prisma.auditLog.count({where:{entityId:withdrawnFirst.id,action:"CUSTOMER_ACCEPTED_QUOTE"}}),0);
 const otherBranch=await prisma.branch.create({data:{code:`OTHER-${suffix}`,name:"Other synthetic branch",city:"Test"}});const managerRole=await prisma.role.upsert({where:{key:"BRANCH_MANAGER"},create:{key:"BRANCH_MANAGER",name:"Branch manager",desc:"Fixture role"},update:{}});const outsider=await prisma.user.create({data:{employeeCode:`OTHER-${suffix}`,name:"Other branch manager",email:`other-${suffix}@example.test`,phone:"",passwordHash:await bcrypt.hash(password,12),roleId:managerRole.id,branchId:otherBranch.id}});const outsideLogin=await post("/api/auth/login",{email:outsider.email,password});assert.equal(outsideLogin.response.status,200);const outsideCookie=outsideLogin.cookie;
 assert.equal((await post("/api/sales",{action:"stage",leadId:lead.data.id,stage:"LOST",lostReason:"Out of scope"},outsideCookie)).response.status,403);
 assert.equal((await post("/api/customers/import",{action:"preview",csv,branchId:branch.id},outsideCookie)).response.status,403);
 const outsideSales=await fetch(origin+"/api/sales",{headers:{Cookie:outsideCookie}}).then(r=>r.json());assert.equal(outsideSales.leads.length,0);
 assert.equal((await fetch(origin+`/api/sales?leadId=${lead.data.id}`,{headers:{Cookie:outsideCookie}})).status,404,"Fresh recovery cannot cross branch boundaries");
 assert.equal((await fetch(origin+"/api/sales?leadId=missing-fixture",{headers:{Cookie:cookie}})).status,404);

 // Regression: branch-scoped mutation must not access a record with no branch.
 const unscopedTask=await prisma.task.create({data:{title:"Unscoped fixture",ownerId:user.id,creatorId:user.id}});
 assert.equal((await post("/api/tasks/status",{taskId:unscopedTask.id,status:"DONE"},outsideCookie)).response.status,403);
 const opsRole=await prisma.role.upsert({where:{key:"OPERATIONS"},create:{key:"OPERATIONS",name:"Operations",desc:"Fixture role"},update:{}});
 const ops=await prisma.user.create({data:{employeeCode:`OPS-${suffix}`,name:"Scoped non-finance fixture",email:`ops-${suffix}@example.test`,phone:"",passwordHash:await bcrypt.hash(password,12),roleId:opsRole.id,branchId:branch.id}});
 const opsLogin=await post("/api/auth/login",{email:ops.email,password});assert.equal(opsLogin.response.status,200);
 const redacted=await currentSales(historyLead.data.id,opsLogin.cookie);assert.equal(redacted.canQuote,false);assert.equal(redacted.lead.budgetMinor,null);assert.equal(redacted.lead.quotes[0].totalMinor,null);assert.equal(redacted.lead.quotes[0].costMinor,null);assert.deepEqual(redacted.lead.quotes[0].items,[]);assert(!JSON.stringify(redacted).includes("shareHash"));assert(!Object.hasOwn(redacted,"sessionId"));
 assert.equal((await post("/api/sales",{...historyInput,baseRevision:redacted.lead.baseRevision},opsLogin.cookie)).response.status,403,"Revision token is not a write capability");
 const readOnlyRole=await prisma.role.upsert({where:{key:"READ_ONLY"},create:{key:"READ_ONLY",name:"Read only",desc:"Fixture role"},update:{}});
 await prisma.user.update({where:{id:ops.id},data:{roleId:readOnlyRole.id}});
 const changedAccess=await currentSales(historyLead.data.id,opsLogin.cookie);assert.notEqual(changedAccess.recoveryContext,redacted.recoveryContext);assert.equal(changedAccess.canEdit,false);
 const mergedCustomer=await prisma.customer.create({data:{code:`REC-MERGED-${suffix}`,name:"Merged recovery fixture",phone:"",city:"Test",branchId:branch.id,assignedToId:user.id,mergedIntoId:customer.id}});
 const mergedLead=await prisma.salesLead.create({data:{customerId:mergedCustomer.id,branchId:branch.id,ownerId:user.id,title:"Merged inaccessible enquiry",source:"Fixture"}});
 assert.equal((await fetch(origin+`/api/sales?leadId=${mergedLead.id}`,{headers:{Cookie:cookie}})).status,404,"Recovery excludes consolidated customer records");
 // Older eligible customers/enquiries remain discoverable beyond both former display caps.
 await prisma.customer.createMany({data:Array.from({length:501},(_,i)=>({code:`PAGE-${suffix}-${i}`,name:`AAA picker fixture ${i}`,phone:"",city:"Test",branchId:branch.id,assignedToId:user.id}))});
 const getDiscovery=async(path:string,session=cookie)=>{const response=await fetch(origin+path,{headers:{Cookie:session}});assert.equal(response.status,200);assert.match(response.headers.get("cache-control")??"",/no-store/);return response.json();};
 const firstCustomers=await getDiscovery("/api/sales?customers=1");assert.equal(firstCustomers.customers.length,50);assert(firstCustomers.nextCursor);assert(!firstCustomers.customers.some((c:{id:string})=>c.id===customer.id));
 const foundCustomer=await getDiscovery(`/api/sales?customers=1&q=${encodeURIComponent(customer.code)}`);assert(foundCustomer.customers.some((c:{id:string})=>c.id===customer.id),"Customer search includes names beyond the former 500 cap");
 const customerLookup=await getDiscovery(`/api/sales?customerId=${customer.id}`);assert.equal(customerLookup.customer.id,customer.id);assert.equal(customerLookup.recoveryContext,initialSales.recoveryContext);
 assert.equal((await fetch(origin+`/api/sales?customerId=${customer.id}`,{headers:{Cookie:outsideCookie}})).status,404);
 const pagedSales=await getDiscovery("/api/sales");assert(pagedSales.customers.some((c:{id:string})=>c.id===customer.id),"Every displayed enquiry retains its scoped customer label independently of picker page");
 assert.equal((await currentSales(lead.data.id,cookie)).lead.id,lead.data.id);
 await prisma.salesLead.createMany({data:Array.from({length:225},(_,i)=>({id:`discovery-${suffix}-${String(i).padStart(3,"0")}`,customerId:customer.id,branchId:branch.id,ownerId:user.id,title:`Old discovery fixture ${String(i).padStart(3,"0")}`,source:"Fixture",createdAt:new Date("2020-01-01T00:00:00.000Z")}))});
 const foundOld=await getDiscovery("/api/sales?q=Old%20discovery%20fixture%20000");assert.equal(foundOld.leads.length,1);assert.equal(foundOld.leads[0].id,`discovery-${suffix}-000`);
 const seen=new Set<string>();let cursor:string|null=null;do{const page=await getDiscovery(`/api/sales?q=Old%20discovery%20fixture${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`);assert(page.leads.length<=50);for(const row of page.leads){assert(!seen.has(row.id),"Equal timestamp page boundaries cannot duplicate enquiries");seen.add(row.id);}cursor=page.nextCursor;}while(cursor);assert.equal(seen.size,225);
 assert.equal((await getDiscovery("/api/sales?q=Old%20discovery%20fixture",outsideCookie)).leads.length,0,"Search never widens branch scope");
 assert.equal((await getDiscovery(`/api/sales?q=${encodeURIComponent("' OR 1=1 --")}`)).leads.length,0,"Search values never become SQL");
 assert.equal((await fetch(origin+"/api/sales?cursor=%",{headers:{Cookie:cookie}})).status,400);
 assert.equal((await fetch(origin+`/api/sales?customers=1&cursor=${encodeURIComponent(firstCustomers.nextCursor)}`,{headers:{Cookie:outsideCookie}})).status,400,"Foreign customer cursors are scope checked");
 const forcedOrigin="http://127.0.0.1:3218";const forced=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-p","3218","-H","127.0.0.1"],{env:{...process.env,APP_ORIGIN:forcedOrigin,JWT_SECRET:randomBytes(48).toString("hex"),CRM_REQUIRE_MFA:"true"},stdio:"ignore"});
 try{let ready=false;for(let i=0;i<60;i++){try{if((await fetch(forcedOrigin+"/api/health")).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert(ready,"MFA-enforced fixture server must become ready");const r=await fetch(forcedOrigin+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json",Origin:forcedOrigin},body:JSON.stringify({email:outsider.email,password})});assert.equal(r.status,200);const c=r.headers.get("set-cookie")!.split(";")[0];assert.equal((await fetch(forcedOrigin+"/api/sales",{headers:{Cookie:c}})).status,403,"Unenrolled staff cannot access business APIs when MFA is required");const dashboard=await fetch(forcedOrigin+"/dashboard",{headers:{Cookie:c},redirect:"manual"});assert(dashboard.headers.get("location")?.includes("/account-security"),"Unenrolled staff must be routed to enrolment");assert.equal((await fetch(forcedOrigin+"/api/auth/security",{headers:{Cookie:c}})).status,200,"Enrolment must remain available");}finally{forced.kill();}
 const recoveryToken=randomBytes(32).toString("hex");await prisma.staffRecovery.create({data:{id:randomUUID(),userId:user.id,tokenHash:hashToken(recoveryToken),expiresAt:new Date(Date.now()+600000)}});
 const newPassword=`Changed-${randomBytes(20).toString("hex")}`;assert.equal((await post("/api/auth/recover",{token:recoveryToken,password:newPassword})).response.status,400,"Password recovery cannot bypass MFA");
 assert.equal((await post("/api/auth/recover",{token:recoveryToken,password:newPassword,code:confirm.data.recovery[1]})).response.status,200);
 assert.equal((await post("/api/auth/recover",{token:recoveryToken,password:newPassword,code:confirm.data.recovery[2]})).response.status,400);
 assert.equal((await fetch(origin+"/api/auth/security",{headers:{Cookie:cookie}})).status,401,"Recovery must revoke every old session");
 assert.equal((await post("/api/auth/login",{email:user.email,password:newPassword,code:confirm.data.recovery[2]})).response.status,200);
 console.log("CRM HTTP integration passed: MFA/replay/recovery/sessions, quotes/conversion, encrypted passport lookup, advance allocation and per-applicant visa requirements.");
}catch(error){console.error(logs.slice(-3000));throw error;}finally{server.kill();await prisma.$disconnect();}
