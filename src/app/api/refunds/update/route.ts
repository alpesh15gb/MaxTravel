import { requireSession,jsonError,ApiError,canTouchRecord } from "@/lib/guard";
import { prisma } from "@/lib/db";
import { transactionAudit } from "@/lib/transactions";
import { isFullyRefunded, isWithdrawnBooking } from "@/lib/receivables";
const NEXT:Record<string,string>={REQUESTED:"SUPPLIER_PENDING",SUPPLIER_PENDING:"SUPPLIER_RECEIVED",SUPPLIER_RECEIVED:"APPROVED",APPROVED:"PROCESSED",PROCESSED:"PAID"};
export async function POST(req:Request){try{const user=await requireSession("refund:manage");const {refundId,status,rejectionReason}=await req.json();const refund=await prisma.$transaction(async tx=>{const r=await tx.refund.findUnique({where:{id:String(refundId??"")},include:{customer:true}});if(!r)throw new ApiError(404,"Refund not found.");if(!canTouchRecord(user,r.customer))throw new ApiError(403,"Refund is outside your access.");if(NEXT[r.status]!==status&&!(status==="REJECTED"&&!["PAID","REJECTED","PROCESSED"].includes(r.status)))throw new ApiError(400,"Refund must move through the next pipeline stage.");if(["APPROVED","REJECTED"].includes(status)&&!user.permissions.includes("refund:approve"))throw new ApiError(403,"Refund approval requires an authorized approver.");const reason=String(rejectionReason??"").trim();if(status==="REJECTED"&&!reason)throw new ApiError(400,"Record a rejection reason so the customer request is answered.");const updated=await tx.refund.update({where:{id:r.id},data:{status,...(reason?{reason:`${r.reason?r.reason+" · ":""}Rejected: ${reason}`}:{}),...(status==="APPROVED"?{approvedById:user.id}:{}),...(status==="SUPPLIER_PENDING"?{supplierSentOn:new Date()}:{}),...(status==="SUPPLIER_RECEIVED"?{supplierReceivedOn:new Date()}:{}),...(status==="PROCESSED"?{processedById:user.id}:{}),...(status==="PAID"?{paidOn:new Date()}: {})}});// The sale status is only rewritten when a completed refund returns every rupee recorded as
// received: a partial refund leaves the trip as sold, and a rejected refund changes nothing at all.
  // Everything in between is pipeline state and lives on the refund itself, not on the booking.
  if(r.bookingId&&status==="PAID"){
    const [received,back,booking]=await Promise.all([
      tx.payment.aggregate({where:{bookingId:r.bookingId},_sum:{amount:true}}),
      tx.refund.findMany({where:{bookingId:r.bookingId,status:"PAID"},select:{amount:true,status:true}}),
      tx.booking.findUnique({where:{id:r.bookingId},select:{status:true}}),
    ]);
    // A booking already cancelled or voided keeps saying so: overwriting it with REFUNDED would erase
    // how the sale actually ended, which is the first thing anyone reading the file later asks.
    if(booking&&!isWithdrawnBooking(booking.status)&&isFullyRefunded(received._sum.amount??0,back))await tx.booking.update({where:{id:r.bookingId},data:{status:"REFUNDED"}});
  }// The rejection reason is the whole point of the audit row: "REJECTED" alone does not answer the
// customer asking why. Record it alongside the status so the trail is self-explanatory.
  await transactionAudit(tx,user,"STATUS","Refund",r.id,reason&&status==="REJECTED"?`${status} · ${reason}`:status);return updated;});return Response.json({ok:true,refund});}catch(e){return jsonError(e);}}
