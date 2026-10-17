// Authorised server operator only. Deliver the generated URL privately.
import {PrismaClient} from "@prisma/client";
import {randomBytes,randomUUID,createHash} from "node:crypto";
import {existsSync} from "node:fs";
if(!process.env.DATABASE_URL&&existsSync(".env")&&process.loadEnvFile)process.loadEnvFile();
const email=process.argv[2]?.trim().toLowerCase();if(!email)throw Error("Usage: node scripts/staff-recovery.mjs staff@example.com");const origin=new URL(process.env.APP_ORIGIN??"");if(origin.protocol!=="https:"&&!["localhost","127.0.0.1"].includes(origin.hostname))throw Error("A secure APP_ORIGIN is required.");
const db=new PrismaClient();try{const user=await db.user.findUnique({where:{email}});if(!user?.active)throw Error("Active staff account not found.");const token=randomBytes(32).toString("hex");await db.$transaction(async tx=>{await tx.staffRecovery.updateMany({where:{userId:user.id,usedAt:null},data:{usedAt:new Date()}});await tx.staffRecovery.create({data:{id:randomUUID(),userId:user.id,tokenHash:createHash("sha256").update(token).digest("hex"),expiresAt:new Date(Date.now()+15*60*1000)}});await tx.auditLog.create({data:{action:"RECOVERY_LINK_ISSUED_BY_SERVER_OPERATOR",entity:"User",entityId:user.id}});});console.log(`Private one-use link; expires in 15 minutes: ${origin.origin}/recover#${token}`);}finally{await db.$disconnect();}
