import {normalizeTextSearch} from "./search-parity";
import {PrismaClient as PostgresClient} from "@maxtravel/prisma-postgresql";
import { PrismaClient } from "@prisma/client";
import {installSensitiveEncryption} from "./sensitive-encryption";

// Both clients are generated from the same canonical model; only the SQL provider differs.
const DatabaseClient:typeof PrismaClient=/^postgres(?:ql)?:/.test(process.env.DATABASE_URL??"")?PostgresClient as unknown as typeof PrismaClient:PrismaClient;
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new DatabaseClient({
    log: ["warn", "error"],
    // Financial writes include their journal and audit in one transaction. Allow the
    // complete write to finish on slower single-office disks rather than expire at 5s.
    transactionOptions: { maxWait: 10000, timeout: 20000,isolationLevel:"Serializable" },
  }) as unknown as PrismaClient;

if(!globalForPrisma.prisma){
 if(/^postgres(?:ql)?:/.test(process.env.DATABASE_URL??""))prisma.$use(async(params,next)=>{if(params.args?.where)params.args.where=normalizeTextSearch(params.args.where);return next(params);});
 installSensitiveEncryption(prisma);
}
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
