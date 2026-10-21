CREATE TABLE "PackageMedia" (
 "id" TEXT NOT NULL PRIMARY KEY, "packageId" TEXT NOT NULL,
 "storageName" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "byteSize" INTEGER NOT NULL,
 "width" INTEGER NOT NULL, "height" INTEGER NOT NULL, "sha256" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PackageMedia_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "TravelPackage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PackageMedia_storageName_key" ON "PackageMedia"("storageName");
CREATE INDEX "PackageMedia_packageId_createdAt_idx" ON "PackageMedia"("packageId", "createdAt");
