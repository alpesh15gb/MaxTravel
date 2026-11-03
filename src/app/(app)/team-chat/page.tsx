import {requirePage} from "@/lib/guard";import StaffChat from "@/components/StaffChat";
export const dynamic="force-dynamic";
export default async function TeamChatPage({searchParams}:{searchParams:Promise<{case?:string}>}){await requirePage("chat:use");const p=await searchParams;return <StaffChat caseId={typeof p.case==="string"&&p.case.length<201?p.case:undefined}/>;}
