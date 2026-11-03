-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SupplierDue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierId" TEXT NOT NULL,
    "bookingId" TEXT,
    "visaCaseId" TEXT,
    "description" TEXT NOT NULL,
    "supplierInvoiceNo" TEXT,
    "amount" REAL NOT NULL,
    "paidAmount" REAL NOT NULL DEFAULT 0,
    "dueDate" DATETIME NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidOn" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupplierDue_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SupplierDue_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SupplierDue_visaCaseId_fkey" FOREIGN KEY ("visaCaseId") REFERENCES "VisaCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SupplierDue" ("amount", "bookingId", "createdAt", "description", "dueDate", "id", "paid", "paidAmount", "paidOn", "supplierId", "supplierInvoiceNo") SELECT "amount", "bookingId", "createdAt", "description", "dueDate", "id", "paid", "paidAmount", "paidOn", "supplierId", "supplierInvoiceNo" FROM "SupplierDue";
DROP TABLE "SupplierDue";
ALTER TABLE "new_SupplierDue" RENAME TO "SupplierDue";
CREATE INDEX "SupplierDue_supplierId_dueDate_idx" ON "SupplierDue"("supplierId", "dueDate");
CREATE INDEX "SupplierDue_bookingId_idx" ON "SupplierDue"("bookingId");
CREATE INDEX "SupplierDue_visaCaseId_idx" ON "SupplierDue"("visaCaseId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
