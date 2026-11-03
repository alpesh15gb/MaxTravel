import assert from "node:assert/strict";
import { createHmac,randomBytes,randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { POST } from "../src/app/api/integrations/booking-platform/events/route";
if(!process.env.DATABASE_URL?.includes("integration-test.db"))throw Error("Run only with the dedicated integration-test.db.");
const secret=randomBytes(32).toString("hex");process.env.BOOKING_PLATFORM_SIGNING_KEYS=JSON.stringify({test:secret});
const suffix=randomUUID(),branch=await prisma.branch.create({data:{name:"Integration test",code:`TEST-${suffix}`,city:"Test"}}),role=await prisma.role.create({data:{key:`TEST-${suffix}`,name:"Test owner",desc:"Synthetic receiver test"}}),owner=await prisma.user.create({data:{employeeCode:`TEST-${suffix}`,name:"Integration owner",email:`owner-${suffix}@example.test`,phone:"",passwordHash:randomBytes(32).toString("hex"),roleId:role.id,branchId:branch.id}});
process.env.BOOKING_PLATFORM_OWNER_ID=owner.id;process.env.BOOKING_PLATFORM_BRANCH_ID=branch.id;
const bookingId=randomUUID(),paymentId=randomUUID(),refundId=randomUUID();
const base={bookingId,reference:`TEST-${suffix}`,revision:1,product:"HOTEL",status:"CONFIRMED",supplierBookingId:"TJ-test",totalMinor:10000,supplierMinor:9000,currency:"INR",createdAt:new Date().toISOString(),customer:{platformId:`user:${suffix}`,name:"Test guest",email:`guest-${suffix}@example.test`,phone:"9000000000",type:"INDIVIDUAL",gstNumber:null},travellers:[{name:"Test Guest"}],confirmation:{pnrs:[] as string[],hotelName:"Confirmed Test Hotel"},itinerary:{checkIn:"2026-12-20",checkOut:"2026-12-22"},payments:[{id:paymentId,reference:"pay_test",amountMinor:10000,status:"CAPTURED",createdAt:new Date().toISOString()}],refunds:[] as {id:string;reference:string;amountMinor:number;status:string}[],cancellationRefundMinor:0};
async function send(payload:typeof base,eventId=randomUUID(),valid=true,eventType="booking.updated"){const event={schemaVersion:1,eventId,eventType,aggregateId:payload.bookingId,revision:payload.revision,occurredAt:new Date().toISOString(),payload};const raw=JSON.stringify(event),timestamp=String(Math.floor(Date.now()/1000)),signature=createHmac("sha256",secret).update(`${timestamp}.${eventId}.${raw}`).digest("hex");const request=()=>new Request("http://localhost/api/integrations/booking-platform/events",{method:"POST",headers:{"Content-Type":"application/json","x-maxtravel-key-id":"test","x-maxtravel-timestamp":timestamp,"x-maxtravel-event-id":eventId,"x-maxtravel-signature":valid?signature:"0".repeat(64)},body:raw});return {response:await POST(request()),repeat:()=>POST(request())};}
try{
 assert.equal((await send(base,randomUUID(),false)).response.status,401);
 const first=await send(base);assert.equal(first.response.status,200);const mapped=await first.response.json();assert.equal((await first.repeat()).status,200);
 assert.equal((await prisma.booking.findUniqueOrThrow({where:{id:mapped.bookingId}})).hotelName,"Confirmed Test Hotel");
 const imported=await prisma.booking.findUniqueOrThrow({where:{id:mapped.bookingId}});assert.equal(imported.supplierCostConfirmed,true);assert.equal(imported.supplierCost,90);assert.equal(imported.travelEndDate?.toISOString().slice(0,10),"2026-12-22");
 assert.equal(await prisma.booking.count({where:{id:mapped.bookingId}}),1);assert.equal(await prisma.payment.count({where:{bookingId:mapped.bookingId}}),1);
 const emailBefore=await prisma.clientEmail.count({where:{customerId:mapped.customerId}});
 const tracking={id:randomUUID(),status:"SUPPLIER_PENDING",supplierStatus:"CANCELLATION_PENDING",lastCheckedAt:"2026-11-01T10:00:00Z",nextCheckAt:"2026-11-02T10:00:00Z",followUpRequired:true,checkError:null};
 const pending={...base,revision:2,itinerary:{...base.itinerary,cancellationTracking:[tracking]}};
 const pendingEvent=await send(pending,randomUUID(),true,"cancellation.follow_up_required");assert.equal(pendingEvent.response.status,200);assert.equal((await pendingEvent.repeat()).status,200);
 const linked=await prisma.booking.findUniqueOrThrow({where:{id:mapped.bookingId}});
 const caseHistory=await prisma.serviceCaseEvent.findMany({where:{caseId:linked.serviceCaseId!}});
 assert.equal(caseHistory.filter(e=>e.summary.includes("Cancellation needs staff follow-up")).length,1);assert.ok(caseHistory.some(e=>e.summary.includes("Next check")&&e.summary.includes("IST")));
 assert.equal(await prisma.payment.count({where:{bookingId:mapped.bookingId}}),1);assert.equal(await prisma.clientEmail.count({where:{customerId:mapped.customerId}}),emailBefore);
 const malformed={...pending,revision:3,itinerary:{...pending.itinerary,cancellationTracking:[{...tracking,nextCheckAt:"invalid"}]}};
 assert.equal((await send(malformed,randomUUID(),true,"cancellation.status_updated")).response.status,400);
 console.log("PASS: signed cancellation escalation appears once in the case history with the next IST check; no duplicate receipt/notification or implied refund.");
 const partial={...base,revision:3,cancellationRefundMinor:3000,refunds:[{id:refundId,reference:"rfnd_test",amountMinor:3000,status:"COMPLETED"}]};assert.equal((await send(partial)).response.status,200);assert.equal((await prisma.booking.findUniqueOrThrow({where:{id:mapped.bookingId}})).status,"CONFIRMED");assert.equal((await prisma.financialEntry.aggregate({where:{partyId:mapped.customerId},_sum:{amountMinor:true}}))._sum.amountMinor,0n);
 const cancelled={...base,revision:4,status:"CANCELLED",cancellationRefundMinor:3000,refunds:[{id:refundId,reference:"rfnd_test",amountMinor:3000,status:"COMPLETED"}]};assert.equal((await send(cancelled)).response.status,200);
 const ledger=await prisma.financialEntry.aggregate({where:{partyId:mapped.customerId},_sum:{amountMinor:true}});assert.equal(ledger._sum.amountMinor,0n);
 assert.equal((await send({...base,revision:2})).response.status,200);assert.equal((await prisma.platformBookingLink.findUniqueOrThrow({where:{platformId:bookingId}})).revision,4);
 assert.equal((await prisma.booking.findUniqueOrThrow({where:{id:mapped.bookingId}})).status,"CANCELLED");
 // Old signed payloads remain Razorpay-compatible; new snapshots identify the gateway.
 const legacyPayment=await prisma.payment.findUniqueOrThrow({where:{id:`platform-${paymentId}`}});
 assert.equal(legacyPayment.mode,"RAZORPAY");assert.equal(legacyPayment.note,"Razorpay pay_test");
 for(const [provider,method,expectedMode,label] of [["PAYGLOCAL",null,"PAYGLOCAL","PayGlocal"],["PAYGLOCAL","card","CARD","PayGlocal"],["RAZORPAY",null,"RAZORPAY","Razorpay"]] as const){
  const id=randomUUID();const payload={...base,bookingId:randomUUID(),reference:`PROVIDER-${id}`,payments:[{...base.payments[0],id,provider,method,reference:`reference-${id}`} ]};
  const response=await send(payload);assert.equal(response.response.status,200);assert.equal((await response.repeat()).status,200);
  const receipt=await prisma.payment.findUniqueOrThrow({where:{id:`platform-${id}`}});assert.equal(receipt.mode,expectedMode);assert.equal(receipt.note,`${label} reference-${id}`);
  assert.equal(await prisma.payment.count({where:{bookingId:receipt.bookingId}}),1);
 }
 const invalidProvider={...base,bookingId:randomUUID(),payments:[{...base.payments[0],id:randomUUID(),provider:"UNKNOWN_GATEWAY"}]};
 assert.equal((await send(invalidProvider)).response.status,400);
 console.log("PASS: provider identity, legacy Razorpay compatibility, unknown-provider denial, receipt method preservation and duplicate receipt prevention.");
 console.log("PASS: signed receiver, forged signature denial, duplicate event/payment prevention, stale revision protection, native hotel booking, refund and retained-charge journal reconciliation.");
}finally{await prisma.$disconnect();}
