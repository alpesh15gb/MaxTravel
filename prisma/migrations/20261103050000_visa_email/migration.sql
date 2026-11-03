-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ClientEmail" (
    "visaCaseId" TEXT,
    "collectionId" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "bookingId" TEXT,
    "deliveryId" TEXT,
    "createdById" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "messageId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" DATETIME,
    "sentAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientEmail_visaCaseId_fkey" FOREIGN KEY ("visaCaseId") REFERENCES "VisaCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClientEmail_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "PaymentCollection" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClientEmail_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClientEmail_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClientEmail_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "ClientDelivery" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ClientEmail" ("attempts", "body", "bodyHash", "bookingId", "claimedAt", "collectionId", "createdAt", "createdById", "customerId", "deliveryId", "id", "lastError", "messageId", "purpose", "recipient", "requestKey", "sentAt", "status", "subject") SELECT "attempts", "body", "bodyHash", "bookingId", "claimedAt", "collectionId", "createdAt", "createdById", "customerId", "deliveryId", "id", "lastError", "messageId", "purpose", "recipient", "requestKey", "sentAt", "status", "subject" FROM "ClientEmail";
DROP TABLE "ClientEmail";
ALTER TABLE "new_ClientEmail" RENAME TO "ClientEmail";
CREATE UNIQUE INDEX "ClientEmail_messageId_key" ON "ClientEmail"("messageId");
CREATE INDEX "ClientEmail_status_createdAt_idx" ON "ClientEmail"("status", "createdAt");
CREATE UNIQUE INDEX "ClientEmail_createdById_requestKey_key" ON "ClientEmail"("createdById", "requestKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
