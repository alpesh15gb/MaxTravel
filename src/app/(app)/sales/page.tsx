import { requirePage } from "@/lib/guard";
import SalesClient from "./SalesClient";
export default async function Page({searchParams}:{searchParams:Promise<{lead?:string|string[]}>}){
 await requirePage("customer:view");
 const {lead}=await searchParams;
 const initialLeadId=typeof lead==="string"&&/^[A-Za-z0-9_-]{1,200}$/.test(lead)?lead:undefined;
 return <SalesClient initialLeadId={initialLeadId}/>;
}
