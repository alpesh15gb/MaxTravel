import {salesRecoveryContext} from "@/lib/sales-recovery-context";
import {requireSession,jsonError,ApiError} from "@/lib/guard";
import {prisma} from "@/lib/db";
import {boundedJson} from "@/lib/bounded-json";
import {createManualBatch} from "@/lib/manual-bookings";
import {z} from "zod";
export async function POST(req:Request){try{const user=await requireSession("ticketing:create"),body=await boundedJson(req);if(req.headers.get("x-staff-context")!==salesRecoveryContext(user))throw new ApiError(409,"Staff session changed. Reload the entry form.");if(!body.requestKey)throw new ApiError(400,"A booking request reference is required.");return Response.json(await createManualBatch(prisma,user,body));}catch(e){if(e instanceof z.ZodError)return Response.json({error:e.issues.map(i=>i.message).join(" ")},{status:400});return jsonError(e);}}
