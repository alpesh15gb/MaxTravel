-- Additive only: historical cancellations intentionally remain unclassified.
-- Opening journal entries and supplier settlements are never rewritten.
ALTER TABLE "Booking" ADD COLUMN "cancellationSupplierCharge" REAL;
ALTER TABLE "Booking" ADD COLUMN "cancellationAgencyFee" REAL;
ALTER TABLE "Booking" ADD COLUMN "cancellationReason" TEXT;
ALTER TABLE "Booking" ADD COLUMN "cancelledAt" DATETIME;
