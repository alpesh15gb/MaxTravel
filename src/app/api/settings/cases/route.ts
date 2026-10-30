import {roleCanOwnCase} from "@/lib/service-cases";
import {prisma} from "@/lib/db";
import {requireSession,jsonError,ApiError} from "@/lib/guard";
import {boundedJson} from "@/lib/bounded-json";
import {caseConfigSchema} from "@/lib/case-config";
import {z} from "zod";
export async function POST(req:Request){try{const user=await requireSession("settings:manage");const data=caseConfigSchema.parse(await boundedJson(req));await prisma.$transaction(async tx=>{if(data.defaultOwnerId){const owner=await tx.user.findUnique({where:{id:data.defaultOwnerId},include:{role:true}});if(!owner?.active||!roleCanOwnCase(owner.role.key)||(user.accessMode!=="ALL"&&owner.branchId!==user.branchId))throw new ApiError(400,"Choose an active owner with case access within your branch scope.");}await tx.settings.upsert({where:{key:"case.configuration"},create:{key:"case.configuration",value:JSON.stringify(data)},update:{value:JSON.stringify(data)}});await tx.auditLog.create({data:{userId:user.id,action:"UPDATE",entity:"Settings",entityId:"cases",detail:"Case numbering and workflow defaults updated; existing references unchanged"}});});return Response.json({ok:true});}catch(e){if(e instanceof z.ZodError)return Response.json({error:"Use a 2–8 character uppercase prefix and follow-up interval of 0–365 days."},{status:400});return jsonError(e);}}
