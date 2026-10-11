import { prisma } from "@/lib/db";
import UploadClient from "./UploadClient";
import Icon from "@/components/Icon";
export const dynamic="force-dynamic";
export default async function UploadPage({params:pending}:{params:Promise<{token:string}>}){
 const params=await pending;
 const link=await prisma.uploadLink.findUnique({where:{token:params.token},include:{customer:true,traveller:true,visaCase:{include:{stage:true}}}});
 if(!link||link.revoked||link.expiresAt<new Date())return <main className="flex min-h-screen items-center justify-center p-6"><div className="panel max-w-md p-10 text-center"><Icon name="shield" size={36} className="mx-auto mb-5 text-teal-700"/><h1 className="text-2xl font-semibold">This link is no longer available.</h1><p className="mt-3 text-sm leading-6 text-slate-500">It may have expired or been revoked. Contact your agency for a new private upload link.</p></div></main>;
 const [documents,agency]=await Promise.all([prisma.document.findMany({where:{customerId:link.customerId,...(link.visaCaseId?{visaCaseId:link.visaCaseId}:{}),...(link.travellerId?{travellerId:link.travellerId}:{}),status:{not:"ARCHIVED"}},include:{traveller:{select:{fullName:true}}},orderBy:{createdAt:"asc"}}),prisma.settings.findUnique({where:{key:"agency.name"}})]);
 const ids=documents.map(d=>d.checklistItemId).filter((x):x is string=>!!x);const requirements=await prisma.checklistItem.findMany({where:{id:{in:ids}}});
 return <UploadClient token={params.token} agencyName={agency?.value??"Your agency"} customerName={link.customer.name} caseLabel={link.visaCase?`${link.visaCase.destination} · ${link.visaCase.visaType}`:"Your documents"} stageName={link.visaCase?.stage.name??null} travellerFilter={link.traveller?.fullName??null} note={link.note} expiresAt={link.expiresAt.toISOString()} items={documents.map(d=>{const item=requirements.find(i=>i.id===d.checklistItemId);return{id:d.id,docType:d.docType,status:d.status,travellerId:d.travellerId,traveller:d.traveller?.fullName??null,rejectionReason:d.rejectionReason,instructions:item?.instructions??d.notes,fileTypes:item?.fileTypes??"pdf,jpg,png",maxSizeMb:Math.min(15,item?.maxSizeMb??15),needsExpiry:item?.needsExpiry??false,expiryDate:d.expiryDate?.toISOString().slice(0,10)??""};})}/>;
}
