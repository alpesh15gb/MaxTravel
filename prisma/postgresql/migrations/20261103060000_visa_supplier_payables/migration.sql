-- AlterTable
ALTER TABLE "SupplierDue" ADD COLUMN     "visaCaseId" TEXT;

-- CreateIndex
CREATE INDEX "SupplierDue_visaCaseId_idx" ON "SupplierDue"("visaCaseId");

-- AddForeignKey
ALTER TABLE "SupplierDue" ADD CONSTRAINT "SupplierDue_visaCaseId_fkey" FOREIGN KEY ("visaCaseId") REFERENCES "VisaCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
