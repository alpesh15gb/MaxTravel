import {notFound,redirect} from "next/navigation";
import {requirePage,ApiError,canTouchRecord} from "@/lib/guard";
import {prisma} from "@/lib/db";
import {readMaster} from "@/lib/customer-master";
import {loadCustomer360} from "@/lib/customer360";
import {serviceCaseScope} from "@/lib/service-cases";
import CustomerMasterWorkspace from "@/components/CustomerMasterWorkspace";
export const dynamic="force-dynamic";
export default async function MasterPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{tab?:string;traveller?:string}>}){
 const user=await requirePage("customer:view"),{id}=await params;
 const alias=await prisma.customer.findUnique({where:{id}});if(alias?.mergedIntoId&&canTouchRecord(user,alias))redirect("/masters/"+alias.mergedIntoId);
 let data;try{data=await readMaster(prisma,user,id,true);}catch(e){if(e instanceof ApiError&&e.status===404)notFound();throw e;}
 const legacy=await loadCustomer360(id,user);if(!legacy)notFound();
 const maxIds=await prisma.serviceCase.findMany({where:{AND:[serviceCaseScope(user),{customerId:id}]},select:{id:true,caseNo:true,title:true,status:true},orderBy:{createdAt:"desc"},take:100});
 const can=(p:string)=>user.permissions.some(x=>x===p);
 const q=await searchParams;const aliases:Record<string,string>={payments:"accounts",refunds:"accounts",tickets:"journeys",trips:"journeys",cases:"journeys",visa:"journeys",whatsapp:"notes"};const desired=aliases[q.tab??""]??q.tab??"profile";const allowed=["profile","journeys","notes","activity",...(data.permissions.viewTravellers?["travellers"]:[]),...(data.permissions.viewDocuments?["documents"]:[]),...(can("payment:view")?["accounts"]:[])];const initialTab=allowed.includes(desired)?desired:"profile";
 return <CustomerMasterWorkspace initialTab={initialTab} initialTravellerId={q.traveller??""} key={id+":"+initialTab+":"+(q.traveller??"")} initial={data} legacy={legacy} maxIds={maxIds} perms={{sensitive:can("sensitive:view"),send:can("whatsapp:send"),record:can("payment:record"),createVisa:can("visa:create"),createTicket:can("ticketing:create"),createTask:can("task:create"),requestDocs:can("document:upload"),finance:can("payment:view"),invoice:can("invoice:create"),editCustomer:can("customer:edit"),visibleTabs:[...(can("document:view")?["documents"]:[]),...(can("whatsapp:view")?["whatsapp"]:[]),...(can("visa:view")?["visa"]:[]),...(can("ticketing:view")?["tickets","trips"]:[]),...(can("payment:view")?["payments"]:[]),...(can("refund:view")?["refunds"]:[])]}}/>;
}
