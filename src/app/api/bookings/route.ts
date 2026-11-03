import {salesRecoveryContext} from "@/lib/sales-recovery-context";
import {requireSession,jsonError,ApiError} from "@/lib/guard";
import {prisma} from "@/lib/db";
import {boundedJson} from "@/lib/bounded-json";
import {createManualBatch} from "@/lib/manual-bookings";
import {z} from "zod";
export async function POST(req:Request){try{const user=await requireSession("ticketing:create"),b=await boundedJson(req);if(req.headers.has("x-staff-context")&&req.headers.get("x-staff-context")!==salesRecoveryContext(user))throw new ApiError(409,"Staff session changed. Reload the entry form.");return Response.json(await createManualBatch(prisma,user,{requestKey:b.requestKey,customerId:b.customerId,serviceCaseId:b.serviceCaseId,lines:[b]}));}catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(i=>i.message).join(" ")},{status:400});return jsonError(e);}}
