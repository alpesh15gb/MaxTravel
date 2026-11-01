ALTER TABLE "ServiceCase" ADD COLUMN "legacyReference" TEXT;
ALTER TABLE "ServiceCase" ADD COLUMN "legacyStage" TEXT;
ALTER TABLE "ServiceCase" ADD COLUMN "importSource" TEXT;
ALTER TABLE "ServiceCase" ADD COLUMN "importedAt" TIMESTAMPTZ(3);
CREATE TABLE "DataImportBatch" (
 "id" TEXT NOT NULL PRIMARY KEY, "actorId" TEXT NOT NULL, "requestKey" TEXT NOT NULL,
 "branchId" TEXT NOT NULL, "source" TEXT NOT NULL, "status" TEXT NOT NULL,
 "inputHash" TEXT NOT NULL, "planHash" TEXT NOT NULL, "payload" TEXT NOT NULL,
 "preview" TEXT NOT NULL, "result" TEXT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMPTZ(3) NOT NULL, "committedAt" TIMESTAMPTZ(3)
);
CREATE UNIQUE INDEX "DataImportBatch_actorId_requestKey_key" ON "DataImportBatch"("actorId","requestKey");
CREATE INDEX "DataImportBatch_status_expiresAt_idx" ON "DataImportBatch"("status","expiresAt");
CREATE TABLE "DataImportIdentity" (
 "source" TEXT NOT NULL, "entity" TEXT NOT NULL, "externalId" TEXT NOT NULL,
 "recordId" TEXT NOT NULL, "batchId" TEXT NOT NULL, "rowHash" TEXT NOT NULL,
 "linked" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("source","entity","externalId")
);
CREATE INDEX "DataImportIdentity_batchId_idx" ON "DataImportIdentity"("batchId");
CREATE INDEX "DataImportIdentity_entity_recordId_idx" ON "DataImportIdentity"("entity","recordId");
