import {prisma} from "@/lib/db";
import {requireSession,ApiError,jsonError} from "@/lib/guard";
import {boundedJson} from "@/lib/bounded-json";
import {chatHome,chatUnread,openChat} from "@/lib/internal-chat";
import {salesRecoveryContext} from "@/lib/sales-recovery-context";
import {z} from "zod";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
export async function GET(req:Request){try{const user=await requireSession("chat:use");return Response.json(new URL(req.url).searchParams.get("mode")==="badge"?{unread:await chatUnread(prisma,user)}:await chatHome(prisma,user),{headers});}catch(e){return jsonError(e);}}
export async function POST(req:Request){try{const user=await requireSession("chat:use");if(req.headers.get("x-staff-context")!==salesRecoveryContext(user))throw new ApiError(409,"Staff session or access changed. Reload messages before continuing.");return Response.json(await openChat(prisma,user,await boundedJson(req,8192)),{headers});}catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(i=>i.message).join(" ")},{status:400,headers});return jsonError(e);}}
