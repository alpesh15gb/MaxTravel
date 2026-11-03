-- AlterTable
ALTER TABLE "VisaCase" ADD COLUMN "supplierCost" REAL;
ALTER TABLE "VisaCase" ADD COLUMN "travelEndDate" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Booking" (
    "airlineChangeFee" REAL NOT NULL DEFAULT 0,
    "noShowFee" REAL NOT NULL DEFAULT 0,
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
INSERT INTO "new_Booking" ("airline", "bookingDate", "bookingNo", "branchId", "cancellationAgencyFee", "cancellationReason", "cancellationSupplierCharge", "cancelledAt", "createdAt", "currency", "customerId", "fare", "flightNo", "gdsSource", "hotelCheckIn", "hotelCheckOut", "hotelName", "id", "markup", "ownerId", "paymentDueDate", "pnr", "product", "refundId", "reissueOfId", "sector", "sellingPrice", "serviceCaseId", "serviceDescription", "serviceFee", "status", "supplierCost", "supplierCostConfirmed", "supplierId", "taxes", "ticketingDeadline", "travelDate", "travelEndDate", "travelScope", "updatedAt") SELECT "airline", "bookingDate", "bookingNo", "branchId", "cancellationAgencyFee", "cancellationReason", "cancellationSupplierCharge", "cancelledAt", "createdAt", "currency", "customerId", "fare", "flightNo", "gdsSource", "hotelCheckIn", "hotelCheckOut", "hotelName", "id", "markup", "ownerId", "paymentDueDate", "pnr", "product", "refundId", "reissueOfId", "sector", "sellingPrice", "serviceCaseId", "serviceDescription", "serviceFee", "status", "supplierCost", "supplierCostConfirmed", "supplierId", "taxes", "ticketingDeadline", "travelDate", "travelEndDate", "travelScope", "updatedAt" FROM "Booking";
DROP TABLE "Booking";
ALTER TABLE "new_Booking" RENAME TO "Booking";
CREATE UNIQUE INDEX "Booking_bookingNo_key" ON "Booking"("bookingNo");
CREATE INDEX "Booking_serviceCaseId_idx" ON "Booking"("serviceCaseId");
CREATE INDEX "Booking_customerId_idx" ON "Booking"("customerId");
CREATE INDEX "Booking_pnr_idx" ON "Booking"("pnr");
CREATE INDEX "Booking_ticketingDeadline_idx" ON "Booking"("ticketingDeadline");
CREATE TABLE "new_Reissue" (
    "taxDifference" REAL NOT NULL DEFAULT 0,
    "airlineFee" REAL NOT NULL DEFAULT 0,
    "noShowFee" REAL NOT NULL DEFAULT 0,
    "agencyFee" REAL NOT NULL DEFAULT 0,
    "quoteReference" TEXT,
    "quoteExpiresAt" DATETIME,
    "id" TEXT NOT NULL PRIMARY KEY,
    "originalTicketId" TEXT NOT NULL,
    "originalBookingId" TEXT NOT NULL,
    "reissuedBookingId" TEXT,
    "reason" TEXT NOT NULL,
    "fareDifference" REAL NOT NULL DEFAULT 0,
    "penalty" REAL NOT NULL DEFAULT 0,
    "supplierId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reissue_originalTicketId_fkey" FOREIGN KEY ("originalTicketId") REFERENCES "Ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Reissue_originalBookingId_fkey" FOREIGN KEY ("originalBookingId") REFERENCES "Booking" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Reissue_reissuedBookingId_fkey" FOREIGN KEY ("reissuedBookingId") REFERENCES "Booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Reissue_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Reissue" ("createdAt", "fareDifference", "id", "originalBookingId", "originalTicketId", "penalty", "reason", "reissuedBookingId", "status", "supplierId") SELECT "createdAt", "fareDifference", "id", "originalBookingId", "originalTicketId", "penalty", "reason", "reissuedBookingId", "status", "supplierId" FROM "Reissue";
DROP TABLE "Reissue";
ALTER TABLE "new_Reissue" RENAME TO "Reissue";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
