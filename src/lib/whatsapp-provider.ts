import "server-only";
import { cloudConfig,cloudRequest } from "./meta-cloud";
import { evolutionConfig,evolutionState } from "./evolution";
export function messagingConfig(){if(process.env.WA_PROVIDER==="meta")return cloudConfig();if(process.env.WA_PROVIDER==="evolution")return evolutionConfig();return null;}
export function isCloud(){return process.env.WA_PROVIDER==="meta";}
export async function messagingState(){if(isCloud()){const config=cloudConfig();if(!config)return "unconfigured";await cloudRequest(`${config.phoneId}?fields=id`);return "open";}return evolutionState();}

import { prisma } from "./db";
export async function cloudReplyWindow(customerId:string,phone:string){const config=cloudConfig();if(!config)return false;const inbound=await prisma.whatsAppMessage.findFirst({where:{thread:{customerId},direction:"IN",recipient:phone,providerKey:{startsWith:`meta:${config.phoneId}:`}},orderBy:{at:"desc"},select:{at:true}});return Boolean(inbound&&inbound.at.getTime()<=Date.now()&&Date.now()-inbound.at.getTime()<24*3600000);}
