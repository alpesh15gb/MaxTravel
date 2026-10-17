import {prisma} from "./db";
import {hashToken} from "./staff-security";
import {ACCOUNT_POLICY,ADDRESS_POLICY} from "./rate-limit";
const policy=(key:string)=>key.startsWith("ip:")?ADDRESS_POLICY:ACCOUNT_POLICY;
export async function isLockedOut(key:string){const p=policy(key);return (await prisma.staffAuthFailure.count({where:{keyHash:hashToken(key),at:{gt:new Date(Date.now()-p.windowMs)}}}))>=p.limit;}
export async function recordFailure(key:string){await prisma.$transaction([prisma.staffAuthFailure.deleteMany({where:{at:{lt:new Date(Date.now()-Math.max(ACCOUNT_POLICY.windowMs,ADDRESS_POLICY.windowMs))}}}),prisma.staffAuthFailure.create({data:{keyHash:hashToken(key)}})]);}
export async function clearFailures(key:string){await prisma.staffAuthFailure.deleteMany({where:{keyHash:hashToken(key)}});}
export async function retryAfterSeconds(key:string){const p=policy(key);const oldest=await prisma.staffAuthFailure.findFirst({where:{keyHash:hashToken(key),at:{gt:new Date(Date.now()-p.windowMs)}},orderBy:{at:"asc"}});return oldest?Math.max(1,Math.ceil((oldest.at.getTime()+p.windowMs-Date.now())/1000)):1;}
