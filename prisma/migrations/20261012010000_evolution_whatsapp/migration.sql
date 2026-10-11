ALTER TABLE "Customer" ADD COLUMN "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WhatsAppMessage" ADD COLUMN "providerKey" TEXT;
ALTER TABLE "WhatsAppMessage" ADD COLUMN "requestKey" TEXT;
ALTER TABLE "WhatsAppMessage" ADD COLUMN "instance" TEXT;
ALTER TABLE "WhatsAppMessage" ADD COLUMN "recipient" TEXT;
ALTER TABLE "WhatsAppMessage" ADD COLUMN "automation" TEXT;
ALTER TABLE "WhatsAppMessage" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WhatsAppMessage" ADD COLUMN "nextAttempt" DATETIME NOT NULL DEFAULT 0;
UPDATE "WhatsAppMessage" SET "nextAttempt" = CURRENT_TIMESTAMP;
ALTER TABLE "WhatsAppMessage" ADD COLUMN "claimedAt" DATETIME;
ALTER TABLE "WhatsAppMessage" ADD COLUMN "lastError" TEXT;
CREATE UNIQUE INDEX "WhatsAppMessage_providerKey_key" ON "WhatsAppMessage"("providerKey");
CREATE UNIQUE INDEX "WhatsAppMessage_requestKey_key" ON "WhatsAppMessage"("requestKey");
CREATE INDEX "WhatsAppMessage_status_nextAttempt_idx" ON "WhatsAppMessage"("status", "nextAttempt");
CREATE TABLE "WhatsAppInbound" (
 "id" TEXT NOT NULL PRIMARY KEY, "providerKey" TEXT NOT NULL, "phone" TEXT NOT NULL,
 "body" TEXT NOT NULL, "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "matched" BOOLEAN NOT NULL DEFAULT false, "reason" TEXT NOT NULL
);
CREATE UNIQUE INDEX "WhatsAppInbound_providerKey_key" ON "WhatsAppInbound"("providerKey");
