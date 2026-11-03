import {salesRecoveryContext} from "@/lib/sales-recovery-context";
import {requireSession,ApiError,jsonError} from "@/lib/guard";
import {boundedJson} from "@/lib/bounded-json";
import {prisma} from "@/lib/db";
import {readMaster,mutateMaster} from "@/lib/customer-master";
import {z} from "zod";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
function failure(e:unknown){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(i=>i.message).slice(0,3).join(" "),fieldErrors:e.issues.map(i=>({path:i.path.map(String),message:i.message}))},{status:400,headers});if(e instanceof ApiError)return Response.json({error:e.message},{status:e.status,headers});if(e&&typeof e==="object"&&"code"in e&&["P2002","P2034"].includes(String(e.code)))return Response.json({error:"Another save changed this master. Retry the same save reference to check its outcome."},{status:409,headers});return jsonError(e);}
export async function GET(_req:Request,ctx:{params:Promise<{id:string}>}){try{const u=await requireSession("customer:view");return Response.json(await readMaster(prisma,u,(await ctx.params).id,true),{headers});}catch(e){return failure(e);}}
export async function POST(req:Request,ctx:{params:Promise<{id:string}>}){try{const u=await requireSession("customer:view");if(req.headers.get("x-master-context")!==salesRecoveryContext(u))throw new ApiError(409,"Staff session or access changed. Reload this master before saving.");return Response.json(await mutateMaster(prisma,u,(await ctx.params).id,await boundedJson(req,65536)),{headers});}catch(e){return failure(e);}}
