import { prisma } from "@/lib/db";
import { requireSession,assertCan,ApiError,jsonError } from "@/lib/guard";
import { customerFor,relatedFor,transactionAudit } from "@/lib/transactions";
export async function POST(req:Request){try{
 const user=await requireSession("invoice:create");assertCan(user,"payment:view");
 const b=await req.json();if(!["Booking","VisaCase","Invoice"].includes(b.type)||typeof b.id!=="string")throw new ApiError(400,"Choose a financial obligation.");
 if(b.dueDate!==null&&(typeof b.dueDate!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate)||!Number.isFinite(Date.parse(b.dueDate))||new Date(b.dueDate).toISOString().slice(0,10)!==b.dueDate))throw new ApiError(400,"Choose a valid due date or explicitly clear it.");
 const due=b.dueDate?new Date(`${b.dueDate}T00:00:00+05:30`):null;
 await prisma.$transaction(async tx=>{
  if(b.type==="Booking"){const record=await tx.booking.findUnique({where:{id:b.id}});if(!record)throw new ApiError(404,"Booking not found.");await customerFor(tx,user,record.customerId);await relatedFor(tx,user,record.customerId,record.id,null);await tx.booking.update({where:{id:record.id},data:{paymentDueDate:due}});}
  else if(b.type==="VisaCase"){const record=await tx.visaCase.findUnique({where:{id:b.id}});if(!record)throw new ApiError(404,"Case not found.");await customerFor(tx,user,record.customerId);await relatedFor(tx,user,record.customerId,null,record.id);await tx.visaCase.update({where:{id:record.id},data:{paymentDueDate:due}});}
  else {const record=await tx.invoice.findUnique({where:{id:b.id}});if(!record)throw new ApiError(404,"Invoice not found.");await customerFor(tx,user,record.customerId);if(record.bookingId||record.visaCaseId)throw new ApiError(400,"Set payment terms on the linked booking or visa case instead.");await tx.invoice.update({where:{id:record.id},data:{dueDate:due}});}
  await transactionAudit(tx,user,"PAYMENT_TERMS",b.type,b.id,due?`Due ${b.dueDate}`:"Due date cleared");
 });return Response.json({ok:true});
}catch(e){return jsonError(e);}}
