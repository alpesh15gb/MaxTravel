CREATE TABLE "WhatsAppAttachment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppAttachment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WhatsAppAttachment_storageKey_key" ON "WhatsAppAttachment"("storageKey");
CREATE INDEX "WhatsAppAttachment_customerId_createdAt_idx" ON "WhatsAppAttachment"("customerId", "createdAt");
ALTER TABLE "WhatsAppMessage" ADD COLUMN "attachmentId" TEXT REFERENCES "WhatsAppAttachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "WhatsAppMessage_attachmentId_idx" ON "WhatsAppMessage"("attachmentId");
