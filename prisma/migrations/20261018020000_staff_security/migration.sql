CREATE TABLE "StaffSession" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" DATETIME NOT NULL, "revokedAt" DATETIME, "agent" TEXT NOT NULL);
CREATE INDEX "StaffSession_userId_expiresAt_idx" ON "StaffSession"("userId", "expiresAt");
CREATE TABLE "StaffMfa" ("userId" TEXT NOT NULL PRIMARY KEY, "secret" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false, "lastStep" INTEGER NOT NULL DEFAULT -1, "recoveryHashes" TEXT NOT NULL DEFAULT '[]', "updatedAt" DATETIME NOT NULL);
CREATE TABLE "StaffRecovery" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "expiresAt" DATETIME NOT NULL, "usedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "StaffRecovery_tokenHash_key" ON "StaffRecovery"("tokenHash");
