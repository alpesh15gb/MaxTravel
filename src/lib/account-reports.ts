import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { ApiError, scopeWhere } from "./guard";
import type { SessionUser } from "./session";
import { reportPeriod } from "./reports";
import { bookingCharge, hasCancellationAllocation, isWithdrawnBooking } from "./receivables";

export const ACCOUNT_REPORTS = ["statement","ageing","receipts","supplier-statement","supplier-payables","refunds","cancellations","sales","operations"] as const;
export type AccountReportKey = typeof ACCOUNT_REPORTS[number];
export type ReportRow = Record<string,string|number|null>;
export type AccountReport = {title:string;description:string;period:{from:string;to:string};generatedAt:string;columns:{key:string;label:string;money?:boolean}[];rows:ReportRow[];summary:{label:string;value:number;money?:boolean}[];warnings:string[];party?:{name:string;code:string;address:string|null};agency:string;cutover:string;totalRows:number;page:number;pages:number};
const cents=(n:number)=>Math.round(n*100);
const rupees=(n:number)=>n/100;
const day=(d:Date)=>new Date(d.getTime()+330*60000).toISOString().slice(0,10);
const field=(key:string,label:string,money=false)=>({key,label,money});
const metric=(label:string,minor:number)=>({label,value:rupees(minor),money:true});
const sourceHref=(type:string,id:string,customerId:string)=>type==="Booking"?`/ticketing/${id}`:type==="VisaCase"?`/visa/${id}`:type==="Refund"?`/refunds?focus=${id}`:type==="Invoice"?`/payments?focus=${id}`:`/customers/${customerId}?tab=payments`;

export { accountCustomerScope } from "./report-scope";
import { accountCustomerScope } from "./report-scope";

