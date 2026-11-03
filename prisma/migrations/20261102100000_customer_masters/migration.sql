ALTER TABLE "Customer" ADD COLUMN "profileData" TEXT;
ALTER TABLE "Traveller" ADD COLUMN "profileData" TEXT;
CREATE TABLE "TravellerLoyaltyMembership" (
 "id" TEXT NOT NULL PRIMARY KEY, "travellerId" TEXT NOT NULL, "category" TEXT NOT NULL,
 "providerName" TEXT NOT NULL, "programName" TEXT NOT NULL, "programKey" TEXT NOT NULL,
 "carrierCodes" TEXT NOT NULL DEFAULT '[]', "memberNumber" TEXT NOT NULL, "numberLookup" TEXT NOT NULL,
 "memberName" TEXT, "tier" TEXT, "expiryDate" TEXT, "preferred" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
 CONSTRAINT "TravellerLoyaltyMembership_travellerId_fkey" FOREIGN KEY ("travellerId") REFERENCES "Traveller"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "traveller_loyalty_program_number_key" ON "TravellerLoyaltyMembership"("travellerId","programKey","numberLookup");
CREATE INDEX "TravellerLoyaltyMembership_travellerId_category_idx" ON "TravellerLoyaltyMembership"("travellerId","category");
CREATE INDEX "TravellerLoyaltyMembership_expiryDate_idx" ON "TravellerLoyaltyMembership"("expiryDate");
CREATE TABLE "TravellerIdentityDocument" (
 "id" TEXT NOT NULL PRIMARY KEY, "travellerId" TEXT NOT NULL, "kind" TEXT NOT NULL,
 "documentNumber" TEXT NOT NULL, "numberLookup" TEXT NOT NULL, "issuingCountry" TEXT NOT NULL,
 "nationality" TEXT, "issueDate" TEXT, "expiryDate" TEXT, "placeOfIssue" TEXT, "visaType" TEXT, "entries" TEXT,
 "primaryPassport" BOOLEAN NOT NULL DEFAULT false, "fileDocumentId" TEXT,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
 CONSTRAINT "TravellerIdentityDocument_travellerId_fkey" FOREIGN KEY ("travellerId") REFERENCES "Traveller"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "TravellerIdentityDocument_fileDocumentId_fkey" FOREIGN KEY ("fileDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "traveller_identity_number_key" ON "TravellerIdentityDocument"("travellerId","kind","issuingCountry","numberLookup");
CREATE INDEX "TravellerIdentityDocument_travellerId_idx" ON "TravellerIdentityDocument"("travellerId");
CREATE INDEX "TravellerIdentityDocument_expiryDate_idx" ON "TravellerIdentityDocument"("expiryDate");
CREATE TABLE "MasterMutation" (
 "actorId" TEXT NOT NULL, "requestKey" TEXT NOT NULL, "bodyHash" TEXT NOT NULL,
 "customerId" TEXT NOT NULL, "result" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("actorId","requestKey"),
 CONSTRAINT "MasterMutation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "MasterMutation_customerId_idx" ON "MasterMutation"("customerId");
