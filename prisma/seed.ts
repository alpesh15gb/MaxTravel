import { PrismaClient } from "@prisma/client";
import { initializeReferenceData } from "../src/lib/bootstrap";

const prisma = new PrismaClient();

async function main() {
  await prisma.$transaction((tx) => initializeReferenceData(tx));
  console.log("Operational roles and visa workflow initialized. No accounts or sample records created. Open /setup to configure your agency.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
