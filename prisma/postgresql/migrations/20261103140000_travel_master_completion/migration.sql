ALTER TABLE "TravellerIdentityDocument" ADD COLUMN "validFrom" TEXT;
ALTER TABLE "TravellerIdentityDocument" ADD COLUMN "validFor" TEXT;
ALTER TABLE "TravellerIdentityDocument" ADD COLUMN "maximumStayDays" TEXT;
ALTER TABLE "BookingTraveller" ADD COLUMN "loyaltyMembershipId" TEXT;
ALTER TABLE "BookingTraveller" ADD COLUMN "loyaltyProgram" TEXT;
ALTER TABLE "BookingTraveller" ADD COLUMN "loyaltyNumberHint" TEXT;
ALTER TABLE "Booking" ADD COLUMN "passportValidityMonths" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Booking" ADD COLUMN "requirementsNote" TEXT;
ALTER TABLE "Document" ADD COLUMN "aadhaarMasked" BOOLEAN NOT NULL DEFAULT false;
