import { requireSession,jsonError } from "@/lib/guard";
import { templateMappings,cloudConfig } from "@/lib/meta-cloud";
export async function GET(){try{await requireSession("whatsapp:send");return Response.json({configured:Boolean(cloudConfig()),templates:Object.entries(templateMappings()).map(([key,value])=>({key,...value}))},{headers:{"Cache-Control":"private, no-store"}});}catch(e){return jsonError(e);}}
