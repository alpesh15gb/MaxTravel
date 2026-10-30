import {createHash} from "node:crypto";
import {z} from "zod";
import {prisma} from "@/lib/db";
import {ApiError,jsonError,requireSession} from "@/lib/guard";
import {boundedJson} from "@/lib/bounded-json";
import {CASE_READ,CASE_STATUSES,caseFor,canEditCase,assertCaseOwner} from "@/lib/service-cases";
import {readCaseConfig} from "@/lib/case-config";
const input=z.object({requestKey:z.string().uuid(),version:z.string().datetime(),status:z.enum(CASE_STATUSES),note:z.string().trim().min(3).max(4000),ownerId:z.string().min(1).max(200),nextFollowUpAt:z.string().datetime().nullable()}).strict();
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){try{const user=await requireSession([...CASE_READ]);if(!canEditCase(user))throw new ApiError(403,"Your role cannot update case tracking.");const {id}=await params,data=input.parse(await boundedJson(req));const hash=createHash("sha256").update(JSON.stringify({id,...data})).digest("hex");const record=await prisma.$transaction(async tx=>{
 const row=await caseFor(tx,user,id);const prior=await tx.serviceCaseMutation.findUnique({where:{actorId_requestKey:{actorId:user.id,requestKey:data.requestKey}}});if(prior){if(prior.bodyHash!==hash||prior.caseId!==row.id)throw new ApiError(409,"This request reference belongs to different changes.");return row;}
 if(row.updatedAt.toISOString()!==data.version)throw new ApiError(409,"The case changed. Your note is preserved; refresh and review the latest case before saving again.");
 if(data.ownerId!==row.ownerId)await assertCaseOwner(tx,user,data.ownerId,row.branchId);
 const closed=["COMPLETED","CANCELLED"].includes(data.status);if(closed&&data.nextFollowUpAt)throw new ApiError(400,"Clear the next follow-up when closing a case.");
 const config=readCaseConfig((await tx.settings.findUnique({where:{key:"case.configuration"}}))?.value);
 if(data.status==="COMPLETED"&&config.requireResolvedWorkToClose){const [bookings,visas]=await Promise.all([tx.booking.findMany({where:{serviceCaseId:row.id},select:{status:true}}),tx.visaCase.findMany({where:{serviceCaseId:row.id},select:{closedAt:true,visaOutcome:true}})]);if(!bookings.length&&!visas.length||bookings.some(b=>!["TICKETED","CONFIRMED","REISSUED","CANCELLED","VOID","REFUNDED"].includes(b.status))||visas.some(v=>!v.closedAt&&!v.visaOutcome))throw new ApiError(409,"Resolve the linked booking or visa decision before completing this case. Case closure does not confirm a supplier booking or settle money.");}
 const updated=await tx.serviceCase.update({where:{id:row.id},data:{status:data.status,ownerId:data.ownerId,nextFollowUpAt:data.nextFollowUpAt?new Date(data.nextFollowUpAt):null,closedAt:closed?(row.closedAt??new Date()):null,updatedAt:new Date(Math.max(Date.now(),row.updatedAt.getTime()+1))}});
 const ownerChanged=data.ownerId!==row.ownerId;const previousOwner=ownerChanged?await tx.user.findUnique({where:{id:row.ownerId},select:{name:true}}):null;const nextOwner=ownerChanged?await tx.user.findUnique({where:{id:data.ownerId},select:{name:true}}):null;
 await tx.serviceCaseEvent.create({data:{caseId:row.id,actorId:user.id,kind:"UPDATE",summary:`${row.status.replaceAll("_"," ")} → ${data.status.replaceAll("_"," ")}${ownerChanged?` · Owner: ${previousOwner?.name??"Previous owner"} → ${nextOwner?.name??"New owner"}`:""}${row.nextFollowUpAt?.toISOString()!==data.nextFollowUpAt?` · Follow-up: ${data.nextFollowUpAt??"cleared"}`:""}\n${data.note}`}});
 await tx.serviceCaseMutation.create({data:{actorId:user.id,requestKey:data.requestKey,bodyHash:hash,caseId:row.id}});await tx.auditLog.create({data:{userId:user.id,action:"UPDATE",entity:"ServiceCase",entityId:row.id,detail:`${row.status} → ${data.status}`}});return updated;
 });return Response.json({ok:true,caseId:record.id,caseNo:record.caseNo});}catch(e){if(e instanceof z.ZodError)return Response.json({error:"Choose a status and record a note of 3–4000 characters, with valid dates."},{status:400});return jsonError(e);}}
