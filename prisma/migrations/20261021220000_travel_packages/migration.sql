CREATE TABLE "TravelPackage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "draftJson" TEXT NOT NULL,
  "publishedJson" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "publishedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "TravelPackage_slug_key" ON "TravelPackage"("slug");
CREATE INDEX "TravelPackage_status_publishedAt_idx" ON "TravelPackage"("status", "publishedAt");
