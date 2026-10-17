import { prisma } from "./db";
import { hashToken, totpStep, unseal } from "./staff-security";
export async function verifyStaffMfa(userId:string,code:string) {
 return prisma.$transaction(async tx=>{const row=await tx.staffMfa.findUnique({where:{userId}});if(!row?.enabled)return true;
 const recovery=JSON.parse(row.recoveryHashes) as string[];const hash=hashToken(code.trim().toUpperCase());
 if(recovery.includes(hash)){const changed=await tx.staffMfa.updateMany({where:{userId,recoveryHashes:row.recoveryHashes},data:{recoveryHashes:JSON.stringify(recovery.filter(v=>v!==hash))}});return changed.count===1;}
 const step=totpStep(unseal(row.secret,`staff-mfa:${userId}`),code,row.lastStep);if(step===null)return false;
 const changed=await tx.staffMfa.updateMany({where:{userId,lastStep:row.lastStep},data:{lastStep:step}});return changed.count===1;});
}
