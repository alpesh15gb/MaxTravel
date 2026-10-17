import {boundedJson} from "@/lib/bounded-json";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { ApiError,jsonError } from "@/lib/guard";
import { hashToken } from "@/lib/staff-security";
import { verifyStaffMfa } from "@/lib/staff-mfa";
import {clientIp} from "@/lib/rate-limit";
import {isLockedOut,recordFailure} from "@/lib/staff-auth-limit";
export async function POST(req:Request){try{const b=await boundedJson(req);const token=String(b.token??"");const bucket=`ip:recovery:${clientIp(req)??"unknown"}`;if(await isLockedOut(bucket))throw new ApiError(429,"Too many attempts. Try again later.");const password=String(b.password??"");if(password.length<12||Buffer.byteLength(password)>72||!/[a-zA-Z]/.test(password)||!/[^a-zA-Z]/.test(password))throw new ApiError(400,"Use 12 or more characters including a letter and a number or symbol; maximum 72 bytes.");
 const recovery=/^[a-f0-9]{64}$/.test(token)?await prisma.staffRecovery.findUnique({where:{tokenHash:hashToken(token)}}):null;
 const account=recovery?await prisma.user.findUnique({where:{id:recovery.userId}}):null;
 if(!recovery||recovery.usedAt||recovery.expiresAt.getTime()<=Date.now()||!account?.active||!(await verifyStaffMfa(account.id,String(b.code??"")))){await recordFailure(bucket);throw new ApiError(400,"Recovery link or authenticator code is invalid or expired.");}
 const passwordHash=await bcrypt.hash(password,12);
 await prisma.$transaction(async tx=>{const used=await tx.staffRecovery.updateMany({where:{id:recovery.id,usedAt:null,expiresAt:{gt:new Date()}},data:{usedAt:new Date()}});if(used.count!==1)throw new ApiError(409,"Recovery link was already used.");await tx.user.update({where:{id:account.id},data:{passwordHash}});await tx.staffSession.updateMany({where:{userId:account.id,revokedAt:null},data:{revokedAt:new Date()}});await tx.staffRecovery.updateMany({where:{userId:account.id,usedAt:null},data:{usedAt:new Date()}});await tx.auditLog.create({data:{userId:account.id,action:"PASSWORD_RECOVERED",entity:"User",entityId:account.id}});});return Response.json({ok:true});}catch(e){return jsonError(e);}}
