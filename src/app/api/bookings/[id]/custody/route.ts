import {prisma} from "@/lib/db";
import {requireSession,jsonError,ApiError} from "@/lib/guard";
import {boundedJson} from "@/lib/bounded-json";
import {salesRecoveryContext} from "@/lib/sales-recovery-context";
import {masterMultipart} from "@/lib/master-upload";
import {custodyHome,custodyUpload,createDelivery,revokeCustody,recordBookingCost} from "@/lib/booking-custody";
import {z} from "zod";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
export async function GET(_:Request,ctx:{params:Promise<{id:string}>}){try{return Response.json(await custodyHome(prisma,await requireSession("ticketing:view"),(await ctx.params).id),{headers});}catch(e){return jsonError(e);}}
export async function POST(req:Request,ctx:{params:Promise<{id:string}>}){try{const user=await requireSession("ticketing:view"),id=(await ctx.params).id;if(req.headers.get("x-staff-context")!==salesRecoveryContext(user))throw new ApiError(409,"Your staff session or access changed. Reload this booking before continuing.");const result=req.headers.get("content-type")?.startsWith("multipart/form-data")?await custodyUpload(prisma,user,id,await masterMultipart(req)):await (async()=>{const b=await boundedJson(req);if(b.action==="COST")return recordBookingCost(prisma,user,id,b.data);return b.action==="REVOKE"?revokeCustody(prisma,user,id,b.target):createDelivery(prisma,user,id,b);})();return Response.json(result,{headers});}catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(i=>i.message).join(" ")},{status:400,headers});return jsonError(e);}}
