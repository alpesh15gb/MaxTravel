import {requireSession,jsonError,ApiError} from "@/lib/guard";
import {prisma} from "@/lib/db";
import {loyaltyForFlight} from "@/lib/customer-master";
export async function GET(req:Request,ctx:{params:Promise<{id:string}>}){try{const u=await requireSession("traveller:view"),q=new URL(req.url).searchParams,carrier=q.get("carrier")??"",date=q.get("date")??"";if(!/^[A-Z0-9]{2}$/.test(carrier)||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new ApiError(400,"Choose an airline code and travel date.");return Response.json(await loyaltyForFlight(prisma,u,(await ctx.params).id,q.get("traveller")??"",carrier,date),{headers:{"Cache-Control":"private, no-store"}});}catch(e){return jsonError(e);}}
