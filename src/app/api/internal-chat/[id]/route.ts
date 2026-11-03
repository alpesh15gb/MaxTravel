import {prisma} from "@/lib/db";
import {requireSession,ApiError,jsonError} from "@/lib/guard";
import {boundedJson} from "@/lib/bounded-json";
import {readChat,sendChat,markChatRead} from "@/lib/internal-chat";
import {salesRecoveryContext} from "@/lib/sales-recovery-context";
import {z} from "zod";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
export async function GET(req:Request,ctx:{params:Promise<{id:string}>}){try{const u=await requireSession("chat:use"),p=new URL(req.url).searchParams;return Response.json(await readChat(prisma,u,(await ctx.params).id,{before:p.get("before")??undefined,after:p.get("after")??undefined}),{headers});}catch(e){return jsonError(e);}}
export async function POST(req:Request,ctx:{params:Promise<{id:string}>}){try{const u=await requireSession("chat:use");if(req.headers.get("x-staff-context")!==salesRecoveryContext(u))throw new ApiError(409,"Staff session or access changed. Reload messages before continuing.");const id=(await ctx.params).id,b=await boundedJson(req,32768);return Response.json(b.action==="READ"?await markChatRead(prisma,u,id,z.string().min(1).max(200).parse(b.messageId)):await sendChat(prisma,u,id,b),{headers});}catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(i=>i.message).join(" ")},{status:400,headers});return jsonError(e);}}
