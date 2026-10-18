ALTER TABLE "SupplierDue" ADD COLUMN "bookingId" TEXT;
ALTER TABLE "SupplierDue" ADD COLUMN "supplierInvoiceNo" TEXT;

CREATE INDEX "SupplierDue_supplierId_dueDate_idx" ON "SupplierDue"("supplierId", "dueDate");
CREATE INDEX "SupplierDue_bookingId_idx" ON "SupplierDue"("bookingId");

CREATE TABLE "SupplierSettlement" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "dueId" TEXT NOT NULL,
  "amount" REAL NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'OTHER',
  "reference" TEXT,
  "note" TEXT,
  "settledOn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedById" TEXT,
  "requestKey" TEXT NOT NULL,
  "reversedOn" DATETIME,
  "reversedById" TEXT,
  "reversalReason" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupplierSettlement_dueId_fkey" FOREIGN KEY ("dueId") REFERENCES "SupplierDue" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupplierSettlement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SupplierSettlement_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SupplierSettlement_requestKey_key" ON "SupplierSettlement"("requestKey");
CREATE INDEX "SupplierSettlement_dueId_settledOn_idx" ON "SupplierSettlement"("dueId", "settledOn");

-- Preserve each existing aggregate as a single explicitly identified migrated entry.
-- Historical method, reference and actor did not exist and must not be fabricated.
INSERT INTO "SupplierSettlement" ("id", "dueId", "amount", "method", "note", "settledOn", "requestKey", "createdAt")
SELECT 'legacy-settlement-' || "id", "id", "paidAmount", 'MIGRATED',
  'Imported from the existing aggregate balance; payment details were not stored.',
  COALESCE("paidOn", "createdAt"), 'legacy-settlement-' || "id", COALESCE("paidOn", "createdAt")
FROM "SupplierDue"
WHERE "paidAmount" > 0;
