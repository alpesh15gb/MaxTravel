import {prisma} from "@/lib/db";
import {publicDelivery,publicDeliveryFile} from "@/lib/booking-custody";
import {jsonError} from "@/lib/guard";
export const dynamic="force-dynamic";
export async function GET(req:Request,ctx:{params:Promise<{token:string}>}){try{const token=(await ctx.params).token,id=new URL(req.url).searchParams.get("file");if(!id)return Response.json(await publicDelivery(prisma,token),{headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});const file=await publicDeliveryFile(prisma,token,id);return new Response(new Uint8Array(file.bytes),{headers:{"Cache-Control":"private, no-store","Content-Type":file.mimeType,"X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Content-Security-Policy":"sandbox","Content-Disposition":`attachment; filename="${file.name.replace(/[^a-zA-Z0-9._ -]/g,"_")}"; filename*=UTF-8''${encodeURIComponent(file.name)}`}});}catch(e){return jsonError(e);}}