export async function buildAccountReport(user:SessionUser,params:URLSearchParams,exporting=false):Promise<AccountReport> {
 const key=params.get("report")||"statement";
 if(!(ACCOUNT_REPORTS as readonly string[]).includes(key))throw new ApiError(400,"Choose a valid report.");
 if(key.startsWith("supplier")&&(!user.permissions.includes("supplier:view")||user.accessMode!=="ALL"))throw new ApiError(403,"Supplier financial reports require supplier visibility and agency-wide finance access.");
 if(key==="refunds"&&!user.permissions.includes("refund:view"))throw new ApiError(403,"Refund visibility is required.");
 const rawPage=params.get("page")||"1";
 if(!/^\d+$/.test(rawPage)||Number(rawPage)<1||!Number.isSafeInteger(Number(rawPage)))throw new ApiError(400,"Choose a valid page.");
 const requestedPage=Number(rawPage);
 return prisma.$transaction(async tx=>{
  const cutoverSetting=await tx.settings.findUnique({where:{key:"financialJournal.cutover"}});
  if(!cutoverSetting)throw new ApiError(503,"Financial journal migration is required before reporting.");
  const cutover=new Date(cutoverSetting.value);
  const dateParams=new URLSearchParams(params);
  if(["statement","supplier-statement"].includes(key)&&!dateParams.get("from"))dateParams.set("from",day(cutover)>day(new Date()).slice(0,7)+"-01"?day(cutover):day(new Date()).slice(0,7)+"-01");
  const period=reportPeriod(dateParams);
  if(["statement","supplier-statement","ageing","supplier-payables"].includes(key)&&period.to<day(cutover))throw new ApiError(400,`Historical balances are available from ${day(cutover)} only.`);
  if(["statement","supplier-statement"].includes(key)&&period.from<day(cutover))throw new ApiError(400,`Statements begin on ${day(cutover)}. Earlier transactions are represented by the migration opening balance.`);
  const today=day(new Date());
  if(period.to>today)throw new ApiError(400,"Report end date cannot be in the future.");
  const customers=await tx.customer.findMany({where:accountCustomerScope(user),select:{id:true,name:true,code:true,address:true},orderBy:{name:"asc"}});
  const customerIds=customers.map(c=>c.id);
  const byCustomer=new Map(customers.map(c=>[c.id,c]));
  const customerId=params.get("customerId")||null;
  if(customerId&&!byCustomer.has(customerId))throw new ApiError(404,"Customer account not available in your scope.");
  const selectedIds=customerId?[customerId]:customerIds;
  const ownerId=params.get("ownerId")||undefined,status=params.get("status")||undefined;
  if((ownerId||status)&&!["sales","operations","cancellations"].includes(key))throw new ApiError(400,"Staff and status filters apply to sales, cancellation and work reports only.");
  const bookingFilters={...(ownerId?{ownerId}:{}),...(status?{status}:{})};
  const visaFilters={...(ownerId?{ownerId}:{}),...(status?{stage:{name:status}}:{})};
  const agency=(await tx.settings.findUnique({where:{key:"agency.name"}}))?.value||"Max Travel CRM";
  const warnings=[key==="operations"?"Operational records include all currencies; no monetary totals are presented.":"INR only. Other-currency bookings and their receipts/refunds are excluded."];
  if(user.accessMode!=="ALL")warnings.push("Only complete customer accounts wholly within your record scope are included.");
  const result:AccountReport={title:"",description:"",period:{from:period.from,to:period.to},generatedAt:new Date().toISOString(),columns:[],rows:[],summary:[],warnings,agency,cutover:cutover.toISOString(),totalRows:0,page:1,pages:1};
  const range={gte:period.start,lt:period.end};
  if(key==="statement"||key==="supplier-statement") {
   const supplier=key==="supplier-statement";
   let partyId=customerId;
   if(supplier){partyId=params.get("supplierId");if(!partyId)throw new ApiError(400,"Choose a supplier.");const s=await tx.supplier.findUnique({where:{id:partyId}});if(!s)throw new ApiError(404,"Supplier not found.");result.party={name:s.name,code:"Supplier",address:null};}
   else {if(!partyId)throw new ApiError(400,"Choose a customer.");result.party=byCustomer.get(partyId);}
   const entries=await tx.financialEntry.findMany({where:{partyType:supplier?"SUPPLIER":"CUSTOMER",partyId:partyId!,effectiveAt:{lt:period.end}},orderBy:[{effectiveAt:"asc"},{recordedAt:"asc"},{id:"asc"}]});
   // Cutover sources are a brought-forward position, not invented dated sales/receipts.
   const opening=entries.filter(e=>e.opening||e.effectiveAt<period.start).reduce((s,e)=>s+Number(e.amountMinor),0);
   let balance=opening,debits=0,credits=0;
   result.rows=entries.filter(e=>!e.opening&&e.effectiveAt>=period.start&&Number(e.amountMinor)!==0).map(e=>{const amount=Number(e.amountMinor);balance+=amount;debits+=Math.max(0,amount);credits+=Math.max(0,-amount);return{date:day(e.effectiveAt),reference:e.reference,description:e.description,debit:rupees(Math.max(0,amount)),credit:rupees(Math.max(0,-amount)),balance:rupees(balance),_href:supplier?"/suppliers":sourceHref(e.sourceType,e.sourceId,e.partyId)};});
   result.title=supplier?"Supplier statement":"Customer statement";
   result.description=supplier?"Positive balance is payable to the supplier. Negative balance is supplier credit.":"Positive balance is owed by the customer. Negative balance is customer credit held by the agency.";
   result.columns=[field("date","Date"),field("reference","Reference"),field("description","Description"),field("debit",supplier?"Bill / reversal":"Charge / cash returned",true),field("credit",supplier?"Settlement / credit":"Receipt / charge credit",true),field("balance","Running balance",true)];
   result.summary=[metric("Opening balance",opening),metric("Period debits",debits),metric("Period credits",credits),metric("Closing balance",balance)];
   warnings.push(`Preserved history begins ${day(cutover)}. Earlier records are included only in the opening balance. Adjustments are posted when recorded; opening plus debits minus credits equals closing.`);
   if(!supplier){const pending=await tx.refund.aggregate({where:{customerId:partyId!,status:{notIn:["PAID","REJECTED"]},OR:[{bookingId:null},{booking:{currency:"INR"}}]},_sum:{amount:true}});result.summary.push(metric("Pending refunds now (separate)",cents(pending._sum.amount||0)));warnings.push("Pending refunds are current workflow amounts, not historical cash. Quotes/enquiries remain operational charges under existing app policy. Cancellation credits can differ from clamped outstanding balances.");}
  } else if(key==="ageing"||key==="supplier-payables") {
   const supplier=key==="supplier-payables";
   const entries=await tx.financialEntry.findMany({where:{partyType:supplier?"SUPPLIER":"CUSTOMER",...(!supplier?{partyId:{in:selectedIds}}:{}),effectiveAt:{lt:period.end}},orderBy:[{effectiveAt:"asc"},{revision:"asc"}]});
   const suppliers=supplier?await tx.supplier.findMany({select:{id:true,name:true}}):[];
   const names=new Map(suppliers.map(s=>[s.id,s.name]));
   const balances=new Map<string,{partyId:string;type:string;id:string;reference:string;amount:number;due:Date|null}>();
   for(const e of entries){const k=`${e.sourceType}:${e.sourceId}`;const prior=balances.get(k);balances.set(k,{partyId:e.partyId,type:e.sourceType,id:e.sourceId,reference:e.reference,amount:(prior?.amount||0)+Number(e.amountMinor),due:e.dueDate});}
   // Receipt/refund allocations are immutable in this app; journal limits them by the cutoff.
   const payments=!supplier?await tx.payment.findMany({where:{id:{in:[...balances.values()].filter(b=>b.type==="Payment").map(b=>b.id)}}}):[];
   const refunds=!supplier?await tx.refund.findMany({where:{id:{in:[...balances.values()].filter(b=>b.type==="Refund").map(b=>b.id)}}}):[];
   const creditNotes=!supplier?await tx.invoiceCreditNote.findMany({where:{id:{in:[...balances.values()].filter(b=>b.type==="InvoiceCreditNote").map(b=>b.id)}},select:{id:true,invoiceId:true}}):[];
   for(const note of creditNotes){const invoice=balances.get(`Invoice:${note.invoiceId}`),credit=balances.get(`InvoiceCreditNote:${note.id}`);if(invoice&&credit)invoice.amount+=credit.amount;}
   let unallocated=0;
   for(const p of payments){const value=balances.get(`Payment:${p.id}`)?.amount||0;const target=p.bookingId?`Booking:${p.bookingId}`:p.visaCaseId?`VisaCase:${p.visaCaseId}`:p.invoiceId?`Invoice:${p.invoiceId}`:null;const b=target?balances.get(target):undefined;if(b)b.amount+=value;else unallocated+=value;}
   for(const r of refunds){const value=balances.get(`Refund:${r.id}`)?.amount||0;const target=r.bookingId?`Booking:${r.bookingId}`:r.invoiceId?`Invoice:${r.invoiceId}`:null;const b=target?balances.get(target):undefined;if(b)b.amount+=value;else unallocated+=value;}
   if(supplier)for(const b of balances.values())if(b.type==="SupplierSettlement"){const target=balances.get(`SupplierDue:${b.id}`);if(target)target.amount+=b.amount;}
   const totals=[0,0,0,0,0,0];let credit=-Math.min(0,unallocated);
   for(const b of balances.values()){
    if(!["Booking","VisaCase","Invoice","SupplierDue"].includes(b.type))continue;
    if(b.amount<0){credit-=b.amount;continue;}if(!b.amount)continue;
    const days=b.due?Math.max(0,Math.floor((new Date(`${period.to}T00:00:00+05:30`).getTime()-new Date(`${day(b.due)}T00:00:00+05:30`).getTime())/86400000)):null;
    const bucket=days===null?5:days===0?0:days<=30?1:days<=60?2:days<=90?3:4;
    totals[bucket]+=b.amount;
    result.rows.push({customer:supplier?names.get(b.partyId)||"Supplier":byCustomer.get(b.partyId)?.name||"Customer",reference:b.reference,service:b.type,due:b.due?day(b.due):"No due date",age:days===null?"No due date":days===0?"Not overdue":`${days} days overdue`,bucket:["Not due","1–30","31–60","61–90","90+","No due date"][bucket],outstanding:rupees(b.amount),_type:b.type,_id:b.id,_href:supplier?"/suppliers":sourceHref(b.type,b.id,b.partyId),_customerHref:supplier?"/suppliers":`/reports?report=statement&customerId=${b.partyId}`});
   }
   result.rows.sort((a,b)=>Number(b.outstanding)-Number(a.outstanding));
   result.title=supplier?"Supplier payables and ageing":"Customer outstanding and ageing";
   result.description=`Open obligations as of ${period.to}; unallocated credits are disclosed separately, not silently offset against other debts.`;
   result.columns=[field("customer",supplier?"Supplier":"Customer"),field("reference","Reference"),field("service","Service"),field("due","Due date"),field("age","Age"),field("bucket","Bucket"),field("outstanding","Outstanding",true)];
   result.summary=[metric("Total open obligations",totals.reduce((s,n)=>s+n,0)),...totals.map((n,i)=>metric(["Not due","Overdue 1–30","Overdue 31–60","Overdue 61–90","Overdue 90+","No due date"][i],n)),metric("Credits / unapplied receipts",credit)];
   warnings.push("Set explicit payment terms on bookings and visa cases to include them in overdue buckets. Missing dates remain unclassified. Linked invoice dates do not automatically apply to the entire work charge.");
  } else if(key==="receipts") {
   const [payments,refunds]=await Promise.all([tx.payment.findMany({where:{customerId:{in:selectedIds},receivedOn:range,OR:[{bookingId:null},{booking:{currency:"INR"}}]},include:{booking:true,visaCase:true,invoice:true},orderBy:{receivedOn:"asc"}}),tx.refund.findMany({where:{customerId:{in:selectedIds},status:"PAID",paidOn:range,OR:[{bookingId:null},{booking:{currency:"INR"}}]},orderBy:{paidOn:"asc"}})]);
   result.title="Receipt and refund register";result.description="Recorded customer cash movements; this app does not transfer funds. Supplier payments and overheads are not included.";
   result.rows=[...payments.map(p=>({date:day(p.receivedOn),reference:p.receiptNo,customer:byCustomer.get(p.customerId)!.name,type:"Receipt",method:p.mode,allocation:p.booking?.bookingNo||p.visaCase?.caseNo||p.invoice?.invoiceNo||"Unallocated advance",received:p.amount,returned:0,_href:`/customers/${p.customerId}?tab=payments`,_customerHref:`/reports?report=statement&customerId=${p.customerId}`})),...refunds.map(r=>({date:day(r.paidOn!),reference:r.refundNo,customer:byCustomer.get(r.customerId)!.name,type:"Paid refund",method:"Not recorded",allocation:"Refund",received:0,returned:r.amount,_href:`/refunds?focus=${r.id}`,_customerHref:`/reports?report=statement&customerId=${r.customerId}`}))].sort((a,b)=>a.date.localeCompare(b.date)||a.reference.localeCompare(b.reference));
   const received=payments.reduce((s,p)=>s+cents(p.amount),0),returned=refunds.reduce((s,r)=>s+cents(r.amount),0);
   result.summary=[metric("Receipts",received),metric("Paid refunds",returned),metric("Net customer collections",received-returned)];
   result.columns=[field("date","Date"),field("reference","Reference"),field("customer","Customer"),field("type","Type"),field("method","Method"),field("allocation","Allocation"),field("received","Received",true),field("returned","Returned",true)];
  } else if(key==="refunds") {
   const refunds=await tx.refund.findMany({where:{customerId:{in:selectedIds},requestedOn:range,OR:[{bookingId:null},{booking:{currency:"INR"}}]},include:{booking:{include:{supplier:true}}},orderBy:{requestedOn:"asc"}});
   result.title="Refund exposure";result.description="Refunds requested in the selected period, with their current workflow status. Supplier recovery is a milestone, not a verified settlement amount.";
   result.rows=refunds.map(r=>({date:day(r.requestedOn),reference:r.refundNo,customer:byCustomer.get(r.customerId)!.name,booking:r.booking?.bookingNo||"—",supplier:r.booking?.supplier?.name||"Not recorded",status:r.status,requested:r.amount,pending:["PAID","REJECTED"].includes(r.status)?0:r.amount,paid:r.status==="PAID"?r.amount:0,supplierReceived:r.supplierReceivedOn?day(r.supplierReceivedOn):"Not recorded",_href:`/refunds?focus=${r.id}`,_customerHref:`/reports?report=statement&customerId=${r.customerId}`}));
   result.summary=[metric("Requested",refunds.reduce((s,r)=>s+cents(r.amount),0)),metric("Pending now",refunds.filter(r=>!["PAID","REJECTED"].includes(r.status)).reduce((s,r)=>s+cents(r.amount),0)),metric("Paid now",refunds.filter(r=>r.status==="PAID").reduce((s,r)=>s+cents(r.amount),0))];
   result.columns=[field("date","Requested"),field("reference","Refund"),field("customer","Customer"),field("booking","Booking"),field("supplier","Supplier"),field("status","Current status"),field("requested","Requested",true),field("pending","Pending",true),field("paid","Paid",true),field("supplierReceived","Supplier milestone")];
   warnings.push("A supplier-received timestamp does not establish how much was recovered. Partial recovery amounts require a future recovery transaction workflow.");
  } else if(key==="cancellations") {
   const work=scopeWhere(user,null,"ownerId");
   const base={AND:[work,{customerId:{in:selectedIds},currency:"INR",status:{in:["CANCELLED","VOID","REFUNDED"]}},bookingFilters]};
   const [bookings,undated]=await Promise.all([tx.booking.findMany({where:{AND:[base,{cancelledAt:range}]},include:{owner:true,payments:true,refunds:true,supplier:true},orderBy:[{cancelledAt:"asc"},{bookingNo:"asc"}]}),tx.booking.count({where:{AND:[base,{cancelledAt:null}]}})]);
   let gross=0,cost=0,fee=0,received=0,returned=0,unknown=0;
   result.title="Cancellation register";result.description="Cancellation-date cohort, including bookings originally sold in earlier periods. Current recorded allocations and lifetime cash against those bookings; not period cash flow or recognized accounting revenue.";
   result.rows=bookings.map(b=>{const known=hasCancellationAllocation(b),charge=bookingCharge(b),cashIn=b.payments.reduce((n,p)=>n+cents(p.amount),0),cashOut=b.refunds.filter(r=>r.status==="PAID").reduce((n,r)=>n+cents(r.amount),0);if(known){gross+=cents(charge);cost+=cents(b.cancellationSupplierCharge!);fee+=cents(b.cancellationAgencyFee!);}else unknown++;received+=cashIn;returned+=cashOut;return{date:day(b.cancelledAt!),booked:day(b.bookingDate),reference:b.bookingNo,customer:byCustomer.get(b.customerId)!.name,status:b.status,staff:b.owner.name,supplier:b.supplier?.name||"Not recorded",gross:known?charge:null,cost:known?b.cancellationSupplierCharge:null,fee:known?b.cancellationAgencyFee:null,received:rupees(cashIn),returned:rupees(cashOut),netCash:rupees(cashIn-cashOut),balance:rupees(cents(charge)-cashIn+cashOut),coverage:known?"Allocation recorded":"Legacy allocation unknown",_href:`/ticketing/${b.id}`,_customerHref:`/reports?report=statement&customerId=${b.customerId}`};});
   result.columns=[field("date","Cancelled"),field("booked","Booked"),field("reference","Booking"),field("customer","Customer"),field("status","Status"),field("staff","Owner"),field("supplier","Supplier"),field("gross","Gross retained charge",true),field("cost","Supplier cancellation charge",true),field("fee","Agency fee / margin",true),field("received","Lifetime receipts",true),field("returned","Paid refunds",true),field("netCash","Net cash retained",true),field("balance","Customer balance",true),field("coverage","Coverage")];
   result.summary=[metric("Recorded cancellation charges",gross),metric("Recorded supplier charges",cost),metric("Recorded agency fee margin",fee),metric("Lifetime receipts for cohort",received),metric("Paid refunds for cohort",returned),metric("Net cash retained for cohort",received-returned),{label:"Unknown allocations in period",value:unknown},{label:"Undated legacy cancellations (outside date filter)",value:undated}];
   warnings.push("Positive customer balance is still owed; negative balance is customer credit to resolve. Pending refunds are not paid cash. Legacy null allocations retain the prior zero-charge account treatment, but no cost or profit is inferred. Undated legacy cancellations cannot be assigned to an event period; inspect Sales & margin for their booking-date cohort. Supplier charges are allocations only: reconcile supplier dues and recovery separately; no supplier receipt or settlement is inferred.");
  } else if(key==="sales") {
   const work=scopeWhere(user,null,"ownerId") as Prisma.BookingWhereInput;
   const [bookings,cases]=await Promise.all([tx.booking.findMany({where:{AND:[work,{customerId:{in:selectedIds},currency:"INR",bookingDate:range,...bookingFilters}]},include:{supplier:true,owner:true}}),tx.visaCase.findMany({where:{AND:[scopeWhere(user,null,"ownerId"),{customerId:{in:selectedIds},createdAt:range,...visaFilters}]},include:{stage:true,owner:true}})]);
   result.title="Sales and cost coverage";result.description="Current status and prices of work created/booked in the period. This is operational sales value, not recognized accounting revenue or historical profit.";
   let confirmed=0,pipeline=0,costed=0,margin=0,cancellationSales=0,cancellationMargin=0,unknownCancellations=0;
   result.rows=[...bookings.map(b=>{
    const withdrawn=isWithdrawnBooking(b.status),allocated=hasCancellationAllocation(b),quoted=["ENQUIRY","QUOTE_SENT"].includes(b.status);
    const charge=bookingCharge(b),known=withdrawn?allocated:b.supplierCost>0;
    if(withdrawn){if(allocated){cancellationSales+=cents(charge);cancellationMargin+=cents(b.cancellationAgencyFee!);}else unknownCancellations++;}
    else if(quoted)pipeline+=cents(charge);else {confirmed+=cents(charge);if(known){costed++;margin+=cents(charge)-cents(b.supplierCost);}}
    return{date:day(b.bookingDate),reference:b.bookingNo,customer:byCustomer.get(b.customerId)!.name,service:"Ticketing",status:b.status,staff:b.owner.name,supplier:b.supplier?.name||"Not recorded",sales:withdrawn&&!allocated?null:charge,cost:known?(withdrawn?b.cancellationSupplierCharge:b.supplierCost):null,margin:!quoted&&known?(withdrawn?b.cancellationAgencyFee:rupees(cents(charge)-cents(b.supplierCost))):null,_href:`/ticketing/${b.id}`,_customerHref:`/reports?report=statement&customerId=${b.customerId}`,coverage:withdrawn?(allocated?"Cancellation allocation recorded":"Legacy cancellation — allocation unknown"):quoted?"Pipeline":known?"Cost recorded":"Missing cost"};
   }),...cases.map(c=>({date:day(c.createdAt),reference:c.caseNo,customer:byCustomer.get(c.customerId)!.name,service:"Visa",status:c.stage.name,staff:c.owner.name,supplier:"—",sales:c.sellingPrice,cost:null,margin:null,coverage:"Visa cost not recorded",_href:`/visa/${c.id}`,_customerHref:`/reports?report=statement&customerId=${c.customerId}`}))];
   result.summary=[metric("Confirmed booking value",confirmed),metric("Quoted / enquiry value",pipeline),metric("Visa work value",cases.reduce((s,c)=>s+cents(c.sellingPrice),0)),metric("Cancellation charges",cancellationSales),metric("Costed confirmed booking margin",margin),metric("Cancellation agency fee margin",cancellationMargin),{label:"Costed confirmed bookings",value:costed},{label:"Unknown legacy cancellation allocations",value:unknownCancellations}];
   result.columns=[field("date","Date"),field("reference","Reference"),field("customer","Customer"),field("service","Service"),field("status","Current status"),field("staff","Owner"),field("supplier","Supplier"),field("sales","Sales value",true),field("cost","Supplier cost",true),field("margin","Gross margin",true),field("coverage","Coverage")];
   warnings.push("Active-booking margin excludes enquiries, quotes, visa work, refunds, overheads and uncosted bookings. For explicitly allocated cancellations, sales are supplier penalty plus agency fee, cost is supplier penalty, and margin is agency fee. Legacy withdrawals with unknown allocations are shown as not recorded, never invented as profit. Cancellation figures describe the current booking-date cohort, not revenue recognized on cancellation date. Supplier liabilities and recovery settlements are separate and require explicit reconciliation. This is not net profit. Standalone invoices are shown in statements, not this work-sales register.");
  } else {
   const [cases,bookings]=await Promise.all([tx.visaCase.findMany({where:{AND:[scopeWhere(user,null,"ownerId"),{customerId:{in:selectedIds},createdAt:range,...visaFilters}]},include:{stage:true,owner:true}}),tx.booking.findMany({where:{AND:[scopeWhere(user,null,"ownerId"),{customerId:{in:selectedIds},bookingDate:range,...bookingFilters}]},include:{owner:true}})]);
   result.title="Work and travel register";result.description="Work opened/booked in the selected period; current stage, owner and travel/deadline dates. Not historical stage ageing.";
   result.rows=[...cases.map(c=>({reference:c.caseNo,customer:byCustomer.get(c.customerId)!.name,service:"Visa",status:c.stage.name,owner:c.owner.name,travel:c.travelDate?day(c.travelDate):"Not set",deadline:c.expectedDecisionDate?day(c.expectedDecisionDate):"Not set",_href:`/visa/${c.id}`})),...bookings.map(b=>({reference:b.bookingNo,customer:byCustomer.get(b.customerId)!.name,service:"Ticketing",status:b.status,owner:b.owner.name,travel:b.travelDate?day(b.travelDate):"Not set",deadline:b.ticketingDeadline?day(b.ticketingDeadline):"Not set",_href:`/ticketing/${b.id}`}))];
   result.columns=[field("reference","Reference"),field("customer","Customer"),field("service","Service"),field("status","Current stage/status"),field("owner","Owner"),field("travel","Travel date"),field("deadline","Decision / ticketing deadline")];result.summary=[{label:"Visa cases",value:cases.length},{label:"Bookings",value:bookings.length}];
  }
  if(["sales","operations"].includes(key))result.rows.sort((a,b)=>String(a.date??"").localeCompare(String(b.date??""))||String(a.reference).localeCompare(String(b.reference)));
  if(ownerId)warnings.push(`Staff filter: ${[...new Set(result.rows.map(r=>r.staff||r.owner).filter(Boolean))].join(", ")||"No matching permitted work"} (${ownerId}).`);
  if(status)warnings.push(`Current status / stage filter: ${status}.`);
  result.totalRows=result.rows.length;result.pages=Math.max(1,Math.ceil(result.totalRows/50));result.page=Math.min(requestedPage,result.pages);
  if(!exporting)result.rows=result.rows.slice((result.page-1)*50,result.page*50);
  return result;
 },{timeout:30000});
}
