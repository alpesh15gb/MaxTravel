import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
if(!process.env.DATABASE_URL&&existsSync(".env")&&process.loadEnvFile)process.loadEnvFile();
if(!process.env.DATABASE_URL)throw new Error("Set DATABASE_URL for the database to verify.");
const db=new PrismaClient();
try{
 const result=await db.$transaction(async tx=>{
  const cutover=await tx.settings.findUnique({where:{key:"financialJournal.cutover"}});
  if(!cutover)throw new Error("Apply the financial journal migration first.");
  const [entries,bookings,cases,invoices,payments,refunds,dues,creditNotes]=await Promise.all([tx.financialEntry.findMany(),tx.booking.findMany(),tx.visaCase.findMany(),tx.invoice.findMany(),tx.payment.findMany(),tx.refund.findMany(),tx.supplierDue.findMany(),tx.invoiceCreditNote.findMany()]);
  const totals=new Map();for(const e of entries){const key=`${e.sourceType}:${e.sourceId}`;totals.set(key,(totals.get(key)||0n)+e.amountMinor);}
  const supported=new Set(bookings.filter(b=>b.currency==="INR").map(b=>b.id));
  const expected=[];const minor=n=>BigInt(Math.round(n*100));
  for(const b of bookings)if(supported.has(b.id))expected.push(["Booking",b.id,b.bookingNo,["CANCELLED","VOID","REFUNDED"].includes(b.status)?(b.cancellationSupplierCharge!=null&&b.cancellationAgencyFee!=null?minor(b.cancellationSupplierCharge+b.cancellationAgencyFee):0n):minor(b.sellingPrice)]);
  for(const c of cases)expected.push(["VisaCase",c.id,c.caseNo,minor(c.sellingPrice)]);
  for(const i of invoices)expected.push(["Invoice",i.id,i.invoiceNo,i.bookingId||i.visaCaseId?0n:minor(i.amount)]);
  for(const c of creditNotes)expected.push(["InvoiceCreditNote",c.id,c.creditNoteNo,-minor(c.amount)]);
  for(const p of payments)if(!p.bookingId||supported.has(p.bookingId))expected.push(["Payment",p.id,p.receiptNo,-minor(p.amount)]);
  for(const r of refunds)if(!r.bookingId||supported.has(r.bookingId))expected.push(["Refund",r.id,r.refundNo,r.status==="PAID"?minor(r.amount):0n]);
  for(const d of dues){expected.push(["SupplierDue",d.id,`DUE-${d.id.slice(-8)}`,minor(d.amount)]);expected.push(["SupplierSettlement",d.id,`DUE-${d.id.slice(-8)}`,-minor(d.paidAmount)]);}
  const mismatches=[];for(const [type,id,reference,amount] of expected){const key=`${type}:${id}`;if((totals.get(key)||0n)!==amount)mismatches.push(`${type} ${reference}: journal ${totals.get(key)||0n} vs source ${amount} paise`);totals.delete(key);}
  for(const [key,value] of totals)if(value!==0n)mismatches.push(`Orphan journal source ${key}`);
  return {checked:expected.length,cutover:cutover.value,mismatches};
 },{timeout:30000});
 console.log(`Reporting reconciliation: ${result.checked} source positions; cutoff ${result.cutover}; ${result.mismatches.length} differences.`);
 for(const issue of result.mismatches)console.error(issue);
 if(result.mismatches.length)process.exitCode=1;
}finally{await db.$disconnect();}
