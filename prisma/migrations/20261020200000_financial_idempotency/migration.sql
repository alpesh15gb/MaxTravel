CREATE TABLE "FinancialMutation" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "actorId" TEXT NOT NULL,
 "operation" TEXT NOT NULL,
 "requestKey" TEXT NOT NULL,
 "requestHash" TEXT NOT NULL,
 "responseJson" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "FinancialMutation_actorId_operation_requestKey_key" ON "FinancialMutation"("actorId", "operation", "requestKey");
