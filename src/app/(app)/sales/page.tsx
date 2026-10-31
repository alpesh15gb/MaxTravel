import { requirePage } from "@/lib/guard";
import {caseEntryContext} from "@/lib/service-cases";
import {prisma} from "@/lib/db";
import {redirect} from "next/navigation";
import SalesClient from "./SalesClient";
export default async function Page({searchParams}:{searchParams:Promise<{lead?:string|string[];action?:string;case?:string}>}){
 const user=await requirePage("customer:view");
 const {lead,action,case:caseId}=await searchParams;
 const journey=await caseEntryContext(prisma,user,caseId);
 const salesService=journey?(await prisma.serviceWork.findFirst({where:{caseId:journey.id,service:{in:["FLIGHT","HOTEL"]}},select:{service:true},orderBy:{createdAt:"asc"}}))?.service:null;
 const customer=journey?await prisma.customer.findFirst({where:{id:journey.customerId},select:{id:true,name:true,code:true}}):null;
 if(journey&&(!customer||!salesService||journey.closedAt))redirect(`/cases/${journey.id}`);
 const initialLeadId=typeof lead==="string"&&/^[A-Za-z0-9_-]{1,200}$/.test(lead)?lead:undefined;
 return <SalesClient initialLeadId={initialLeadId} initialCase={journey&&customer?{id:journey.id,caseNo:journey.caseNo,customerId:customer.id,customerName:customer.name,customerCode:customer.code,service:salesService!,title:journey.title}:null} initialCreate={action==="new"&&user.permissions.includes("customer:create")}/>;
}
