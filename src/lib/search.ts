import { inrAmount } from "@/lib/money";
import type { PrismaClient } from "@prisma/client";
import type { SessionUser } from "./session";
import { scopeWhere } from "./guard";
export type SearchGroupKey="CUSTOMER"|"EMPLOYEE"|"VISA_CASE"|"BOOKING"|"PNR"|"TICKET"|"TRAVELLER"|"DOCUMENT"|"INVOICE"|"RECEIPT"|"SUPPLIER"|"TASK";
export interface SearchHit{id:string;group:SearchGroupKey;title:string;subtitle:string;context:string;href:string}
export interface SearchResponse{query:string;tookMs:number;groups:{key:SearchGroupKey;label:string;hits:SearchHit[]}[];exact?:SearchHit}
export async function universalSearch(prisma:PrismaClient,query:string,user:SessionUser):Promise<SearchResponse>{
 const start=Date.now(),q=query.trim().slice(0,120);if(q.length<2)return{query:q,tookMs:0,groups:[]};const can=(p:string)=>user.permissions.some(v=>v===p),contains={contains:q},customer=scopeWhere(user,null,undefined,"assignedToId"),work=scopeWhere(user,null,"ownerId"),sensitive=can("sensitive:view");
 const [customers,employees,cases,bookings,travellers,tickets,invoices,receipts,suppliers,tasks,docs]=await Promise.all([
 can("customer:view")?prisma.customer.findMany({where:{AND:[customer,{OR:[{name:contains},{phone:contains},{email:contains},{code:contains},{city:contains}]}]},take:8}):[],
 can("employee:view")?prisma.user.findMany({where:{AND:[user.accessMode==="BRANCH"?{branchId:user.branchId}:user.accessMode==="ASSIGNED"?{id:user.id}:{},{OR:[{name:contains},{email:contains},{employeeCode:contains}]}]},include:{role:true},take:6}):[],
 can("visa:view")?prisma.visaCase.findMany({where:{AND:[work,{OR:[{caseNo:contains},{destination:contains},{customer:{name:contains}},{travellers:{some:{traveller:{fullName:contains}}}},...(sensitive?[{travellers:{some:{traveller:{passportNumber:contains}}}}]:[])]}]},include:{customer:true,stage:true},take:8}):[],
 can("ticketing:view")?prisma.booking.findMany({where:{AND:[work,{OR:[{bookingNo:contains},{pnr:contains},{sector:contains},{customer:{name:contains}}]}]},include:{customer:true},take:8}):[],
 can("traveller:view")?prisma.traveller.findMany({where:{customer:{is:customer},OR:[{fullName:contains},...(sensitive?[{passportNumber:contains}]:[])]},include:{customer:true},take:6}):[],
 can("ticketing:view")?prisma.ticket.findMany({where:{booking:{is:work},OR:[{ticketNo:contains},{passenger:contains}]},include:{booking:true},take:6}):[],
 can("invoice:view")?prisma.invoice.findMany({where:{customer:{is:customer},OR:[{invoiceNo:contains},{description:contains},{customer:{name:contains}}]},include:{customer:true},take:6}):[],
 can("payment:view")?prisma.payment.findMany({where:{customer:{is:customer},OR:[{receiptNo:contains},{customer:{name:contains}}]},include:{customer:true},take:6}):[],
 can("supplier:view")?prisma.supplier.findMany({where:{OR:[{name:contains},{city:contains}]},take:6}):[],
 can("task:view")?prisma.task.findMany({where:{AND:[scopeWhere(user,null,"ownerId"),{title:contains}]},include:{owner:true},take:6}):[],
 can("document:view")?prisma.document.findMany({where:{customer:{is:customer},OR:[{docNo:contains},{docType:contains},{customer:{name:contains}},{traveller:{fullName:contains}}]},include:{customer:true},take:6}):[],
 ]);
 const groups:SearchResponse["groups"]=[];const add=(key:SearchGroupKey,label:string,hits:Omit<SearchHit,"group">[])=>{if(hits.length)groups.push({key,label,hits:hits.map(h=>({...h,group:key}))});};
 add("CUSTOMER","Customers",customers.map(c=>({id:c.id,title:c.name,subtitle:`${c.code} · ${c.phone}`,context:c.city,href:`/customers/${c.id}`})));
 add("EMPLOYEE","Team",employees.map(e=>({id:e.id,title:e.name,subtitle:e.employeeCode,context:e.role.name,href:`/employees/${e.id}`})));
 add("VISA_CASE","Visa cases",cases.map(v=>({id:v.id,title:v.caseNo,subtitle:`${v.customer.name} · ${v.destination}`,context:v.stage.name,href:`/visa/${v.id}`})));
 add("BOOKING","Bookings & PNRs",bookings.map(b=>({id:b.id,title:b.pnr??b.bookingNo,subtitle:`${b.customer.name} · ${b.bookingNo}`,context:b.sector??"",href:`/ticketing/${b.id}`})));
 add("TRAVELLER","Travellers",travellers.map(t=>({id:t.id,title:t.fullName,subtitle:t.customer.name,context:sensitive?t.passportNumber??"":t.relation,href:`/customers/${t.customerId}?tab=travellers`})));
 add("TICKET","Tickets",tickets.map(t=>({id:t.id,title:t.ticketNo,subtitle:t.passenger,context:t.booking.bookingNo,href:`/ticketing/${t.bookingId}`})));
 add("INVOICE","Invoices",invoices.map(i=>({id:i.id,title:i.invoiceNo,subtitle:i.customer.name,context:`${inrAmount((i.amount-i.amountPaid))} balance`,href:`/payments?focus=${i.id}`})));
 add("RECEIPT","Receipts",receipts.map(p=>({id:p.id,title:p.receiptNo,subtitle:p.customer.name,context:`${inrAmount(p.amount)}`,href:`/customers/${p.customerId}?tab=payments`})));
 add("SUPPLIER","Suppliers",suppliers.map(s=>({id:s.id,title:s.name,subtitle:s.city??"",context:s.type,href:`/suppliers?focus=${s.id}`})));
 add("TASK","Tasks",tasks.map(t=>({id:t.id,title:t.title,subtitle:t.owner.name,context:t.status,href:`/tasks?focus=${t.id}`})));
 add("DOCUMENT","Documents",docs.map(d=>({id:d.id,title:d.docType,subtitle:`${d.customer.name} · ${d.docNo}`,context:d.status,href:`/documents?focus=${d.id}`})));
 const exact=groups.flatMap(g=>g.hits).find(h=>h.title.toLowerCase()===q.toLowerCase());return{query:q,tookMs:Date.now()-start,groups,...(exact?{exact}:{})};
}
