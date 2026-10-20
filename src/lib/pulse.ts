import { enumLabel } from "@/lib/labels";
import { dateTimeLabel } from "@/lib/dates";
import { inrAmount } from "@/lib/money";
import type { PrismaClient } from "@prisma/client";
import type { SessionUser } from "./session";
import type { Permission } from "./permissions";
import { scopeWhere } from "./guard";
import { bookingCharge, hasCancellationAllocation, isWithdrawnBooking, balanceOf, netReceived, receivablesFrom, receivablesNote } from "./receivables";
export type PulseSeverity = "URGENT" | "HIGH" | "MEDIUM";
export interface PulseAction { label:string;api?:string;method?:string;body?:Record<string,unknown>;href?:string }
export interface PulseItem { id:string;kind:string;severity:PulseSeverity;title:string;detail:string;href:string;actions:PulseAction[];at?:string }
const H=3600000;
// How many items of one kind the dashboard list carries. This list is a prompt to act, not a report,
// and each kind links to the page that holds every record — but the earlier version loaded every
// document and task the user could see on every dashboard view, which grows without limit. One row
// beyond the limit is fetched per query so the response can say whether it was actually capped
// rather than inferring it from an exact count.
const ITEM_LIMIT=50;
const money=(n:number)=>`${inrAmount(Math.max(0,n))}`;
export async function computePulse(prisma:PrismaClient,user:SessionUser){
  const can=(p:Permission)=>user.permissions.includes(p);
  const work=scopeWhere(user,null,"ownerId"),customer=scopeWhere(user,null,undefined,"assignedToId");
  const settings=await prisma.settings.findMany();
  const config=Object.fromEntries(settings.map(s=>[s.key,s.value]));
  const warn=Number(config["pnr.warning.hours"]??24),urgent=Number(config["pnr.urgent.hours"]??8),months=Number(config["passport.min.validity.months"]??6);
  const now=Date.now();
  // Only the kinds that feed the attention list are bounded. Bookings, visa cases and invoices stay
  // complete, because they also carry the money figures and the KPI counts: truncating those would
  // quietly change what the agency is owed. A capped list announces itself instead (see below).
  const truncated:string[]=[];
  const bounded=async <T,>(p:Promise<T[]>,kind:string):Promise<T[]>=>{const rows=await p;if(rows.length<=ITEM_LIMIT)return rows;truncated.push(kind);return rows.slice(0,ITEM_LIMIT);};
  const [bookings,cases,invoices,documents,passports,tasks,refunds,dues,threads,customerCount]=await Promise.all([
    can("ticketing:view")?prisma.booking.findMany({where:work,include:{customer:{select:{name:true}},payments:{select:{amount:true}},refunds:{select:{amount:true,status:true}}}}):[],
    can("visa:view")?prisma.visaCase.findMany({where:work,include:{stage:true,customer:{select:{name:true}},documents:{select:{status:true}}}}):[],
    can("invoice:view")?prisma.invoice.findMany({where:{customer:{is:customer}},include:{customer:{select:{name:true}},booking:{select:{status:true}}}}):[],
    can("document:view")?bounded(prisma.document.findMany({where:{customer:{is:customer},OR:[{status:{in:["RECEIVED","UNDER_REVIEW"]},verificationStatus:"PENDING"},{status:"REUPLOAD_REQUESTED"}]},include:{customer:{select:{name:true}},traveller:{select:{fullName:true}},visaCase:{select:{id:true,caseNo:true,travelDate:true,destination:true}}},take:ITEM_LIMIT+1}),"documents"):[],
    // Passports are found by the columns the expiry rule actually needs (a recorded expiry and a
    // trip to compare it against), and the rule itself still runs in TypeScript below, so a
    // differently-cased document type is judged exactly as before.
    can("document:view")?bounded(prisma.document.findMany({where:{customer:{is:customer},expiryDate:{not:null},visaCase:{isNot:null}},include:{customer:{select:{name:true}},traveller:{select:{fullName:true}},visaCase:{select:{id:true,caseNo:true,travelDate:true,destination:true}}},take:ITEM_LIMIT+1}),"passports"):[],
    can("task:view")?bounded(prisma.task.findMany({where:{AND:[scopeWhere(user,null,"ownerId"),{status:{in:["OPEN","IN_PROGRESS"]}},{OR:[{dueAt:{lt:new Date(now)}},{priority:"URGENT"}]}]},orderBy:{dueAt:"asc"},include:{owner:{select:{name:true}},customer:{select:{name:true}}},take:ITEM_LIMIT+1}),"tasks"):[],
    can("refund:view")?bounded(prisma.refund.findMany({where:{customer:{is:customer},status:{notIn:["PAID","REJECTED"]}},orderBy:{requestedOn:"asc"},include:{customer:{select:{name:true}}},take:ITEM_LIMIT+1}),"refunds"):[],
    can("supplier:view")&&user.accessMode==="ALL"?bounded(prisma.supplierDue.findMany({where:{paid:false,dueDate:{lte:new Date(now+7*24*H)}},orderBy:{dueDate:"asc"},include:{supplier:{select:{name:true}}},take:ITEM_LIMIT+1}),"dues"):[],
    // A thread is a candidate only if it holds an inbound message older than the reply window; the
    // stricter "and it is still the latest message" rule runs below, unchanged.
    can("whatsapp:view")?bounded(prisma.whatsAppThread.findMany({where:{customer:{is:customer},msgs:{some:{direction:"IN",at:{lt:new Date(now-4*H)}}}},orderBy:{lastMsgAt:"asc"},include:{customer:{select:{name:true}},msgs:{orderBy:{at:"desc"},take:1}},take:ITEM_LIMIT+1}),"threads"):[],
    can("customer:view")?prisma.customer.count({where:customer}):0,
  ]);
  const items:PulseItem[]=[];
  const open=(label:string,href:string):PulseAction=>({label,href});
  const log=(label:string,body:Record<string,unknown>):PulseAction=>({label,api:"/api/whatsapp/send",body});
  for(const b of bookings){
    if(isWithdrawnBooking(b.status)) {
      const balance=balanceOf(bookingCharge(b),netReceived(b.payments.reduce((s,p)=>s+p.amount,0),b.refunds));
      if(can("payment:view")&&hasCancellationAllocation(b)&&balance>0) {
        const href=`/ticketing/${b.id}`;
        items.push({id:`cancelpay:${b.id}`,kind:"PAYMENT_OVERDUE",severity:"MEDIUM",title:`${money(balance)} cancellation charges due · ${b.bookingNo}`,detail:`${b.customer.name} · ${enumLabel(b.status)} — trip remains closed`,href,actions:[open("Review cancellation charges",href),...(can("payment:record")&&b.gdsSource!=="TRIPJACK_API"?[open("Record cancellation payment",`/payments?action=record&customer=${b.customerId}&booking=${b.id}`)]:[])]});
      }
      continue;
    }
    if(!b.ticketingDeadline||!["PNR_CREATED","ON_HOLD","PAYMENT_AWAITED","QUOTE_SENT"].includes(b.status))continue;
    const hours=(b.ticketingDeadline.getTime()-now)/H;if(hours>warn)continue;
    const href=`/ticketing/${b.id}`,balance=bookingCharge(b)-netReceived(b.payments.reduce((s,p)=>s+p.amount,0),b.refunds);
    const actions=[open("Open booking",href)];
    if(can("payment:record"))actions.push(open("Record payment",`/payments?action=record&customer=${b.customerId}&booking=${b.id}`));
    if(can("ticketing:edit"))actions.push({label:"Extend 24 hours",api:"/api/bookings/extend-deadline",body:{bookingId:b.id,hours:24}});
    items.push({id:`pnr:${b.id}`,kind:"PNR_DEADLINE",severity:hours<=urgent?"URGENT":"HIGH",title:`${b.pnr??b.bookingNo} · ${hours<0?"ticketing deadline passed":`ticketing due in ${Math.max(1,Math.round(hours))}h`}`,detail:`${b.customer.name} · ${b.sector??"Route pending"}${can("payment:view")?` · Balance ${money(balance)}`:""}`,href,at:b.ticketingDeadline.toISOString(),actions});
  }
  for(const inv of invoices){
    if(inv.booking&&isWithdrawnBooking(inv.booking.status))continue;
    if(inv.status==="PAID"||inv.status==="CREDITED"||!(inv.dueDate?inv.dueDate.getTime()<now:inv.issuedOn.getTime()<now-7*24*H))continue;
    const href=`/payments?focus=${inv.id}`,actions=[open("Open invoices",href)];
    if(can("payment:record"))actions.push(open("Record payment",`/payments?action=record&customer=${inv.customerId}&invoice=${inv.id}`));
    if(can("whatsapp:send"))actions.push(log("Log reminder",{customerId:inv.customerId,template:"PAYMENT_REMINDER",invoiceId:inv.id}));
    items.push({id:`inv:${inv.id}`,kind:"PAYMENT_OVERDUE",severity:"HIGH",title:`${inv.invoiceNo} · ${money(inv.amount-inv.amountPaid)} overdue`,detail:inv.customer.name,href,actions});
  }
  for(const v of cases){
    const href=`/visa/${v.id}`,missing=v.documents.filter(d=>["REQUIRED","REQUESTED","REUPLOAD_REQUESTED"].includes(d.status)).length;
    if(missing&&["DOCUMENTS_PENDING","DOCUMENTS_VERIFICATION","READY_FOR_SUBMISSION"].includes(v.stage.key))items.push({id:`docs:${v.id}`,kind:"VISA_BLOCKED_DOCS",severity:"HIGH",title:`${v.caseNo} · ${missing} documents outstanding`,detail:`${v.customer.name} · ${v.destination} · ${v.stage.name}`,href,actions:[open("Review dossier",href)]});
    if(v.appointmentDate&&v.appointmentDate.getTime()>=now&&v.appointmentDate.getTime()<now+36*H)items.push({id:`appt:${v.id}`,kind:"APPOINTMENT_TOMORROW",severity:"HIGH",title:`Appointment approaching · ${v.caseNo}`,detail:`${v.customer.name} · ${v.destination} · ${dateTimeLabel(v.appointmentDate)}`,href,at:v.appointmentDate.toISOString(),actions:[open("Open case",href)]});
    if(v.stage.key==="APPOINTMENT_REQUIRED")items.push({id:`bookappt:${v.id}`,kind:"VISA_APPOINTMENT_NEEDED",severity:"MEDIUM",title:`Book appointment · ${v.caseNo}`,detail:`${v.customer.name} · ${v.destination}`,href,actions:[open("Open case",href)]});
    if(can("payment:view")&&v.stage.key==="PAYMENT_AWAITED"&&v.sellingPrice>v.amountReceived)items.push({id:`pay:${v.id}`,kind:"PAYMENT_OVERDUE",severity:"MEDIUM",title:`${money(v.sellingPrice-v.amountReceived)} outstanding · ${v.caseNo}`,detail:`${v.customer.name} · Payment awaited`,href,actions:[open("Open case",href),...(can("payment:record")?[open("Record payment",`/payments?action=record&customer=${v.customerId}&visaCase=${v.id}`)]:[])]});
  }
  for(const d of documents){
    const href=`/documents?focus=${d.id}`;
    if(["RECEIVED","UNDER_REVIEW"].includes(d.status)&&d.verificationStatus==="PENDING")items.push({id:`verify:${d.id}`,kind:"DOC_UNVERIFIED",severity:"MEDIUM",title:`${d.docType} awaits verification`,detail:`${d.customer.name} · ${d.traveller?.fullName??"Customer document"}`,href,actions:[open("Review document",href)]});
    if(d.status==="REUPLOAD_REQUESTED")items.push({id:`reupload:${d.id}`,kind:"DOC_REUPLOAD",severity:"MEDIUM",title:`Re-upload needed · ${d.docType}`,detail:`${d.customer.name} · ${d.rejectionReason??"Review document instructions"}`,href,actions:[open("Open document",href)]});
  }
  for(const d of passports){
    const href=`/documents?focus=${d.id}`;
    if(can("sensitive:view")&&d.docType.toLowerCase()==="passport"&&d.expiryDate&&d.visaCase?.travelDate){const minimum=new Date(d.visaCase.travelDate);minimum.setMonth(minimum.getMonth()+months);if(d.expiryDate<minimum)items.push({id:`passport:${d.id}`,kind:"PASSPORT_EXPIRY",severity:d.expiryDate.getTime()<now?"URGENT":"HIGH",title:`Passport validity warning · ${d.traveller?.fullName??d.customer.name}`,detail:`${d.visaCase.caseNo} · Validity less than ${months} months after travel. Check destination rules.`,href,actions:[open("Review passport",href)]});}
  }
  for(const t of tasks){if(!(t.dueAt&&t.dueAt.getTime()<now)&&t.priority!=="URGENT")continue;const href=`/tasks?focus=${t.id}`;items.push({id:`task:${t.id}`,kind:"TASK_OVERDUE",severity:t.dueAt&&t.dueAt.getTime()<now?"HIGH":"MEDIUM",title:`${t.dueAt&&t.dueAt.getTime()<now?"Overdue":"Urgent"} · ${t.title}`,detail:`${t.owner.name}${t.customer?` · ${t.customer.name}`:""}`,href,actions:[open("Open tasks",href),...(can("task:edit")?[{label:"Mark done",api:"/api/tasks/status",body:{taskId:t.id,status:"DONE"}}]:[])]});}
  for(const r of refunds){const days=Math.floor((now-r.requestedOn.getTime())/(24*H));const href=`/refunds?focus=${r.id}`;items.push({id:`refund:${r.id}`,kind:"REFUND_PENDING",severity:days>14?"HIGH":"MEDIUM",title:`Refund pending ${days}d · ${r.refundNo}`,detail:`${r.customer.name} · ${money(r.amount)} · ${enumLabel(r.status)}`,href,actions:[open("Review refund",href)]});}
  for(const due of dues)items.push({id:`supplier:${due.id}`,kind:"SUPPLIER_DUE",severity:due.dueDate.getTime()<now?"HIGH":"MEDIUM",title:`${due.supplier.name} · ${money(due.amount)} ${due.dueDate.getTime()<now?"overdue":"due soon"}`,detail:due.description,href:"/suppliers",actions:[open("Review supplier","/suppliers")]});
  for(const t of threads){const last=t.msgs[0];if(last?.direction==="IN"&&last.at.getTime()<now-4*H){const href=`/whatsapp?thread=${t.id}`;items.push({id:`message:${t.id}`,kind:"UNANSWERED_WHATSAPP",severity:"MEDIUM",title:`Unanswered message · ${t.customer.name}`,detail:last.body.slice(0,100),href,actions:[open("Open conversation",href)]});}}
  // A capped list says so rather than quietly looking complete, and each note links to the page that
  // holds the whole list, so a manager never reads a partial list as the whole picture.
  const cappedPages:Record<string,{what:string;href:string}>={documents:{what:"documents awaiting action",href:"/documents"},passports:{what:"passport checks",href:"/customers"},tasks:{what:"tasks",href:"/tasks"},refunds:{what:"refunds",href:"/refunds"},threads:{what:"conversations",href:"/whatsapp"},dues:{what:"supplier payments",href:"/suppliers"}};
  for(const kind of [...new Set(truncated)]){const page=cappedPages[kind];if(!page)continue;items.push({id:`capped:${kind}`,kind:`LIST_CAPPED_${kind.toUpperCase()}`,severity:"MEDIUM",title:`List capped at ${ITEM_LIMIT} · ${page.what}`,detail:`Showing the ${ITEM_LIMIT} most overdue ${page.what}. Open the full list to work through the rest.`,href:page.href,actions:[open("Open full list",page.href)]});}
  items.sort((a,b)=>["URGENT","HIGH","MEDIUM"].indexOf(a.severity)-["URGENT","HIGH","MEDIUM"].indexOf(b.severity));
  const counts={urgent:items.filter(i=>i.severity==="URGENT").length,high:items.filter(i=>i.severity==="HIGH").length,medium:items.filter(i=>i.severity==="MEDIUM").length};
  // Money owed is computed in one shared place (lib/receivables) so the dashboard, the money page
  // and a customer's profile can never show three different answers to the same question.
  const receivables=receivablesFrom({
    invoices,
    bookings:bookings.map(b=>({status:b.status,sellingPrice:b.sellingPrice,cancellationSupplierCharge:b.cancellationSupplierCharge,cancellationAgencyFee:b.cancellationAgencyFee,received:b.payments.reduce((s,p)=>s+p.amount,0),refunds:b.refunds})),
    visaCases:cases.map(c=>({sellingPrice:c.sellingPrice,received:c.amountReceived})),
  });
  // Icons and notes travel with the card: the list is permission-filtered, so the client must
  // not assume a fixed order or position.
    // There is deliberately no "Needs attention" tile here. It used to sit directly above the panel
  // headed "Needs your attention", both showing the same number, and the number is already on that
  // panel's heading — a tile that repeats the thing below it is not a metric, it is a second title.
  const kpis=[...(can("visa:view")?[{label:"Active visa cases",value:String(cases.filter(c=>!["CLOSED","DELIVERED","REJECTED"].includes(c.stage.key)).length),href:"/visa",tone:"ok",icon:"visa",note:"Live workspace records"}]:[]),...(can("ticketing:view")?[{label:"Live bookings",value:String(bookings.filter(b=>!["CANCELLED","VOID","REFUNDED"].includes(b.status)).length),href:"/ticketing",tone:"ok",icon:"plane",note:"Live workspace records"}]:[]),...(can("invoice:view")?[{label:"Receivables",value:money(receivables.total),href:"/payments",tone:receivables.total>0?"warn":"ok",icon:"wallet",note:receivablesNote(receivables)}]:[])];
  const quickActions=[{permission:"customer:create",label:"Add a customer",description:"Add a customer and travellers",href:"/customers?action=new",icon:"customers"},{permission:"visa:create",label:"Start a visa case",description:"Open a case for the applicants",href:"/visa/new",icon:"visa"},{permission:"ticketing:create",label:"Create a booking",description:"Record an enquiry or PNR booking",href:"/ticketing/new",icon:"plane"},{permission:"payment:record",label:"Record a payment",description:"Log a receipt against open work",href:"/payments?action=record",icon:"wallet"}].filter(a=>can(a.permission as Permission)).map(a=>({label:a.label,description:a.description,href:a.href,icon:a.icon}));
  return{items,counts,generatedAt:new Date().toISOString(),kpis,quickActions,receivables,firstRun:customerCount===0&&bookings.length===0&&cases.length===0,name:user.name};
}
