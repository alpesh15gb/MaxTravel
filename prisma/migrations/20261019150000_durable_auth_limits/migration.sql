CREATE TABLE "StaffAuthFailure" ("id" TEXT NOT NULL PRIMARY KEY,"keyHash" TEXT NOT NULL,"at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "StaffAuthFailure_keyHash_at_idx" ON "StaffAuthFailure"("keyHash","at");
