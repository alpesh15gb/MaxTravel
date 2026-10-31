import {z} from "zod";
import {randomUUID} from "node:crypto";
import {requireSession,jsonError} from "@/lib/guard";
import {prisma} from "@/lib/db";
import {changeWork,changeWorkSchema,taskFor} from "@/lib/work-engine";
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){try{const u=await requireSession("task:edit"),{id}=await params,b=await req.json();await prisma.$transaction(async tx=>{const t=await taskFor(tx,u,id);const data=changeWorkSchema.parse({requestKey:randomUUID(),version:t.version,action:"EDIT",title:b.title,details:b.details,priority:b.priority,...(b.ownerId&&b.ownerId!==t.ownerId?{ownerId:b.ownerId}:{}),...(b.dueAt!==undefined&&b.dueAt!==t.dueAt?.toISOString()?{dueAt:b.dueAt}:{}),note:b.note??""});await changeWork(tx,u,id,data);});return Response.json({ok:true});}catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues[0]?.message??"Check the task details."},{status:400});return jsonError(e);}}
