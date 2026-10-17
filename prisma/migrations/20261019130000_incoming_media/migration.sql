CREATE TABLE "IncomingMedia" ("id" TEXT NOT NULL PRIMARY KEY,"providerKey" TEXT NOT NULL,"mediaId" TEXT NOT NULL,"mimeType" TEXT NOT NULL,"filename" TEXT NOT NULL,"expectedHash" TEXT NOT NULL,"storageKey" TEXT,"sha256" TEXT,"size" INTEGER,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "IncomingMedia_providerKey_key" ON "IncomingMedia"("providerKey");
CREATE INDEX "IncomingMedia_createdAt_idx" ON "IncomingMedia"("createdAt");
ALTER TABLE "IncomingMedia" ADD COLUMN "documentId" TEXT;
CREATE UNIQUE INDEX "IncomingMedia_documentId_key" ON "IncomingMedia"("documentId");
ALTER TABLE "Document" ADD COLUMN "sensitive" BOOLEAN NOT NULL DEFAULT false;
