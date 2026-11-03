import {requireSession,jsonError} from "@/lib/guard";
import {prisma} from "@/lib/db";
import {boundedJson} from "@/lib/bounded-json";
import {readMaster} from "@/lib/customer-master";
import {masterReadiness,readinessSchema} from "@/lib/master-readiness";
import {z} from "zod";
export async function POST(req:Request,ctx:{params:Promise<{id:string}>}){try{const u=await requireSession("traveller:view"),id=(await ctx.params).id,r=readinessSchema.parse(await boundedJson(req)),master=await readMaster(prisma,u,id),result=masterReadiness(master,r);await prisma.auditLog.create({data:{userId:u.id,action:"MASTER_READINESS",entity:"Customer",entityId:id,detail:JSON.stringify({customerId:id,fields:["travelRequirements"],ruleSource:r.ruleSource,destination:r.destination,departure:r.departure,returnDate:r.returnDate,issues:result.issues.length})}});return Response.json(result,{headers:{"Cache-Control":"private, no-store"}});}catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(i=>i.message).join(" ")},{status:400});return jsonError(e);}}
