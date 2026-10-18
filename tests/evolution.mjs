// End-to-end provider integration with a local fake Evolution server. Never contacts WhatsApp.
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { chromium } from "./browser.mjs";
const ROOT=process.cwd(), runtime=path.join(ROOT,"tests/.runtime",`evolution-${Date.now()}`);
fs.mkdirSync(runtime,{recursive:true});
fs.writeFileSync(path.join(runtime,"test.db"),Buffer.alloc(0));
const password=`Test-${randomBytes(15).toString("hex")}!`, secret=randomBytes(32).toString("hex"), key=randomBytes(32).toString("hex");
const freePort=()=>new Promise(resolve=>{const s=net.createServer().listen(0,"127.0.0.1",()=>{const port=s.address().port;s.close(()=>resolve(port));});});
const port=await freePort(), providerPort=await freePort(), base=`http://127.0.0.1:${port}`;
const env={...process.env,WA_PROVIDER:"evolution",APP_ORIGIN:base,DATABASE_URL:`file:${path.join(runtime,"test.db").replaceAll("\\","/")}`,JWT_SECRET:randomBytes(32).toString("hex"),UPLOAD_ROOT:path.join(runtime,"uploads"),EVOLUTION_BASE_URL:`http://127.0.0.1:${providerPort}`,EVOLUTION_API_KEY:key,EVOLUTION_INSTANCE:"max travel",WA_WEBHOOK_SECRET:secret,WA_WORKER_SECRET:secret};
const db=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}});
const auth={Authorization:`Bearer ${secret}`};
let state="open", sendMode="success", sends=0, sent=[], count=0, browser;
const post=(url,body={},cookie="",headers={})=>fetch(base+url,{method:"POST",headers:{"Content-Type":"application/json",...(cookie?{cookie}:{}),...headers},body:JSON.stringify(body)});
async function ok(url,body,cookie="",headers={}){const r=await post(url,body,cookie,headers);const d=await r.json();assert(r.ok,`${url}: ${r.status} ${JSON.stringify(d)}`);return d;}
async function check(name,fn){await fn();count++;console.log(`PASS ${name}`);}
const hook=(event,data,instance="max travel")=>post("/api/whatsapp/evolution",{instance,event,data},"",auth);
const provider=http.createServer(async(req,res)=>{
 try {
  assert.equal(req.headers.apikey,key);
  assert(req.url.endsWith("/max%20travel"),req.url);
  res.setHeader("Content-Type","application/json");
  if(req.url.startsWith("/instance/connectionState/")){res.end(JSON.stringify({instance:{state}}));return;}
  assert(req.url.startsWith("/message/sendText/"));
  let raw="";for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw);sent.push(body);sends++;
  if(sendMode==="429"){res.statusCode=429;res.end("{}");return;}
  if(sendMode==="500"){res.statusCode=500;res.end("{}");return;}
  const id=`out-${sends}`;
  // Deliberately race the webhook ahead of the send response.
  await hook("messages.update",{keyId:id,status:"READ"});
  res.end(JSON.stringify({key:{id},status:"PENDING"}));
 }catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}));}
}).listen(providerPort,"127.0.0.1");
const cli=path.join(ROOT,"node_modules/prisma/build/index.js");
execFileSync(process.execPath,[cli,"migrate","deploy"],{env,stdio:"pipe"});
const log=fs.createWriteStream(path.join(runtime,"server.log"));
const server=spawn(process.execPath,[path.join(ROOT,"node_modules/next/dist/bin/next"),"start","-p",String(port),"-H","127.0.0.1"],{env,stdio:["ignore","pipe","pipe"]});server.stdout.pipe(log);server.stderr.pipe(log);
try {
 for(let i=0;i<100;i++){try{if((await fetch(base+"/setup")).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 await ok("/api/setup",{agencyName:"Evolution Test",city:"Pune",name:"Owner",email:"owner@evolution.test",password});
 const login=await post("/api/auth/login",{email:"owner@evolution.test",password});assert.equal(login.status,200);const cookie=login.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
 const alice=await ok("/api/customers",{name:"Alice",phone:"+919000000002",city:"Pune"},cookie);
 const bob=await ok("/api/customers",{name:"Bob",phone:"+919000000003",city:"Pune"},cookie);

 const ownerRow=await db.user.findUniqueOrThrow({where:{email:"owner@evolution.test"}});
 const staffRole=await db.role.findUniqueOrThrow({where:{key:"SALES_EXECUTIVE"}});
 await db.user.create({data:{name:"Restricted staff",email:"staff@evolution.test",employeeCode:"TEST-STAFF",phone:"",passwordHash:ownerRow.passwordHash,roleId:staffRole.id,branchId:ownerRow.branchId}});
 const staffLogin=await post("/api/auth/login",{email:"staff@evolution.test",password});assert.equal(staffLogin.status,200);const staffCookie=staffLogin.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
 await check("Restricted staff cannot message or change consent for another staff member's customer",async()=>{assert.equal((await post("/api/whatsapp/send",{customerId:alice.id,text:"Forbidden",requestId:randomBytes(16).toString("hex")},staffCookie)).status,403);assert.equal((await post("/api/whatsapp/settings",{customerId:alice.id,optIn:true},staffCookie)).status,403);});
 await check("Only administrators can enable automatic messaging rules",async()=>assert.equal((await post("/api/whatsapp/settings",{rules:["STATUS_UPDATE"]},staffCookie)).status,403));
 const requestId=randomBytes(16).toString("hex");let message;
 await check("Provider status is authenticated and never exposes its key",async()=>{assert.equal((await fetch(base+"/api/whatsapp/connection")).status,401);const r=await fetch(base+"/api/whatsapp/connection",{headers:{cookie}});const text=await r.text();assert(!text.includes(key));assert.equal(JSON.parse(text).state,"open");});
 await check("Worker endpoint rejects unauthenticated calls",async()=>assert.equal((await post("/api/whatsapp/process")).status,403));
 await check("Webhook rejects forged credentials and other instances",async()=>{assert.equal((await post("/api/whatsapp/evolution",{instance:"max travel"})).status,403);assert.equal((await hook("messages.upsert",{},"whatsapp-main")).status,403);});
 await check("Outbound message is queued, attributed, and not falsely delivered",async()=>{message=await ok("/api/whatsapp/send",{customerId:alice.id,text:"Hello Alice",requestId},cookie);assert.equal(message.status,"QUEUED");assert.equal(sends,0);assert((await db.whatsAppMessage.findUniqueOrThrow({where:{id:message.messageId}})).staffId);});
 await check("Duplicate requests enqueue exactly one message",async()=>{const repeated=await ok("/api/whatsapp/send",{customerId:alice.id,text:"Hello Alice",requestId},cookie);assert.equal(repeated.messageId,message.messageId);assert.equal(await db.whatsAppMessage.count({where:{direction:"OUT"}}),1);assert.equal((await post("/api/whatsapp/send",{customerId:bob.id,text:"Hello Alice",requestId},cookie)).status,409);});
 await check("Disconnected sessions pause queue without sending",async()=>{state="close";await ok("/api/whatsapp/process",{},"",auth);assert.equal(sends,0);assert.equal((await db.whatsAppMessage.findUniqueOrThrow({where:{id:message.messageId}})).status,"QUEUED");state="open";});
 await check("Worker sends only to the selected instance and preserves early READ receipt",async()=>{await ok("/api/whatsapp/process",{},"",auth);assert.equal(sends,1);assert.equal(sent[0].number,"919000000002");assert.equal((await db.whatsAppMessage.findUniqueOrThrow({where:{id:message.messageId}})).status,"READ");});
 await check("Late delivery receipts cannot downgrade a read message",async()=>{await hook("MESSAGES_UPDATE",{keyId:"out-1",status:"DELIVERY_ACK"});assert.equal((await db.whatsAppMessage.findUniqueOrThrow({where:{id:message.messageId}})).status,"READ");});
 const incoming={key:{id:"in-1",remoteJid:"919000000002@s.whatsapp.net",fromMe:false},message:{conversation:"Please confirm my appointment"},messageTimestamp:Math.floor(Date.now()/1000)};
 await check("Inbound messages are matched and webhook retries are deduplicated",async()=>{assert.equal((await hook("messages.upsert",incoming)).status,200);await hook("messages.upsert",incoming);assert.equal(await db.whatsAppMessage.count({where:{direction:"IN"}}),1);assert.equal((await db.whatsAppThread.findUniqueOrThrow({where:{id:message.threadId}})).unread,1);});
 await check("Groups and unresolved WhatsApp LIDs are never mistaken for customers",async()=>{await hook("messages.upsert",{...incoming,key:{...incoming.key,id:"group",remoteJid:"919000000002@g.us"}});await hook("messages.upsert",{...incoming,key:{...incoming.key,id:"lid",remoteJid:"919000000002@lid"}});assert.equal(await db.whatsAppMessage.count({where:{direction:"IN"}}),1);});
 await check("Unknown senders are retained for admin matching",async()=>{await hook("messages.upsert",{...incoming,key:{...incoming.key,id:"unknown",remoteJid:"919000000099@s.whatsapp.net"}});const item=await db.whatsAppInbound.findFirstOrThrow({where:{matched:false}});assert.equal(item.reason,"NO_MATCH");await ok("/api/whatsapp/settings",{inboundId:item.id,matchCustomerId:bob.id},cookie);assert((await db.whatsAppInbound.findUniqueOrThrow({where:{id:item.id}})).matched);});
 await check("Consent is opt-in and STOP withdraws it",async()=>{assert.equal((await db.customer.findUniqueOrThrow({where:{id:alice.id}})).whatsappOptIn,false);await ok("/api/whatsapp/settings",{customerId:alice.id,optIn:true},cookie);await hook("messages.upsert",{...incoming,key:{...incoming.key,id:"stop"},message:{conversation:"STOP"}});assert.equal((await db.customer.findUniqueOrThrow({where:{id:alice.id}})).whatsappOptIn,false);});
 await check("Unknown send outcomes are never retried automatically",async()=>{sendMode="500";const m=await ok("/api/whatsapp/send",{customerId:alice.id,text:"Ambiguous",requestId:randomBytes(16).toString("hex")},cookie);await ok("/api/whatsapp/process",{},"",auth);assert.equal((await db.whatsAppMessage.findUniqueOrThrow({where:{id:m.messageId}})).status,"UNKNOWN");const n=sends;await ok("/api/whatsapp/process",{},"",auth);assert.equal(sends,n);sendMode="success";});
 await check("Explicit rate-limit rejection backs off without claiming success",async()=>{sendMode="429";const m=await ok("/api/whatsapp/send",{customerId:alice.id,text:"Retry later",requestId:randomBytes(16).toString("hex")},cookie);await ok("/api/whatsapp/process",{},"",auth);const row=await db.whatsAppMessage.findUniqueOrThrow({where:{id:m.messageId}});assert.equal(row.status,"QUEUED");assert(row.nextAttempt>new Date());await db.whatsAppMessage.update({where:{id:m.messageId},data:{status:"CANCELLED"}});sendMode="success";});
 await check("Recipient changes cancel pending sends",async()=>{const m=await ok("/api/whatsapp/send",{customerId:bob.id,text:"Old phone",requestId:randomBytes(16).toString("hex")},cookie);await db.customer.update({where:{id:bob.id},data:{phone:"+919000000004"}});const n=sends;await ok("/api/whatsapp/process",{},"",auth);assert.equal(sends,n);assert.equal((await db.whatsAppMessage.findUniqueOrThrow({where:{id:m.messageId}})).status,"CANCELLED");});
 const traveller=await db.traveller.findFirstOrThrow({where:{customerId:alice.id}});
 const vc=await ok("/api/visa/cases",{customerId:alice.id,travellerIds:[traveller.id],destination:"France",visaType:"Visitor"},cookie);
 const next=await db.visaStage.findFirstOrThrow({where:{key:"ASSESSMENT"}}).catch(()=>db.visaStage.findFirstOrThrow({where:{key:{not:"ENQUIRY"}},orderBy:{seq:"asc"}}));
 await check("Automation stays off until enabled, even for opted-in customers",async()=>{await ok("/api/whatsapp/settings",{customerId:alice.id,optIn:true},cookie);await ok(`/api/visa/cases/${vc.caseId}/stage`,{stageId:next.id},cookie);assert.equal(await db.whatsAppMessage.count({where:{automation:{not:null}}}),0);});
 await check("Enabled stage automation queues once and repeated same-stage saves do not spam",async()=>{await ok("/api/whatsapp/settings",{rules:["STATUS_UPDATE","APPOINTMENT_REMINDER","PNR_EXPIRY","PAYMENT_REMINDER"]},cookie);const enquiry=await db.visaStage.findUniqueOrThrow({where:{key:"ENQUIRY"}});await ok(`/api/visa/cases/${vc.caseId}/stage`,{stageId:enquiry.id},cookie);await ok(`/api/visa/cases/${vc.caseId}/stage`,{stageId:enquiry.id},cookie);assert.equal(await db.whatsAppMessage.count({where:{automation:"STATUS_UPDATE"}}),1);});
 await check("Scheduled appointment and PNR reminders are deduplicated",async()=>{await db.visaCase.update({where:{id:vc.caseId},data:{appointmentDate:new Date(Date.now()+3600000)}});await ok("/api/bookings",{customerId:alice.id,travellerIds:[traveller.id],pnr:"TEST01",deadlineHours:2},cookie);await ok("/api/whatsapp/process",{},"",auth);await ok("/api/whatsapp/process",{},"",auth);assert.equal(await db.whatsAppMessage.count({where:{automation:"APPOINTMENT_REMINDER"}}),1);assert.equal(await db.whatsAppMessage.count({where:{automation:"PNR_EXPIRY"}}),1);});
 await check("Worker lease prevents concurrent drains",async()=>{await db.settings.upsert({where:{key:"whatsapp.worker.lease"},create:{key:"whatsapp.worker.lease",value:`${Date.now()}:test`},update:{value:`${Date.now()}:test`}});const r=await ok("/api/whatsapp/process",{},"",auth);assert.equal(r.busy,true);await db.settings.delete({where:{key:"whatsapp.worker.lease"}});});

 let confirmedBooking;
 await check("Booking and payment acknowledgements remain off unless explicitly enabled",async()=>{
  const before=await db.whatsAppMessage.count({where:{automation:{in:["BOOKING_CREATED","PAYMENT_RECEIVED"]}}});
  const booking=await ok("/api/bookings",{customerId:alice.id,travellerIds:[traveller.id],fare:100,pnr:"OFF001"},cookie);
  await ok("/api/payments",{customerId:alice.id,bookingId:booking.bookingId,amount:10,mode:"UPI"},cookie);
  assert.equal(await db.whatsAppMessage.count({where:{automation:{in:["BOOKING_CREATED","PAYMENT_RECEIVED"]}}}),before);
 });
 await check("Enabled booking creation queues an acknowledgement without claiming ticket issuance",async()=>{
  await ok("/api/whatsapp/settings",{rules:["BOOKING_CREATED","TICKET_CONFIRMED","PAYMENT_RECEIVED"]},cookie);
  confirmedBooking=await ok("/api/bookings",{customerId:alice.id,travellerIds:[traveller.id],fare:100,pnr:"CONF01",sector:"BOM-DXB"},cookie);
  const row=await db.whatsAppMessage.findUniqueOrThrow({where:{requestKey:`auto:BOOKING_CREATED:${confirmedBooking.bookingId}`}});
  assert.equal(row.status,"QUEUED");assert(row.body.includes("Ticket issuance is not yet confirmed"));assert(row.body.includes("CONF01"));
 });
 await check("A committed payment queues the correct receipt; rejected payments queue nothing",async()=>{
  const payment=await ok("/api/payments",{customerId:alice.id,bookingId:confirmedBooking.bookingId,amount:25,mode:"UPI"},cookie);
  const row=await db.whatsAppMessage.findUniqueOrThrow({where:{requestKey:`auto:PAYMENT_RECEIVED:${payment.payment.id}`}});
  assert(row.body.includes(payment.receiptNo));assert(row.body.includes("25"));assert(row.body.includes("after this payment: ₹75"));assert.equal(row.status,"QUEUED");
  const n=await db.whatsAppMessage.count({where:{automation:"PAYMENT_RECEIVED"}});
  assert.equal((await post("/api/payments",{customerId:alice.id,bookingId:confirmedBooking.bookingId,amount:1000,mode:"UPI"},cookie)).status,400);
  assert.equal(await db.whatsAppMessage.count({where:{automation:"PAYMENT_RECEIVED"}}),n);
 });
 await check("Ticket confirmations require actual ticket numbers and repeated saves do not duplicate",async()=>{
  assert.equal((await post("/api/bookings/status",{bookingId:confirmedBooking.bookingId,status:"TICKETED",tickets:[]},cookie)).status,400);
  const input={bookingId:confirmedBooking.bookingId,status:"TICKETED",tickets:[{travellerId:traveller.id,ticketNo:"123-1234567890"}]};
  await ok("/api/bookings/status",input,cookie);await ok("/api/bookings/status",input,cookie);
  const row=await db.whatsAppMessage.findUniqueOrThrow({where:{requestKey:`auto:TICKET_CONFIRMED:${confirmedBooking.bookingId}`}});assert(row.body.includes("123-1234567890"));
  assert.equal(await db.whatsAppMessage.count({where:{automation:"TICKET_CONFIRMED"}}),1);
 });
 await check("Transactional confirmations send outside reminder hours and obsolete booking notices are cancelled",async()=>{
  const n=sends;await ok("/api/whatsapp/process",{},"",auth);assert.equal(sends,n+2);
  assert.equal((await db.whatsAppMessage.findUniqueOrThrow({where:{requestKey:`auto:BOOKING_CREATED:${confirmedBooking.bookingId}`}})).status,"CANCELLED");
  assert.equal((await db.whatsAppMessage.findUniqueOrThrow({where:{requestKey:`auto:TICKET_CONFIRMED:${confirmedBooking.bookingId}`}})).status,"READ");
 });
 await check("Payment template changes require administrator access and valid placeholders",async()=>{
  const valid="Thanks {customer}. Payment {amount}, receipt {receipt}. Balance for {balanceReference}: {balance}.";
  assert.equal((await post("/api/whatsapp/settings",{paymentTemplate:valid},staffCookie)).status,403);
  assert.equal((await post("/api/whatsapp/settings",{paymentTemplate:valid.replace("{balance}","{secret}")},cookie)).status,400);
  assert.equal((await post("/api/whatsapp/settings",{paymentTemplate:"Missing financial placeholders"},cookie)).status,400);
  assert.equal((await post("/api/whatsapp/settings",{paymentTemplate:"x".repeat(2501)},cookie)).status,400);
  await ok("/api/whatsapp/settings",{paymentTemplate:valid},cookie);
  assert.equal((await db.settings.findUniqueOrThrow({where:{key:"whatsapp.template.PAYMENT_RECEIVED"}})).value,valid);
 });
 await check("Custom receipts calculate linked-work balance across direct and invoiced payments",async()=>{
  const inv=await ok("/api/invoices",{customerId:alice.id,bookingId:confirmedBooking.bookingId,amount:100},cookie);
  const payment=await ok("/api/payments",{customerId:alice.id,invoiceId:inv.invoiceId,amount:15,mode:"UPI"},cookie);
  const row=await db.whatsAppMessage.findUniqueOrThrow({where:{requestKey:`auto:PAYMENT_RECEIVED:${payment.payment.id}`}});
  assert(row.body.startsWith("Thanks Alice."));assert(row.body.includes(payment.receiptNo));assert(row.body.includes(`Balance for ${confirmedBooking.bookingNo}: ₹60.`));assert(!row.body.includes("{"));
  // An existing receipt retains its historical balance and template.
  const old=await db.whatsAppMessage.findFirstOrThrow({where:{automation:"PAYMENT_RECEIVED",body:{contains:"after this payment"}}});assert(old.body.includes("₹75"));
 });
 await check("Standalone invoices and visa payments have their own balances; advances have none",async()=>{
  const inv=await ok("/api/invoices",{customerId:alice.id,amount:80},cookie);
  const visa=await ok("/api/visa/cases",{customerId:alice.id,travellerIds:[traveller.id],destination:"France",visaType:"Visitor",sellingPrice:120},cookie);
  for(const [allocation,amount,expected] of [
    [{invoiceId:inv.invoiceId},30,`Balance for ${inv.invoiceNo}: ₹50.`],
    [{visaCaseId:visa.caseId},20,`Balance for ${visa.caseNo}: ₹100.`],
    [{},10,"Not applicable (unallocated customer advance)"],
  ]) {
    const payment=await ok("/api/payments",{customerId:alice.id,...allocation,amount,mode:"CASH"},cookie);
    const row=await db.whatsAppMessage.findUniqueOrThrow({where:{requestKey:`auto:PAYMENT_RECEIVED:${payment.payment.id}`}});assert(row.body.includes(expected),row.body);
  }
 });
 await check("A fully settled invoice reports a zero balance",async()=>{
  const inv=await ok("/api/invoices",{customerId:alice.id,amount:10.50},cookie);
  const payment=await ok("/api/payments",{customerId:alice.id,invoiceId:inv.invoiceId,amount:10.50,mode:"UPI"},cookie);
  const row=await db.whatsAppMessage.findUniqueOrThrow({where:{requestKey:`auto:PAYMENT_RECEIVED:${payment.payment.id}`}});assert(row.body.includes(`Balance for ${inv.invoiceNo}: \u20b90.`),row.body);
 });
 await check("A completed partial refund is reflected in the next booking balance",async()=>{
  // Provider integration fixture: only a paid refund changes the receivable.
  await db.refund.create({data:{refundNo:"TEST-REFUND",customerId:alice.id,bookingId:confirmedBooking.bookingId,amount:10,status:"PAID"}});
  const payment=await ok("/api/payments",{customerId:alice.id,bookingId:confirmedBooking.bookingId,amount:5,mode:"UPI"},cookie);
  const row=await db.whatsAppMessage.findUniqueOrThrow({where:{requestKey:`auto:PAYMENT_RECEIVED:${payment.payment.id}`}});assert(row.body.includes(`Balance for ${confirmedBooking.bookingNo}: ₹65.`),row.body);
  await ok("/api/whatsapp/settings",{paymentTemplate:null},cookie);assert.equal(await db.settings.findUnique({where:{key:"whatsapp.template.PAYMENT_RECEIVED"}}),null);
 });
 let collectionCase, collectionLink;
 const checklist=await ok("/api/checklists",{country:"Collection test",visaType:"Visitor",applicantType:"STANDARD",items:[{name:"Passport copy",required:true,fileTypes:"pdf,jpg,png",maxSizeMb:1}]},cookie);
 const createCollection=()=>ok("/api/visa/cases",{customerId:alice.id,travellerIds:[traveller.id],destination:"Collection test",visaType:"Visitor",checklistId:checklist.checklist.id},cookie);
 await check("Document collection requires its rule, customer consent and pending checklist documents",async()=>{
  const before=await db.uploadLink.count();await createCollection();assert.equal(await db.uploadLink.count(),before);
  await ok("/api/whatsapp/settings",{rules:["BOOKING_CREATED","TICKET_CONFIRMED","PAYMENT_RECEIVED","DOC_REQUEST"]},cookie);
  await ok("/api/whatsapp/settings",{customerId:alice.id,optIn:false},cookie);await createCollection();assert.equal(await db.uploadLink.count(),before);
  await ok("/api/whatsapp/settings",{customerId:alice.id,optIn:true},cookie);
  await ok("/api/visa/cases",{customerId:alice.id,travellerIds:[traveller.id],destination:"No checklist",visaType:"Visitor"},cookie);assert.equal(await db.uploadLink.count(),before);
 });
 await check("Creating a visa case queues a private seven-day case-specific document link",async()=>{
  collectionCase=await createCollection();collectionLink=await db.uploadLink.findFirstOrThrow({where:{visaCaseId:collectionCase.caseId}});
  assert.equal(collectionLink.customerId,alice.id);assert.equal(collectionLink.travellerId,null);assert(collectionLink.token.length>=32);assert(collectionLink.expiresAt>new Date(Date.now()+6*86400000));
  const row=await db.whatsAppMessage.findFirstOrThrow({where:{automation:"DOC_REQUEST",requestKey:{endsWith:`:${collectionCase.caseId}`}}});
  assert.equal(row.status,"QUEUED");assert(row.body.includes(collectionCase.caseNo));assert(row.body.includes("Passport copy"));assert(row.body.includes(`${base}/upload/${collectionLink.token}`));
  assert(row.body.includes("\n\n1. Passport copy\n\n"));assert(row.body.includes(`*Private upload link*\n${base}/upload/${collectionLink.token}\n\n`));assert(row.body.includes("*Link expires:*"));
  // A different case must never leak into this case's portal.
  const other=await createCollection();await db.document.updateMany({where:{visaCaseId:other.caseId},data:{docType:"Private-other-case-document"}});
  const page=await (await fetch(base+`/upload/${collectionLink.token}`)).text();assert(page.includes("Passport copy"));assert(!page.includes("Private-other-case-document"));
 });
 await check("Document requests send immediately and repeated worker polls do not duplicate",async()=>{
  const queued=await db.whatsAppMessage.findFirstOrThrow({where:{automation:"DOC_REQUEST",requestKey:{endsWith:`:${collectionCase.caseId}`}}});
  await db.whatsAppMessage.update({where:{id:queued.id},data:{body:`Hello customer, please provide documents for ${collectionCase.caseNo}: Passport copy. Upload privately: ${base}/upload/${collectionLink.token} . Keep this link private.`}});
  await ok("/api/whatsapp/process",{},"",auth);const row=await db.whatsAppMessage.findFirstOrThrow({where:{automation:"DOC_REQUEST",requestKey:{endsWith:`:${collectionCase.caseId}`}}});assert.equal(row.status,"READ");
  assert(row.body.includes("\n\n1. Passport copy\n\n"));assert(sent.some(message=>message.text===row.body));
  const n=sends;await ok("/api/whatsapp/process",{},"",auth);assert.equal(sends,n);
 });
 await check("Entering a document stage includes the existing private link without duplicate same-stage saves",async()=>{
  const stage=await db.visaStage.findFirstOrThrow({where:{name:{contains:"Document"}}});
  await ok(`/api/visa/cases/${collectionCase.caseId}/stage`,{stageId:stage.id},cookie);await ok(`/api/visa/cases/${collectionCase.caseId}/stage`,{stageId:stage.id},cookie);
  assert.equal(await db.uploadLink.count({where:{visaCaseId:collectionCase.caseId}}),1);
  const rows=await db.whatsAppMessage.findMany({where:{automation:"DOC_REQUEST",thread:{customerId:alice.id},body:{contains:collectionCase.caseNo}}});assert.equal(rows.length,2);assert(rows.every(row=>row.body.includes(collectionLink.token)));
  await db.uploadLink.update({where:{id:collectionLink.id},data:{revoked:true}});await ok("/api/whatsapp/process",{},"",auth);
  assert.equal((await db.whatsAppMessage.findFirstOrThrow({where:{automation:"DOC_REQUEST",body:{contains:collectionCase.caseNo},status:"CANCELLED"}})).status,"CANCELLED");
 });
 await check("Expired, completed and closed-case document requests are cancelled before sending",async()=>{
  for(const reason of ["expired","complete","closed"]) {
    const vc=await createCollection();const link=await db.uploadLink.findFirstOrThrow({where:{visaCaseId:vc.caseId}});
    if(reason==="expired")await db.uploadLink.update({where:{id:link.id},data:{expiresAt:new Date(Date.now()-1000)}});
    if(reason==="complete")await db.document.updateMany({where:{visaCaseId:vc.caseId},data:{status:"RECEIVED"}});
    if(reason==="closed")await db.visaCase.update({where:{id:vc.caseId},data:{closedAt:new Date()}});
    const n=sends;await ok("/api/whatsapp/process",{},"",auth);assert.equal(sends,n);
    assert.equal((await db.whatsAppMessage.findFirstOrThrow({where:{automation:"DOC_REQUEST",requestKey:{endsWith:`:${vc.caseId}`}}})).status,"CANCELLED");
  }
 });
 await check("Configured inbox renders staff attribution, consent and connection controls",async()=>{
   browser=await chromium.launch({headless:true});const context=await browser.newContext();await context.addCookies([{name:"tos_session",value:cookie.split("=")[1],url:base}]);const page=await context.newPage();await page.goto(base+`/whatsapp?customer=${alice.id}`,{waitUntil:"networkidle"});assert(await page.getByRole("button",{name:"Send WhatsApp message",exact:true}).isVisible());assert(await page.getByText("Customer agreed to receive WhatsApp messages").isVisible());await page.getByText("Automatic messages and unmatched replies",{exact:true}).click();assert(await page.getByLabel("Payment received acknowledgement").isChecked());
  const editor=page.getByLabel("Payment acknowledgement template",{exact:true});assert(await editor.isVisible());
  await editor.fill("Paid {amount}; receipt {receipt}; balance for {balanceReference}: {balance}. Thank you!");
  await page.getByRole("button",{name:"Save payment template",exact:true}).click();await page.getByRole("status").filter({hasText:"Payment template saved"}).waitFor();
  assert.equal((await db.settings.findUniqueOrThrow({where:{key:"whatsapp.template.PAYMENT_RECEIVED"}})).value,await editor.inputValue());
  await page.getByRole("button",{name:"Restore default",exact:true}).click();await page.getByRole("status").filter({hasText:"Default payment template restored"}).waitFor();await page.screenshot({path:path.join(runtime,"desktop.png"),fullPage:true});await page.setViewportSize({width:390,height:844});await page.goto(base+`/whatsapp?customer=${alice.id}`,{waitUntil:"networkidle"});await page.getByText("Automatic messages and unmatched replies",{exact:true}).click();assert(await page.getByLabel("Payment acknowledgement template",{exact:true}).isVisible());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(runtime,"phone.png"),fullPage:false});await browser.close();browser=null;
 });
 console.log(`${count} Evolution integration checks passed. Evidence: ${runtime}`);
}finally{
 if(browser)await browser.close();await db.$disconnect();provider.closeAllConnections();await new Promise(r=>provider.close(r));
 if(process.platform==="win32")spawn("taskkill",["/PID",String(server.pid),"/T","/F"],{stdio:"ignore"});else server.kill("SIGTERM");log.end();
}
