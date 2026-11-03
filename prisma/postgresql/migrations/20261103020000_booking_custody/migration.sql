-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "serviceDescription" TEXT,
ADD COLUMN     "supplierCostConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "travelEndDate" TIMESTAMPTZ(3),
ADD COLUMN     "travelScope" TEXT NOT NULL DEFAULT 'UNSPECIFIED';

-- CreateTable
CREATE TABLE "BookingArtifact" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "ticketId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientDelivery" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenCipher" TEXT NOT NULL,
    "artifactIds" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "exceptionReason" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyMutation" (
    "actorId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgencyMutation_pkey" PRIMARY KEY ("actorId","requestKey")
);

-- CreateIndex
CREATE INDEX "BookingArtifact_bookingId_idx" ON "BookingArtifact"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingArtifact_uploadedById_requestKey_key" ON "BookingArtifact"("uploadedById", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "ClientDelivery_tokenHash_key" ON "ClientDelivery"("tokenHash");

-- CreateIndex
CREATE INDEX "ClientDelivery_bookingId_idx" ON "ClientDelivery"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientDelivery_createdById_requestKey_key" ON "ClientDelivery"("createdById", "requestKey");

-- CreateIndex
CREATE INDEX "AgencyMutation_customerId_idx" ON "AgencyMutation"("customerId");

-- AddForeignKey
ALTER TABLE "BookingArtifact" ADD CONSTRAINT "BookingArtifact_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingArtifact" ADD CONSTRAINT "BookingArtifact_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDelivery" ADD CONSTRAINT "ClientDelivery_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyMutation" ADD CONSTRAINT "AgencyMutation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing online values came from authenticated booking-platform snapshots.
UPDATE "Booking" SET "supplierCostConfirmed" = true WHERE UPPER(TRIM("gdsSource")) = 'TRIPJACK_API' AND EXISTS (SELECT 1 FROM "PlatformBookingLink" p WHERE p."bookingId" = "Booking"."id");
