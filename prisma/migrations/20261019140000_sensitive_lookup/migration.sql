ALTER TABLE "Traveller" ADD COLUMN "passportLookup" TEXT;
CREATE INDEX "Traveller_passportLookup_idx" ON "Traveller"("passportLookup");
