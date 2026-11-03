import { mkdtemp,rm,realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {privatePdfFor} from "../src/lib/private-pdf-access";
import {readPdf} from "../src/lib/private-pdf";
import type {SessionUser} from "../src/lib/session";
import assert from "node:assert/strict";
import { createHmac,createHash,randomBytes,randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { POST } from "../src/app/api/integrations/booking-platform/events/route";
if(!process.env.DATABASE_URL?.includes("integration-test.db"))throw Error("Run only with the dedicated integration-test.db.");
const fixtureTmp=await realpath(os.tmpdir());const root=await mkdtemp(path.join(fixtureTmp,"maxtravel-crm-doc-"));process.env.UPLOAD_ROOT=root;const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error("Receiver must not contact a messaging or mail provider");};
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
 const bytes=Buffer.from("%PDF-1.7\n1 0 obj<</Type /Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
 const withDocument={...base,revision:2,document:{filename:"confirmation.pdf",sha256:createHash("sha256").update(bytes).digest("hex"),base64:bytes.toString("base64")}};
 // This legacy-shaped frozen payload has no new fields: upgrades must accept
 // it unchanged, and exact bytes must remain retryable without duplicate effects.
 const delivered=await send(withDocument);assert.equal(delivered.response.status,200);const frozenRetry=await delivered.repeat();assert.equal(frozenRetry.status,200);assert.deepEqual(await frozenRetry.json(),{duplicate:true});
 const attachments=await prisma.privatePdfAttachment.findMany({where:{id:{startsWith:`platform-pdf-${bookingId}-`}}});assert.equal(attachments.length,1);
 const user:SessionUser={id:owner.id,name:owner.name,email:owner.email,role:"OWNER",roleName:"Owner",employeeCode:owner.employeeCode,branchId:branch.id,branchName:branch.name,accessMode:"ALL",permissions:["document:view","ticketing:view"]};
 const available=await privatePdfFor(prisma,user,attachments[0].id);assert.deepEqual(await readPdf(available),bytes);
 await assert.rejects(()=>privatePdfFor(prisma,{...user,permissions:["ticketing:view"]},attachments[0].id));
 await assert.rejects(()=>privatePdfFor(prisma,{...user,permissions:["document:view"]},attachments[0].id));
 await assert.rejects(()=>privatePdfFor(prisma,{...user,accessMode:"BRANCH",branchId:"outside-branch"},attachments[0].id));
 await assert.rejects(()=>privatePdfFor(prisma,{...user,accessMode:"ASSIGNED",id:"other-staff"},attachments[0].id));
 await assert.rejects(()=>readPdf({...available,storageKey:"../private-file.pdf"}));
 await assert.rejects(()=>readPdf({...available,sha256:"0".repeat(64)}));
 // Status-only updates must advance finance/status without claiming an available PDF.
 assert.equal((await send({...base,revision:3})).response.status,200);
 assert.equal((await prisma.platformBookingLink.findUniqueOrThrow({where:{platformId:bookingId}})).documentsCurrent,false);
 await assert.rejects(()=>privatePdfFor(prisma,user,attachments[0].id));
 assert.equal((await send({...withDocument,revision:3})).response.status,200);
 assert.equal(await prisma.privatePdfAttachment.count({where:{id:`platform-pdf-${bookingId}-3`}}),0,"same-revision PDF is not backfilled");
 const financialFailure=await send({...base,revision:4,payments:[{...base.payments[0],amountMinor:9999}]});
 assert.equal(financialFailure.response.status,409,"optional PDF omission must not hide immutable payment errors");
 assert.equal((await prisma.platformBookingLink.findUniqueOrThrow({where:{platformId:bookingId}})).revision,3,"financial failure rolls back revision");
 assert.equal((await send({...withDocument,revision:4})).response.status,200);
 assert.equal((await prisma.platformBookingLink.findUniqueOrThrow({where:{platformId:bookingId}})).documentsCurrent,true);
 // A superseded document remains stored privately but cannot be served as current.
 await assert.rejects(()=>privatePdfFor(prisma,user,attachments[0].id));
 assert.deepEqual(await readPdf(await privatePdfFor(prisma,user,`platform-pdf-${bookingId}-4`)),bytes);
 assert.equal((await send({...base,revision:5})).response.status,200);
 await assert.rejects(()=>privatePdfFor(prisma,user,`platform-pdf-${bookingId}-4`));
 const partial={...base,revision:6,cancellations:[{partial:true,trips:[]}],cancellationRefundMinor:3000,refunds:[{id:refundId,reference:"rfnd_test",amountMinor:3000,status:"COMPLETED"}]};assert.equal((await send(partial)).response.status,200);assert.equal((await prisma.booking.findUniqueOrThrow({where:{id:mapped.bookingId}})).status,"CONFIRMED");assert.equal((await prisma.financialEntry.aggregate({where:{partyId:mapped.customerId},_sum:{amountMinor:true}}))._sum.amountMinor,0n);
 assert.equal((await prisma.platformBookingLink.findUniqueOrThrow({where:{platformId:bookingId}})).documentsCurrent,false);
 const cancelled={...base,revision:7,status:"CANCELLED",cancellationRefundMinor:3000,refunds:[{id:refundId,reference:"rfnd_test",amountMinor:3000,status:"COMPLETED"}]};assert.equal((await send(cancelled)).response.status,200);
 const ledger=await prisma.financialEntry.aggregate({where:{partyId:mapped.customerId},_sum:{amountMinor:true}});assert.equal(ledger._sum.amountMinor,0n);
 assert.equal((await send({...base,revision:2})).response.status,200);assert.equal((await prisma.platformBookingLink.findUniqueOrThrow({where:{platformId:bookingId}})).revision,7);
 assert.equal((await prisma.booking.findUniqueOrThrow({where:{id:mapped.bookingId}})).status,"CANCELLED");
 console.log("PASS signed receiver, forged signature denial, replay/stale revision guards, private PDF preservation/read integrity/path guard/staff permission and scope, current document serving, same-revision no-backfill, finance rollback, hotel booking and refund journal reconciliation; no automatic external delivery.");
}finally{globalThis.fetch=originalFetch;const attachments=await prisma.privatePdfAttachment.findMany({where:{id:{startsWith:`platform-pdf-${bookingId}-`}},select:{id:true}});await prisma.privatePdfAttachment.deleteMany({where:{id:{in:attachments.map(a=>a.id)}}});if(!path.resolve(root).startsWith(path.join(fixtureTmp,"maxtravel-crm-doc-")))throw Error("Invalid fixture cleanup root");await rm(root,{recursive:true,force:true});await prisma.$disconnect();}
