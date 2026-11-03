-- AlterTable
ALTER TABLE "ClientEmail" ADD COLUMN     "visaCaseId" TEXT;

-- AddForeignKey
ALTER TABLE "ClientEmail" ADD CONSTRAINT "ClientEmail_visaCaseId_fkey" FOREIGN KEY ("visaCaseId") REFERENCES "VisaCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
