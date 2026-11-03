-- CreateTable
CREATE TABLE "BookingArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BookingArtifact_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BookingArtifact_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClientDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenCipher" TEXT NOT NULL,
    "artifactIds" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "exceptionReason" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientDelivery_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgencyMutation" (
    "actorId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("actorId", "requestKey"),
    CONSTRAINT "AgencyMutation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Booking" (
    "serviceDescription" TEXT,
    "travelScope" TEXT NOT NULL DEFAULT 'UNSPECIFIED',
    "travelEndDate" DATETIME,
    "supplierCostConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "serviceCaseId" TEXT,
    "product" TEXT NOT NULL DEFAULT 'FLIGHT',
    "hotelName" TEXT,
    "hotelCheckIn" DATETIME,
    "hotelCheckOut" DATETIME,
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "pnr" TEXT,
    "airline" TEXT,
    "gdsSource" TEXT,
    "supplierId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ENQUIRY',
    "sector" TEXT,
    "flightNo" TEXT,
    "travelDate" DATETIME,
    "bookingDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticketingDeadline" DATETIME,
    "fare" REAL NOT NULL DEFAULT 0,
    "taxes" REAL NOT NULL DEFAULT 0,
    "markup" REAL NOT NULL DEFAULT 0,
    "serviceFee" REAL NOT NULL DEFAULT 0,
    "sellingPrice" REAL NOT NULL DEFAULT 0,
    "paymentDueDate" DATETIME,
    "cancellationSupplierCharge" REAL,
    "cancellationAgencyFee" REAL,
    "cancellationReason" TEXT,
    "cancelledAt" DATETIME,
    "supplierCost" REAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "ownerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "refundId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "reissueOfId" TEXT,
    CONSTRAINT "Booking_serviceCaseId_fkey" FOREIGN KEY ("serviceCaseId") REFERENCES "ServiceCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Booking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Booking_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Booking_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Booking_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Booking_reissueOfId_fkey" FOREIGN KEY ("reissueOfId") REFERENCES "Booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Booking" ("airline", "bookingDate", "bookingNo", "branchId", "cancellationAgencyFee", "cancellationReason", "cancellationSupplierCharge", "cancelledAt", "createdAt", "currency", "customerId", "fare", "flightNo", "gdsSource", "hotelCheckIn", "hotelCheckOut", "hotelName", "id", "markup", "ownerId", "paymentDueDate", "pnr", "product", "refundId", "reissueOfId", "sector", "sellingPrice", "serviceCaseId", "serviceFee", "status", "supplierCost", "supplierId", "taxes", "ticketingDeadline", "travelDate", "updatedAt") SELECT "airline", "bookingDate", "bookingNo", "branchId", "cancellationAgencyFee", "cancellationReason", "cancellationSupplierCharge", "cancelledAt", "createdAt", "currency", "customerId", "fare", "flightNo", "gdsSource", "hotelCheckIn", "hotelCheckOut", "hotelName", "id", "markup", "ownerId", "paymentDueDate", "pnr", "product", "refundId", "reissueOfId", "sector", "sellingPrice", "serviceCaseId", "serviceFee", "status", "supplierCost", "supplierId", "taxes", "ticketingDeadline", "travelDate", "updatedAt" FROM "Booking";
DROP TABLE "Booking";
ALTER TABLE "new_Booking" RENAME TO "Booking";
CREATE UNIQUE INDEX "Booking_bookingNo_key" ON "Booking"("bookingNo");
CREATE INDEX "Booking_serviceCaseId_idx" ON "Booking"("serviceCaseId");
CREATE INDEX "Booking_customerId_idx" ON "Booking"("customerId");
CREATE INDEX "Booking_pnr_idx" ON "Booking"("pnr");
CREATE INDEX "Booking_ticketingDeadline_idx" ON "Booking"("ticketingDeadline");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

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

-- Existing online values came from authenticated booking-platform snapshots.
UPDATE "Booking" SET "supplierCostConfirmed" = 1 WHERE UPPER(TRIM("gdsSource")) = 'TRIPJACK_API' AND EXISTS (SELECT 1 FROM "PlatformBookingLink" p WHERE p."bookingId" = "Booking"."id");
