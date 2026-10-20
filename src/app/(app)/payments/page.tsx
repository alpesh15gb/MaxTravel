import { prisma } from "@/lib/db";
import { requirePage, scopeWhere } from "@/lib/guard";
import { bookingCharge, hasCancellationAllocation, balanceOf, isWithdrawnBooking, netReceived, receivablesFrom } from "@/lib/receivables";
import PaymentsClient from "./PaymentsClient";
import { readInvoiceConfig } from "@/lib/invoice-config";
export const dynamic="force-dynamic";
export default async function PaymentsPage({searchParams:pending}:{searchParams:Promise<{action?:string;customer?:string;invoice?:string;booking?:string;visaCase?:string;focus?:string}>}){
 const searchParams=await pending;
 const user=await requirePage("payment:view");const customer=scopeWhere(user,null,undefined,"assignedToId"),work=scopeWhere(user,null,"ownerId");
 const [invoices,receipts,customers,bookings,cases,invoiceSettings]=await Promise.all([
 prisma.invoice.findMany({where:{customer:{is:customer}},include:{booking:{select:{status:true}},customer:{select:{name:true}},creditNote:{select:{id:true,creditNoteNo:true,amount:true}}},orderBy:{issuedOn:"desc"}}),
 prisma.payment.findMany({where:{customer:{is:customer}},include:{customer:{select:{name:true}},invoice:{select:{invoiceNo:true}},booking:{select:{bookingNo:true}},visaCase:{select:{caseNo:true}}},orderBy:{receivedOn:"desc"},take:100}),
 prisma.customer.findMany({where:customer,select:{id:true,name:true,code:true,companyName:true,gstNumber:true,address:true,city:true},orderBy:{name:"asc"}}),
 prisma.booking.findMany({where:{AND:[work,{customer:{is:customer}}]},include:{payments:{select:{amount:true}},refunds:{select:{amount:true,status:true}}}}),
 prisma.visaCase.findMany({where:{AND:[work,{customer:{is:customer}}]}}),
 prisma.settings.findUnique({where:{key:"invoice.configuration"}}),
 ]);
 // Closed trips stay closed; only explicitly recorded cancellation charges may receive money.
 const collectibleBookings=bookings.filter(b=>b.gdsSource!=="TRIPJACK_API"&&(!isWithdrawnBooking(b.status)||hasCancellationAllocation(b)));
 // Same shared definition the dashboard uses, so both screens agree to the rupee.
 const receivables=receivablesFrom({
  invoices,
  bookings:bookings.map(b=>({status:b.status,sellingPrice:b.sellingPrice,cancellationSupplierCharge:b.cancellationSupplierCharge,cancellationAgencyFee:b.cancellationAgencyFee,received:b.payments.reduce((s,p)=>s+p.amount,0),refunds:b.refunds})),
  visaCases:cases.map(v=>({sellingPrice:v.sellingPrice,received:v.amountReceived})),
 });
 return <PaymentsClient canAudit={user.permissions.includes("audit:view")} invoices={invoices.map(i=>({id:i.id,collectionBlocked:!!i.booking&&isWithdrawnBooking(i.booking.status),invoiceNo:i.invoiceNo,documentKind:i.documentKind,creditNote:i.creditNote,customer:i.customer.name,customerId:i.customerId,bookingId:i.bookingId,visaCaseId:i.visaCaseId,description:i.description,amount:i.amount,amountPaid:i.amountPaid,status:i.status,dueDate:i.dueDate?.toISOString()??null,issuedOn:i.issuedOn.toISOString()}))} receipts={receipts.map(p=>({id:p.id,receiptNo:p.receiptNo,customer:p.customer.name,amount:p.amount,mode:p.mode,receivedOn:p.receivedOn.toISOString(),ref:p.invoice?.invoiceNo??p.booking?.bookingNo??p.visaCase?.caseNo??null}))} customers={customers} invoiceConfig={readInvoiceConfig(invoiceSettings?.value)} work={[...collectibleBookings.map(b=>({id:b.id,kind:"booking" as const,customerId:b.customerId,label:`${b.bookingNo} · ${isWithdrawnBooking(b.status)?"Cancellation charges (trip closed)":b.sector??"Booking"}`,cancellationOnly:isWithdrawnBooking(b.status),balance:balanceOf(bookingCharge(b),netReceived(b.payments.reduce((s,p)=>s+p.amount,0),b.refunds))})),...cases.map(v=>({id:v.id,kind:"visaCase" as const,customerId:v.customerId,label:`${v.caseNo} · ${v.destination}`,balance:v.sellingPrice-v.amountReceived}))]} receivables={receivables} canRecord={user.permissions.includes("payment:record")} canInvoice={user.permissions.includes("invoice:create")} canCredit={user.permissions.includes("invoice:create")&&user.permissions.includes("refund:manage")} canExport={user.permissions.includes("export:data")} preset={{action:searchParams.action??null,customerId:searchParams.customer??null,invoiceId:searchParams.invoice??null,bookingId:searchParams.booking??null,visaCaseId:searchParams.visaCase??null,focus:searchParams.focus??null}}/>;
}
