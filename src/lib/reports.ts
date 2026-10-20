import { prisma } from "./db";
import { accountCustomerScope } from "./report-scope";
import { ApiError, scopeWhere } from "./guard";
import type { SessionUser } from "./session";
import { balanceOf, bookingCharge, hasCancellationAllocation, isWithdrawnBooking, netReceived, receivablesFrom, round2 } from "./receivables";

// Report days use the agency's Indian business calendar, including the entire final day.
export function reportPeriod(params: URLSearchParams, now = new Date()) {
  const today = new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
  const from = params.get("from") || today.slice(0, 7) + "-01";
  const to = params.get("to") || today;
  for (const day of [from, to]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day)
      throw new ApiError(400, "Choose valid report dates.");
  }
  const start = new Date(from + "T00:00:00+05:30");
  const end = new Date(new Date(to + "T00:00:00+05:30").getTime() + 86400000);
  if (start >= end || end.getTime() - start.getTime() > 366 * 86400000)
    throw new ApiError(400, "Choose a date range of up to 366 days, with the start before the end.");
  return { from, to, start, end };
}

export async function buildReport(user: SessionUser, params: URLSearchParams) {
  const period = reportPeriod(params);
  const customerScope = accountCustomerScope(user);
  const workScope = scopeWhere(user, null, "ownerId");
  const work = { AND: [workScope, { customer: { is: customerScope } }] };
  const dates = { gte: period.start, lt: period.end };
  // One transaction gives every card and table the same database snapshot.
  const [bookings, cases, invoices, payments, refunds, tasks] = await prisma.$transaction([
    prisma.booking.findMany({ where: work, select: { id:true, bookingNo:true, status:true, sellingPrice:true, supplierCost:true, cancellationSupplierCharge:true, cancellationAgencyFee:true, currency:true, bookingDate:true, customer:{select:{name:true}}, payments:{select:{amount:true}}, refunds:{select:{amount:true,status:true}} } }),
    prisma.visaCase.findMany({ where: work, select: { id:true, caseNo:true, createdAt:true, destination:true, sellingPrice:true, amountReceived:true, stage:{select:{name:true}}, customer:{select:{name:true}} } }),
    prisma.invoice.findMany({ where: { customer:{is:customerScope} }, select: { invoiceNo:true, bookingId:true, visaCaseId:true, amount:true, amountPaid:true, status:true, issuedOn:true, dueDate:true, customer:{select:{name:true}} } }),
    prisma.payment.findMany({ where: { customer:{is:customerScope}, receivedOn:dates, OR:[{bookingId:null},{booking:{currency:"INR"}}] }, select:{ amount:true, mode:true, receivedOn:true } }),
    prisma.refund.findMany({ where: { customer:{is:customerScope}, status:"PAID", paidOn:dates, OR:[{bookingId:null},{booking:{currency:"INR"}}] }, select:{amount:true} }),
    prisma.task.findMany({ where:{...workScope, ...(!user.permissions.includes("task:view")?{id:"__none__"}:{}), createdAt:dates}, select:{status:true} }),
  ]);
  const inPeriod = (date: Date) => date >= period.start && date < period.end;
  const inrBookings = bookings.filter(b => b.currency === "INR");
  const periodBookings = inrBookings.filter(b => inPeriod(b.bookingDate));
  const periodCases = cases.filter(c => inPeriod(c.createdAt));
  const standalone = invoices.filter(i => !i.bookingId && !i.visaCaseId && i.status !== "CREDITED" && inPeriod(i.issuedOn));
  const sum = (values: number[]) => values.reduce((s, n) => s + Math.round(n * 100), 0) / 100;
  const receivables = receivablesFrom({ invoices, bookings:inrBookings.map(b => ({ ...b, received:sum(b.payments.map(p=>p.amount)) })), visaCases:cases.map(c => ({sellingPrice:c.sellingPrice,received:c.amountReceived})) });
  const sales = sum([...periodBookings.map(b=>bookingCharge(b)), ...periodCases.map(c=>c.sellingPrice), ...standalone.map(i=>i.amount)]);
  const collected = sum(payments.map(p=>p.amount));
  const returned = sum(refunds.map(r=>r.amount));
  const confirmed = periodBookings.filter(b=>!["ENQUIRY","QUOTE_SENT"].includes(b.status));
  const costed = confirmed.filter(b=>isWithdrawnBooking(b.status)?hasCancellationAllocation(b):b.supplierCost>0);
  const unknownCancellations=periodBookings.filter(b=>isWithdrawnBooking(b.status)&&!hasCancellationAllocation(b)).length;
  const trend = new Map<string, {month:string;sales:number;collections:number}>();
  for (let d = new Date(period.start.getTime()+330*60000); d.toISOString().slice(0,7) <= period.to.slice(0,7); d = new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1))) {
    const month=d.toISOString().slice(0,7); trend.set(month,{month,sales:0,collections:0});
  }
  const add = (date:Date, key:"sales"|"collections", amount:number) => { const row=trend.get(new Date(date.getTime()+330*60000).toISOString().slice(0,7)); if(row)row[key]=round2(row[key]+amount); };
  periodBookings.forEach(b=>add(b.bookingDate,"sales",bookingCharge(b)));
  periodCases.forEach(c=>add(c.createdAt,"sales",c.sellingPrice));
  standalone.forEach(i=>add(i.issuedOn,"sales",i.amount));
  payments.forEach(p=>add(p.receivedOn,"collections",p.amount));
  const pipeline = new Map<string,number>();
  bookings.filter(b=>inPeriod(b.bookingDate)).forEach(b=>pipeline.set(b.status,(pipeline.get(b.status)||0)+1));
  const visaStages = new Map<string,number>();
  periodCases.forEach(c=>visaStages.set(c.stage.name,(visaStages.get(c.stage.name)||0)+1));
  const modes = new Map<string,number>();
  const taskStatuses = new Map<string,number>();
  tasks.forEach(t=>taskStatuses.set(t.status,(taskStatuses.get(t.status)||0)+1));
  payments.forEach(p=>modes.set(p.mode,round2((modes.get(p.mode)||0)+p.amount)));
  const outstanding = [
    ...inrBookings.map(b=>({reference:b.bookingNo,customer:b.customer.name,type:"Booking",amount:balanceOf(bookingCharge(b),netReceived(sum(b.payments.map(p=>p.amount)),b.refunds)),href:"/ticketing/"+b.id})),
    ...cases.map(c=>({reference:c.caseNo,customer:c.customer.name,type:"Visa case",amount:balanceOf(c.sellingPrice,c.amountReceived),href:"/visa/"+c.id})),
    ...invoices.filter(i=>!i.bookingId&&!i.visaCaseId&&i.status!=="PAID"&&i.status!=="CREDITED").map(i=>({reference:i.invoiceNo,customer:i.customer.name,type:"Invoice",amount:balanceOf(i.amount,i.amountPaid),href:"/payments"})),
  ].filter(r=>r.amount>0).sort((a,b)=>b.amount-a.amount);
  return {period:{from:period.from,to:period.to},generatedAt:new Date().toISOString(),sales,collected,returned,netCollections:round2(collected-returned),receivables,
    margin:sum(costed.map(b=>isWithdrawnBooking(b.status)?b.cancellationAgencyFee!:round2(b.sellingPrice-b.supplierCost))),uncosted:confirmed.filter(b=>!isWithdrawnBooking(b.status)&&b.supplierCost<=0).length,unknownCancellations,
    excludedCurrency:bookings.filter(b=>b.currency!=="INR").length,
    bookings:periodBookings.length,visaCases:periodCases.length,trend:[...trend.values()],pipeline:[...pipeline].map(([label,value])=>({label,value})),visaStages:[...visaStages].map(([label,value])=>({label,value})),modes:[...modes].map(([label,value])=>({label,value})),
    tasks:[...taskStatuses].map(([label,value])=>({label,value})),outstanding:outstanding.slice(0,100),outstandingCount:outstanding.length };
}
export type AgencyReport = Awaited<ReturnType<typeof buildReport>>;
