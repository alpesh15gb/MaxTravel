import {requirePage} from "@/lib/guard";
import {workReport} from "@/lib/work-reports";
import WorkReportClient from "@/components/WorkReportClient";
export const dynamic="force-dynamic";
export default async function WorkReportsPage({searchParams}:{searchParams:Promise<{from?:string;to?:string;owner?:string;service?:string}>}){const u=await requirePage("task:view"),sp=await searchParams,q=new URLSearchParams();for(const [k,v] of Object.entries(sp))if(v)q.set(k,v);return <WorkReportClient report={await workReport(u,q)}/>;}
