import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { processWhatsAppQueue, queueAutomation } from "../src/lib/whatsapp-queue";
import assert from "node:assert/strict";
import { createHmac,createHash,randomBytes,randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { POST } from "../src/app/api/integrations/booking-platform/events/route";
if(!process.env.DATABASE_URL?.includes("integration-test.db"))throw Error("Run only with the dedicated integration-test.db.");
const root=await mkdtemp(path.join(os.tmpdir(),"maxtravel-crm-doc-"));process.env.UPLOAD_ROOT=root;const originalFetch=globalThis.fetch;
const secret=randomBytes(32).toString("hex");process.env.BOOKING_PLATFORM_SIGNING_KEYS=JSON.stringify({test:secret});
const suffix=randomUUID(),branch=await prisma.branch.create({data:{name:"Integration test",code:`TEST-${suffix}`,city:"Test"}}),role=await prisma.role.create({data:{key:`TEST-${suffix}`,name:"Test owner",desc:"Synthetic receiver test"}}),owner=await prisma.user.create({data:{employeeCode:`TEST-${suffix}`,name:"Integration owner",email:`owner-${suffix}@example.test`,phone:"",passwordHash:randomBytes(32).toString("hex"),roleId:role.id,branchId:branch.id}});
process.env.BOOKING_PLATFORM_OWNER_ID=owner.id;process.env.BOOKING_PLATFORM_BRANCH_ID=branch.id;
const bookingId=randomUUID(),paymentId=randomUUID(),refundId=randomUUID();
const base={bookingId,reference:`TEST-${suffix}`,revision:1,product:"HOTEL",status:"CONFIRMED",supplierBookingId:"TJ-test",totalMinor:10000,supplierMinor:9000,currency:"INR",createdAt:new Date().toISOString(),customer:{platformId:`user:${suffix}`,name:"Test guest",email:`guest-${suffix}@example.test`,phone:"9000000000",type:"INDIVIDUAL",gstNumber:null},travellers:[{name:"Test Guest"}],confirmation:{pnrs:[] as string[],hotelName:"Confirmed Test Hotel"},itinerary:{checkIn:"2026-12-20",checkOut:"2026-12-22"},payments:[{id:paymentId,reference:"pay_test",amountMinor:10000,status:"CAPTURED",createdAt:new Date().toISOString()}],refunds:[] as {id:string;reference:string;amountMinor:number;status:string}[],cancellationRefundMinor:0};
async function send(payload:typeof base,eventId=randomUUID(),valid=true){const event={schemaVersion:1,eventId,eventType:"booking.updated",aggregateId:bookingId,revision:payload.revision,occurredAt:new Date().toISOString(),payload};const raw=JSON.stringify(event),timestamp=String(Math.floor(Date.now()/1000)),signature=createHmac("sha256",secret).update(`${timestamp}.${eventId}.${raw}`).digest("hex");const request=()=>new Request("http://localhost/api/integrations/booking-platform/events",{method:"POST",headers:{"Content-Type":"application/json","x-maxtravel-key-id":"test","x-maxtravel-timestamp":timestamp,"x-maxtravel-event-id":eventId,"x-maxtravel-signature":valid?signature:"0".repeat(64)},body:raw});return {response:await POST(request()),repeat:()=>POST(request())};}
try{
 assert.equal((await send(base,randomUUID(),false)).response.status,401);
 const first=await send(base);assert.equal(first.response.status,200);const mapped=await first.response.json();assert.equal((await first.repeat()).status,200);
 assert.equal((await prisma.booking.findUniqueOrThrow({where:{id:mapped.bookingId}})).hotelName,"Confirmed Test Hotel");
 assert.equal(await prisma.booking.count({where:{id:mapped.bookingId}}),1);assert.equal(await prisma.payment.count({where:{bookingId:mapped.bookingId}}),1);
 await prisma.customer.update({where:{id:mapped.customerId},data:{whatsappOptIn:true}});
 await prisma.settings.upsert({where:{key:"whatsapp.automation"},create:{key:"whatsapp.automation",value:'["BOOKING_DOCUMENT"]'},update:{value:'["BOOKING_DOCUMENT"]'}});
 Object.assign(process.env,{WA_PROVIDER:"meta",WA_CLOUD_ACCESS_TOKEN:"synthetic-document-test",WA_CLOUD_PHONE_NUMBER_ID:String(Date.now()),WA_CLOUD_WABA_ID:"222",WA_CLOUD_GRAPH_VERSION:"v99.0",WA_CLOUD_APP_SECRET:randomBytes(32).toString("hex"),WA_CLOUD_VERIFY_TOKEN:randomBytes(32).toString("hex"),WA_CLOUD_TEMPLATES:JSON.stringify({BOOKING_DOCUMENT:{name:"travel_document",language:"en",parameters:["customer","reference"]}})});
 const bytes=Buffer.from("%PDF-1.7\n1 0 obj<</Type /Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
 const withDocument={...base,revision:2,document:{filename:"confirmation.pdf",sha256:createHash("sha256").update(bytes).digest("hex"),base64:bytes.toString("base64")}};
 // This legacy-shaped frozen payload has no new fields: upgrades must accept
 // it unchanged, and exact bytes must remain retryable without duplicate effects.
 const delivered=await send(withDocument);assert.equal(delivered.response.status,200);const frozenRetry=await delivered.repeat();assert.equal(frozenRetry.status,200);assert.deepEqual(await frozenRetry.json(),{duplicate:true});
 const attachments=await prisma.whatsAppAttachment.findMany({where:{id:{startsWith:`platform-pdf-${bookingId}-`}}});assert.equal(attachments.length,1);
 const queued=await prisma.whatsAppMessage.findFirstOrThrow({where:{attachmentId:attachments[0].id}});assert.equal(queued.status,"QUEUED");assert.equal(queued.automation,"BOOKING_DOCUMENT");
 // Status-only updates must advance finance/status without claiming an available PDF.
 assert.equal((await send({...base,revision:3})).response.status,200);
 assert.equal((await prisma.platformBookingLink.findUniqueOrThrow({where:{platformId:bookingId}})).documentsCurrent,false);
 assert.equal((await prisma.whatsAppMessage.findUniqueOrThrow({where:{id:queued.id}})).status,"CANCELLED");
 assert.equal((await send({...withDocument,revision:3})).response.status,200);
 assert.equal(await prisma.whatsAppAttachment.count({where:{id:`platform-pdf-${bookingId}-3`}}),0,"same-revision PDF is not backfilled");
 const financialFailure=await send({...base,revision:4,payments:[{...base.payments[0],amountMinor:9999}]});
 assert.equal(financialFailure.response.status,409,"optional PDF omission must not hide immutable payment errors");
 assert.equal((await prisma.platformBookingLink.findUniqueOrThrow({where:{platformId:bookingId}})).revision,3,"financial failure rolls back revision");
 assert.equal((await send({...withDocument,revision:4})).response.status,200);
 assert.equal((await prisma.platformBookingLink.findUniqueOrThrow({where:{platformId:bookingId}})).documentsCurrent,true);
 // Legacy queued PDFs remain blocked even if a newer revision has a valid PDF.
 await prisma.whatsAppMessage.update({where:{id:queued.id},data:{status:"QUEUED"}});
 globalThis.fetch=async(input,init)=>{assert.ok(String(input).startsWith("https://graph.facebook.com/"));assert.equal(init?.method,"GET");return Response.json({id:process.env.WA_CLOUD_PHONE_NUMBER_ID});};
 await processWhatsAppQueue();assert.equal((await prisma.whatsAppMessage.findUniqueOrThrow({where:{id:queued.id}})).status,"CANCELLED");
 // Fixture removes its prior dedupe key to exercise a fresh current document send.
 // Production deliberately retains per-booking automation deduplication.
 await prisma.whatsAppMessage.delete({where:{id:queued.id}});
 await prisma.$transaction(tx=>queueAutomation(tx,mapped.customerId,"BOOKING_DOCUMENT",mapped.bookingId,"Synthetic stale document",{reference:base.reference},attachments[0].id));
 assert.equal(await prisma.whatsAppMessage.count({where:{requestKey:`auto:BOOKING_DOCUMENT:${mapped.bookingId}`}}),0,"stale attachment cannot queue");
 await prisma.$transaction(tx=>queueAutomation(tx,mapped.customerId,"BOOKING_DOCUMENT",mapped.bookingId,"Synthetic current document",{reference:base.reference},`platform-pdf-${bookingId}-4`));
 const current=await prisma.whatsAppMessage.findUniqueOrThrow({where:{requestKey:`auto:BOOKING_DOCUMENT:${mapped.bookingId}`}});
 let uploads=0,sends=0;
 globalThis.fetch=async(input,init)=>{
  const url=String(input);assert.ok(url.startsWith("https://graph.facebook.com/"));
  if(url.includes("message_templates"))return Response.json({data:[{name:"travel_document",language:"en",status:"APPROVED",category:"UTILITY",components:[{type:"HEADER",format:"DOCUMENT"},{type:"BODY",text:"Hello {{1}}, booking {{2}}"}]}]});
  if(url.endsWith("/media")){uploads++;assert.equal(init?.method,"POST");assert.equal((await send({...base,revision:5})).response.status,200);return Response.json({id:"123456"});}
  if(url.endsWith("/messages")){sends++;throw Error("No stale document may be submitted");}
  assert.equal(init?.method,"GET");return Response.json({id:process.env.WA_CLOUD_PHONE_NUMBER_ID});
 };
 await processWhatsAppQueue();assert.equal(uploads,1);assert.equal(sends,0);
 assert.equal((await prisma.whatsAppMessage.findUniqueOrThrow({where:{id:current.id}})).status,"CANCELLED","revision changing during upload must cancel before send");
 const partial={...base,revision:6,cancellations:[{partial:true,trips:[]}],cancellationRefundMinor:3000,refunds:[{id:refundId,reference:"rfnd_test",amountMinor:3000,status:"COMPLETED"}]};assert.equal((await send(partial)).response.status,200);assert.equal((await prisma.booking.findUniqueOrThrow({where:{id:mapped.bookingId}})).status,"TICKETED");assert.equal((await prisma.financialEntry.aggregate({where:{partyId:mapped.customerId},_sum:{amountMinor:true}}))._sum.amountMinor,0n);
 assert.equal((await prisma.platformBookingLink.findUniqueOrThrow({where:{platformId:bookingId}})).documentsCurrent,false);
 globalThis.fetch=async(input,init)=>{assert.ok(String(input).startsWith("https://graph.facebook.com/"));assert.equal(init?.method,"GET");return Response.json({id:process.env.WA_CLOUD_PHONE_NUMBER_ID});};
 await processWhatsAppQueue();assert.equal((await prisma.whatsAppMessage.findUniqueOrThrow({where:{id:current.id}})).status,"CANCELLED");
 const cancelled={...base,revision:7,status:"CANCELLED",cancellationRefundMinor:3000,refunds:[{id:refundId,reference:"rfnd_test",amountMinor:3000,status:"COMPLETED"}]};assert.equal((await send(cancelled)).response.status,200);
 const ledger=await prisma.financialEntry.aggregate({where:{partyId:mapped.customerId},_sum:{amountMinor:true}});assert.equal(ledger._sum.amountMinor,0n);
 assert.equal((await send({...base,revision:2})).response.status,200);assert.equal((await prisma.platformBookingLink.findUniqueOrThrow({where:{platformId:bookingId}})).revision,7);
 assert.equal((await prisma.booking.findUniqueOrThrow({where:{id:mapped.bookingId}})).status,"CANCELLED");
 console.log("PASS status-only delivery, unavailable-document truth, same-revision no-backfill, current-revision queue guards, revision-change-during-upload suppression, financial rollback; automatic PDF import, stable attachment/message deduplication and stale-document suppression; signed receiver, forged signature denial, duplicate event/payment prevention, stale revision protection, native hotel booking, refund and retained-charge journal reconciliation.");
}finally{globalThis.fetch=originalFetch;const attachments=await prisma.whatsAppAttachment.findMany({where:{id:{startsWith:`platform-pdf-${bookingId}-`}},select:{id:true}});await prisma.whatsAppMessage.deleteMany({where:{attachmentId:{in:attachments.map(a=>a.id)}}});await prisma.whatsAppAttachment.deleteMany({where:{id:{in:attachments.map(a=>a.id)}}});if(!path.resolve(root).startsWith(path.join(os.tmpdir(),"maxtravel-crm-doc-")))throw Error("Invalid fixture cleanup root");await rm(root,{recursive:true,force:true});await prisma.$disconnect();}
