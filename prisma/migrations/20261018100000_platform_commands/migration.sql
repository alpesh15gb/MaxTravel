CREATE TABLE "PlatformCommand" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "bookingId" TEXT NOT NULL,
 "actorId" TEXT NOT NULL,
 "request" TEXT NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'STARTED',
 "response" TEXT,
 "httpStatus" INTEGER,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "PlatformCommand_bookingId_createdAt_idx" ON "PlatformCommand"("bookingId", "createdAt");
ALTER TABLE "PlatformBookingLink" ADD COLUMN "documentsCurrent" BOOLEAN NOT NULL DEFAULT true;
