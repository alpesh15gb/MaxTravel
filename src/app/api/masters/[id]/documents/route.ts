import {salesRecoveryContext} from "@/lib/sales-recovery-context";
import {requireSession,ApiError,jsonError} from "@/lib/guard";
import {prisma} from "@/lib/db";
import {masterMultipart,uploadMasterDocument} from "@/lib/master-upload";
import {z} from "zod";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(req:Request,ctx:{params:Promise<{id:string}>}){try{const user=await requireSession("document:upload");if(req.headers.get("x-master-context")!==salesRecoveryContext(user))throw new ApiError(409,"Staff session or access changed. Reload this master before uploading.");return Response.json(await uploadMasterDocument(prisma,user,(await ctx.params).id,await masterMultipart(req)),{headers:{"Cache-Control":"private, no-store"}});}catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(i=>i.message).slice(0,3).join(" ")},{status:400});if(e instanceof ApiError)return Response.json({error:e.message},{status:e.status});return jsonError(e);}}
