import type { Prisma } from "@prisma/client";

/** Case history records safe event labels; finance/doc details remain behind their source guards. */
export async function recordCaseEventForEntity(tx:Prisma.TransactionClient,actorId:string|null,action:string,entity:string,id:string) {
  let caseId:string|null=null,reference="",href="",permission="";
  if(entity==="Booking"){const row=await tx.booking.findUnique({where:{id},select:{serviceCaseId:true,bookingNo:true,status:true}});caseId=row?.serviceCaseId??null;reference=row?`${row.bookingNo} · ${row.status.replaceAll("_"," ").toLowerCase()}`:"";href=`/ticketing/${id}`;permission="ticketing:view";}
  else if(entity==="VisaCase"){const row=await tx.visaCase.findUnique({where:{id},select:{serviceCaseId:true,caseNo:true,stage:{select:{name:true}}}});caseId=row?.serviceCaseId??null;reference=row?`${row.caseNo} · ${row.stage.name}`:"";href=`/visa/${id}`;permission="visa:view";}
  else if(entity==="SalesLead"||entity==="SalesQuote"){const row=entity==="SalesLead"?await tx.salesLead.findUnique({where:{id},select:{id:true,serviceCaseId:true}}):(await tx.salesQuote.findUnique({where:{id},select:{lead:{select:{id:true,serviceCaseId:true}}}}))?.lead;caseId=row?.serviceCaseId??null;reference=entity==="SalesQuote"?"Quotation":"Enquiry";href=`/sales?lead=${row?.id}`;permission="customer:view";}
  else {
    let bookingId:string|null=null,visaCaseId:string|null=null;
    if(entity==="Payment"){const row=await tx.payment.findUnique({where:{id}});bookingId=row?.bookingId??null;visaCaseId=row?.visaCaseId??null;if(row?.invoiceId&&!bookingId&&!visaCaseId){const invoice=await tx.invoice.findUnique({where:{id:row.invoiceId}});bookingId=invoice?.bookingId??null;visaCaseId=invoice?.visaCaseId??null;}reference=row?.receiptNo??"Receipt";permission="payment:view";href="/payments";}
    if(entity==="Invoice"){const row=await tx.invoice.findUnique({where:{id}});bookingId=row?.bookingId??null;visaCaseId=row?.visaCaseId??null;reference=row?.invoiceNo??"Invoice";permission="invoice:view";href=`/payments?focus=${id}`;}
    if(entity==="Refund"){const row=await tx.refund.findUnique({where:{id}});bookingId=row?.bookingId??null;reference=row?`${row.refundNo} · ${row.status.toLowerCase()}`:"Refund";permission="refund:view";href=`/refunds?focus=${id}`;}
    if(entity==="Document"){const row=await tx.document.findUnique({where:{id}});visaCaseId=row?.visaCaseId??null;reference=row?`${row.docNo} · ${row.status.toLowerCase()} · ${row.verificationStatus.toLowerCase()}`:"Document";permission="document:view";href=`/documents?focus=${id}`;}
    if(entity==="Task"){const row=await tx.task.findUnique({where:{id}});bookingId=row?.bookingId??null;visaCaseId=row?.visaCaseId??null;reference=row?`Task · ${row.status.toLowerCase()}`:"Task";permission="task:view";href=`/tasks?focus=${id}`;}
    if(entity==="Ticket"){const row=await tx.ticket.findUnique({where:{id}});bookingId=row?.bookingId??null;reference="Ticket";permission="ticketing:view";}
    if(entity==="Reissue"){const row=await tx.reissue.findUnique({where:{id}});bookingId=row?.originalBookingId??null;reference="Reissue";permission="ticketing:view";}
    if(bookingId)caseId=(await tx.booking.findUnique({where:{id:bookingId},select:{serviceCaseId:true}}))?.serviceCaseId??null;
    if(visaCaseId)caseId=(await tx.visaCase.findUnique({where:{id:visaCaseId},select:{serviceCaseId:true}}))?.serviceCaseId??null;
    if(!href&&bookingId)href=`/ticketing/${bookingId}`;
  }
  if(caseId)await tx.serviceCaseEvent.create({data:{caseId,actorId,kind:"RECORD",summary:`${reference}: ${action.replaceAll("_"," ").toLowerCase()}`,permission,href:href||null}});
}
