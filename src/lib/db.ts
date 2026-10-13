import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["warn", "error"],
    // Financial writes include their journal and audit in one transaction. Allow the
    // complete write to finish on slower single-office disks rather than expire at 5s.
    transactionOptions: { maxWait: 10000, timeout: 20000 },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
