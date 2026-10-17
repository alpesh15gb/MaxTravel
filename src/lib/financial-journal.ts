import type { Prisma } from "@prisma/client";
import { isWithdrawnBooking } from "./receivables";

type Tx = Prisma.TransactionClient;
type Position = { partyType:string; partyId:string; sourceType:string; sourceId:string; amountMinor:number; reference:string; description:string; dueDate?:Date|null };
export async function journalPlatformCharge(tx:Tx,bookingId:string,chargeMinor:number,actorId:string){
 const booking=await tx.booking.findUniqueOrThrow({where:{id:bookingId}});
 await postPosition(tx,{partyType:"CUSTOMER",partyId:booking.customerId,sourceType:"Booking",sourceId:bookingId,amountMinor:chargeMinor,reference:booking.bookingNo,description:`Online ${booking.product.toLowerCase()} charge / adjustment`},actorId);
}

async function postPosition(tx:Tx, p:Position, actorId:string) {
  const previous = await tx.financialEntry.findMany({where:{sourceType:p.sourceType,sourceId:p.sourceId},orderBy:{revision:"desc"}});
  const amount = previous.reduce((s,e)=>s+Number(e.amountMinor),0);
  const delta = p.amountMinor-amount;
  const due = p.dueDate?.getTime()??null;
  if (previous.length && delta===0 && (previous[0].dueDate?.getTime()??null)===due) return;
  if (!Number.isSafeInteger(p.amountMinor) || !Number.isSafeInteger(delta)) throw new Error("Financial journal amount exceeds exact integer range");
  await tx.financialEntry.create({data:{...p,amountMinor:BigInt(delta),revision:(previous[0]?.revision??0)+1,actorId}});
}

/** Called inside the same transaction as financial writes; no report GET writes data. */
export async function journalEntity(tx:Tx, entity:string, id:string, actorId:string) {
  if(entity==="Reissue") {
    const r=await tx.reissue.findUniqueOrThrow({where:{id}});
    if(r.reissuedBookingId)await journalEntity(tx,"Booking",r.reissuedBookingId,actorId);
    await journalEntity(tx,"Booking",r.originalBookingId,actorId);
  } else if(entity==="Booking") {
    const b=await tx.booking.findUniqueOrThrow({where:{id}});
    if(b.currency!=="INR")return;
    await postPosition(tx,{partyType:"CUSTOMER",partyId:b.customerId,sourceType:entity,sourceId:id,amountMinor:isWithdrawnBooking(b.status)?0:Math.round(b.sellingPrice*100),reference:b.bookingNo,description:`Booking charge / adjustment · ${b.status}${b.pnr?` · PNR ${b.pnr}`:""}`,dueDate:b.paymentDueDate},actorId);
  } else if(entity==="VisaCase") {
    const c=await tx.visaCase.findUniqueOrThrow({where:{id}});
    await postPosition(tx,{partyType:"CUSTOMER",partyId:c.customerId,sourceType:entity,sourceId:id,amountMinor:Math.round(c.sellingPrice*100),reference:c.caseNo,description:`Visa charge / adjustment · ${c.destination}`,dueDate:c.paymentDueDate},actorId);
  } else if(entity==="Invoice") {
    const i=await tx.invoice.findUniqueOrThrow({where:{id}});
    await postPosition(tx,{partyType:"CUSTOMER",partyId:i.customerId,sourceType:entity,sourceId:id,amountMinor:i.bookingId||i.visaCaseId?0:Math.round(i.amount*100),reference:i.invoiceNo,description:i.description||"Invoice charge / adjustment",dueDate:i.dueDate},actorId);
  } else if(entity==="Payment") {
    const p=await tx.payment.findUniqueOrThrow({where:{id},include:{booking:true,visaCase:true,invoice:true}});
    if(p.booking&&p.booking.currency!=="INR")return;
    await postPosition(tx,{partyType:"CUSTOMER",partyId:p.customerId,sourceType:entity,sourceId:id,amountMinor:-Math.round(p.amount*100),reference:p.receiptNo,description:`Receipt · ${p.mode} · ${p.booking?.bookingNo||p.visaCase?.caseNo||p.invoice?.invoiceNo||"Customer advance"}`},actorId);
  } else if(entity==="Refund") {
    const r=await tx.refund.findUniqueOrThrow({where:{id},include:{booking:true}});
    if(r.booking&&r.booking.currency!=="INR")return;
    await postPosition(tx,{partyType:"CUSTOMER",partyId:r.customerId,sourceType:entity,sourceId:id,amountMinor:r.status==="PAID"?Math.round(r.amount*100):0,reference:r.refundNo,description:`Cash returned to customer${r.booking?` · ${r.booking.bookingNo}`:""}`},actorId);
    if(r.bookingId)await journalEntity(tx,"Booking",r.bookingId,actorId);
  } else if(entity==="SupplierDue") {
    const d=await tx.supplierDue.findUniqueOrThrow({where:{id}});
    await postPosition(tx,{partyType:"SUPPLIER",partyId:d.supplierId,sourceType:entity,sourceId:id,amountMinor:Math.round(d.amount*100),reference:`DUE-${id.slice(-8)}`,description:d.description,dueDate:d.dueDate},actorId);
    await postPosition(tx,{partyType:"SUPPLIER",partyId:d.supplierId,sourceType:"SupplierSettlement",sourceId:id,amountMinor:-Math.round(d.paidAmount*100),reference:`DUE-${id.slice(-8)}`,description:"Supplier settlement / reversal"},actorId);
  }
}
