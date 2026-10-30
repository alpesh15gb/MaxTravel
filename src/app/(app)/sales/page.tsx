import { requirePage } from "@/lib/guard";
import {caseEntryContext,caseCustomerScope} from "@/lib/service-cases";
import {prisma} from "@/lib/db";
import {redirect} from "next/navigation";
import SalesClient from "./SalesClient";
export default async function Page({searchParams}:{searchParams:Promise<{lead?:string|string[];action?:string;case?:string}>}){
 const user=await requirePage("customer:view");
 const {lead,action,case:caseId}=await searchParams;
 const journey=await caseEntryContext(prisma,user,caseId);
 const customer=journey?await prisma.customer.findFirst({where:{AND:[caseCustomerScope(user),{id:journey.customerId}]},select:{id:true,name:true,code:true}}):null;
 if(journey&&(!customer||journey.service==="VISA"||journey.closedAt))redirect(`/cases/${journey.id}`);
 const initialLeadId=typeof lead==="string"&&/^[A-Za-z0-9_-]{1,200}$/.test(lead)?lead:undefined;
 return <SalesClient initialLeadId={initialLeadId} initialCase={journey&&customer?{id:journey.id,caseNo:journey.caseNo,customerId:customer.id,customerName:customer.name,customerCode:customer.code,service:journey.service,title:journey.title}:null} initialCreate={action==="new"&&user.permissions.includes("customer:create")}/>;
}
