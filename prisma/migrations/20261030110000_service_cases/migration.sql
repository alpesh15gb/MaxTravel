-- CreateTable
CREATE TABLE "ServiceCase" (
    "createdById" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "nextFollowUpAt" DATETIME,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ServiceCase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServiceCase_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceCaseEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "actorId" TEXT,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "permission" TEXT,
    "href" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceCaseEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ServiceCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceCaseMutation" (
    "actorId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("actorId", "requestKey"),
    CONSTRAINT "ServiceCaseMutation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ServiceCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_VisaCase" (
    "serviceCaseId" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "visaType" TEXT NOT NULL,
    "visaCategory" TEXT,
    "destination" TEXT NOT NULL,
    "travelDate" DATETIME,
    "intendedStay" TEXT,
    "applicationDate" DATETIME,
    "submissionDate" DATETIME,
    "appointmentDate" DATETIME,
    "biometricsDate" DATETIME,
    "expectedDecisionDate" DATETIME,
    "decisionDate" DATETIME,
    "visaOutcome" TEXT,
    "visaValidityUntil" DATETIME,
    "visaFee" REAL NOT NULL DEFAULT 0,
    "serviceFee" REAL NOT NULL DEFAULT 0,
    "sellingPrice" REAL NOT NULL DEFAULT 0,
    "paymentDueDate" DATETIME,
    "amountReceived" REAL NOT NULL DEFAULT 0,
    "supplierId" TEXT,
    "ownerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "internalNotes" TEXT,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VisaCase_serviceCaseId_fkey" FOREIGN KEY ("serviceCaseId") REFERENCES "ServiceCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VisaCase_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VisaCase_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "VisaStage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VisaCase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "VisaCase_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VisaCase_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_VisaCase" ("amountReceived", "applicationDate", "appointmentDate", "biometricsDate", "branchId", "caseNo", "closedAt", "createdAt", "customerId", "decisionDate", "destination", "expectedDecisionDate", "id", "intendedStay", "internalNotes", "ownerId", "paymentDueDate", "sellingPrice", "serviceFee", "stageId", "submissionDate", "supplierId", "travelDate", "updatedAt", "visaCategory", "visaFee", "visaOutcome", "visaType", "visaValidityUntil") SELECT "amountReceived", "applicationDate", "appointmentDate", "biometricsDate", "branchId", "caseNo", "closedAt", "createdAt", "customerId", "decisionDate", "destination", "expectedDecisionDate", "id", "intendedStay", "internalNotes", "ownerId", "paymentDueDate", "sellingPrice", "serviceFee", "stageId", "submissionDate", "supplierId", "travelDate", "updatedAt", "visaCategory", "visaFee", "visaOutcome", "visaType", "visaValidityUntil" FROM "VisaCase";
DROP TABLE "VisaCase";
ALTER TABLE "new_VisaCase" RENAME TO "VisaCase";
CREATE UNIQUE INDEX "VisaCase_caseNo_key" ON "VisaCase"("caseNo");
CREATE INDEX "VisaCase_customerId_idx" ON "VisaCase"("customerId");
CREATE INDEX "VisaCase_stageId_idx" ON "VisaCase"("stageId");
CREATE TABLE "new_Booking" (
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
INSERT INTO "new_Booking" ("airline", "bookingDate", "bookingNo", "branchId", "cancellationAgencyFee", "cancellationReason", "cancellationSupplierCharge", "cancelledAt", "createdAt", "currency", "customerId", "fare", "flightNo", "gdsSource", "hotelCheckIn", "hotelCheckOut", "hotelName", "id", "markup", "ownerId", "paymentDueDate", "pnr", "product", "refundId", "reissueOfId", "sector", "sellingPrice", "serviceFee", "status", "supplierCost", "supplierId", "taxes", "ticketingDeadline", "travelDate", "updatedAt") SELECT "airline", "bookingDate", "bookingNo", "branchId", "cancellationAgencyFee", "cancellationReason", "cancellationSupplierCharge", "cancelledAt", "createdAt", "currency", "customerId", "fare", "flightNo", "gdsSource", "hotelCheckIn", "hotelCheckOut", "hotelName", "id", "markup", "ownerId", "paymentDueDate", "pnr", "product", "refundId", "reissueOfId", "sector", "sellingPrice", "serviceFee", "status", "supplierCost", "supplierId", "taxes", "ticketingDeadline", "travelDate", "updatedAt" FROM "Booking";
DROP TABLE "Booking";
ALTER TABLE "new_Booking" RENAME TO "Booking";
CREATE UNIQUE INDEX "Booking_bookingNo_key" ON "Booking"("bookingNo");
CREATE INDEX "Booking_customerId_idx" ON "Booking"("customerId");
CREATE INDEX "Booking_pnr_idx" ON "Booking"("pnr");
CREATE INDEX "Booking_ticketingDeadline_idx" ON "Booking"("ticketingDeadline");
CREATE TABLE "new_SalesLead" (
    "serviceCaseId" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "product" TEXT NOT NULL DEFAULT 'FLIGHT',
    "stage" TEXT NOT NULL DEFAULT 'NEW',
    "budgetMinor" INTEGER NOT NULL DEFAULT 0,
    "destination" TEXT,
    "travelDate" DATETIME,
    "followUpAt" DATETIME,
    "lostReason" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SalesLead_serviceCaseId_fkey" FOREIGN KEY ("serviceCaseId") REFERENCES "ServiceCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SalesLead" ("branchId", "budgetMinor", "createdAt", "customerId", "destination", "followUpAt", "id", "lostReason", "notes", "ownerId", "product", "source", "stage", "title", "travelDate", "updatedAt") SELECT "branchId", "budgetMinor", "createdAt", "customerId", "destination", "followUpAt", "id", "lostReason", "notes", "ownerId", "product", "source", "stage", "title", "travelDate", "updatedAt" FROM "SalesLead";
DROP TABLE "SalesLead";
ALTER TABLE "new_SalesLead" RENAME TO "SalesLead";
CREATE INDEX "SalesLead_branchId_ownerId_stage_idx" ON "SalesLead"("branchId", "ownerId", "stage");
CREATE INDEX "SalesLead_customerId_idx" ON "SalesLead"("customerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCase_caseNo_key" ON "ServiceCase"("caseNo");

-- CreateIndex
CREATE INDEX "ServiceCase_branchId_ownerId_status_idx" ON "ServiceCase"("branchId", "ownerId", "status");

-- CreateIndex
CREATE INDEX "ServiceCase_customerId_createdAt_idx" ON "ServiceCase"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceCase_nextFollowUpAt_idx" ON "ServiceCase"("nextFollowUpAt");

-- CreateIndex
CREATE INDEX "ServiceCaseEvent_caseId_at_idx" ON "ServiceCaseEvent"("caseId", "at");

-- Preserve one identity across existing accepted quotes and their reissue chain.
CREATE TEMP TABLE "case_roots" ("bookingId" TEXT PRIMARY KEY,"rootId" TEXT NOT NULL);
INSERT INTO "case_roots"
WITH RECURSIVE roots(id,rootId,depth) AS (
 SELECT id,id,0 FROM Booking WHERE reissueOfId IS NULL
 UNION ALL SELECT b.id,r.rootId,r.depth+1 FROM Booking b JOIN roots r ON b.reissueOfId=r.id WHERE r.depth<100
) SELECT id,rootId FROM roots;
INSERT OR IGNORE INTO "case_roots" SELECT id,id FROM Booking;
CREATE TEMP TABLE "case_map" ("entity" TEXT,"recordId" TEXT,"sourceKey" TEXT,PRIMARY KEY("entity","recordId"));
INSERT INTO "case_map" SELECT 'SalesLead',id,'lead-'||id FROM SalesLead;
INSERT INTO "case_map" SELECT 'VisaCase',id,'visa-'||id FROM VisaCase;
INSERT INTO "case_map"
SELECT 'Booking',b.id,COALESCE((SELECT 'lead-'||l.id FROM SalesQuote q JOIN SalesLead l ON l.id=q.leadId WHERE q.bookingId=r.rootId AND l.customerId=b.customerId ORDER BY q.version LIMIT 1),'booking-'||r.rootId)
FROM Booking b JOIN case_roots r ON r.bookingId=b.id;
CREATE TEMP TABLE "case_sources" AS
 SELECT 'lead-'||id AS sourceKey,customerId,branchId,ownerId,product AS service,title,createdAt FROM SalesLead
 UNION ALL SELECT 'visa-'||id,customerId,branchId,ownerId,'VISA',destination||' · '||visaType,createdAt FROM VisaCase
 UNION ALL SELECT 'booking-'||id,customerId,branchId,ownerId,product,COALESCE(sector,hotelName,bookingNo),createdAt FROM Booking WHERE 'booking-'||id IN (SELECT sourceKey FROM case_map);
INSERT INTO ServiceCase(id,caseNo,customerId,branchId,ownerId,createdById,service,title,status,createdAt,updatedAt)
SELECT 'legacy-case-'||s.sourceKey,'CASE-'||strftime('%Y','now')||'-'||printf('%04d',ROW_NUMBER() OVER(ORDER BY s.createdAt,s.sourceKey)),s.customerId,s.branchId,s.ownerId,s.ownerId,s.service,s.title,'OPEN',s.createdAt,CURRENT_TIMESTAMP
FROM case_sources s JOIN Customer c ON c.id=s.customerId JOIN User u ON u.id=s.ownerId;
UPDATE SalesLead SET serviceCaseId=(SELECT 'legacy-case-'||sourceKey FROM case_map WHERE entity='SalesLead' AND recordId=SalesLead.id) WHERE EXISTS(SELECT 1 FROM ServiceCase WHERE id='legacy-case-lead-'||SalesLead.id);
UPDATE VisaCase SET serviceCaseId='legacy-case-visa-'||id;
UPDATE Booking SET serviceCaseId=(SELECT 'legacy-case-'||sourceKey FROM case_map WHERE entity='Booking' AND recordId=Booking.id);
INSERT INTO Settings(id,key,value) VALUES('migration-service-case-counter','counter.CASE',CAST((SELECT COUNT(*) FROM ServiceCase) AS TEXT)) ON CONFLICT(key) DO UPDATE SET value=CAST(MAX(CAST(Settings.value AS INTEGER),CAST(excluded.value AS INTEGER)) AS TEXT);
INSERT INTO ServiceCaseEvent(id,caseId,actorId,kind,summary,at)
SELECT 'backfill-'||id,id,NULL,'IMPORTED','Existing request linked during case-tracking rollout; original service references retained',CURRENT_TIMESTAMP FROM ServiceCase;
-- Historic source audits retain their actual timestamp and actor, without exposing their raw detail.
INSERT OR IGNORE INTO case_map SELECT 'SalesQuote',q.id,m.sourceKey FROM SalesQuote q JOIN case_map m ON m.entity='SalesLead' AND m.recordId=q.leadId;
INSERT OR IGNORE INTO case_map SELECT 'Document',d.id,m.sourceKey FROM Document d JOIN case_map m ON m.entity='VisaCase' AND m.recordId=d.visaCaseId;
INSERT OR IGNORE INTO case_map SELECT 'Invoice',i.id,m.sourceKey FROM Invoice i JOIN case_map m ON (m.entity='Booking' AND m.recordId=i.bookingId) OR (m.entity='VisaCase' AND m.recordId=i.visaCaseId);
INSERT OR IGNORE INTO case_map SELECT 'Payment',p.id,m.sourceKey FROM Payment p JOIN case_map m ON (m.entity='Booking' AND m.recordId=p.bookingId) OR (m.entity='VisaCase' AND m.recordId=p.visaCaseId) OR (m.entity='Invoice' AND m.recordId=p.invoiceId);
INSERT OR IGNORE INTO case_map SELECT 'Refund',r.id,m.sourceKey FROM Refund r JOIN case_map m ON (m.entity='Booking' AND m.recordId=r.bookingId) OR (m.entity='Invoice' AND m.recordId=r.invoiceId);
INSERT OR IGNORE INTO case_map SELECT 'Task',t.id,m.sourceKey FROM Task t JOIN case_map m ON (m.entity='Booking' AND m.recordId=t.bookingId) OR (m.entity='VisaCase' AND m.recordId=t.visaCaseId);
INSERT OR IGNORE INTO case_map SELECT 'Ticket',t.id,m.sourceKey FROM Ticket t JOIN case_map m ON m.entity='Booking' AND m.recordId=t.bookingId;
INSERT OR IGNORE INTO case_map SELECT 'Reissue',r.id,m.sourceKey FROM Reissue r JOIN case_map m ON m.entity='Booking' AND m.recordId=r.originalBookingId;
INSERT INTO ServiceCaseEvent(id,caseId,actorId,kind,summary,permission,href,at)
SELECT 'historic-'||a.id,'legacy-case-'||m.sourceKey,a.userId,'RECORD',a.entity||': '||lower(replace(a.action,'_',' ')),
 CASE a.entity WHEN 'Booking' THEN 'ticketing:view' WHEN 'Ticket' THEN 'ticketing:view' WHEN 'Reissue' THEN 'ticketing:view' WHEN 'VisaCase' THEN 'visa:view' WHEN 'Payment' THEN 'payment:view' WHEN 'Invoice' THEN 'invoice:view' WHEN 'Refund' THEN 'refund:view' WHEN 'Task' THEN 'task:view' WHEN 'Document' THEN 'document:view' ELSE 'customer:view' END,
 CASE a.entity WHEN 'Booking' THEN '/ticketing/'||a.entityId WHEN 'VisaCase' THEN '/visa/'||a.entityId WHEN 'SalesLead' THEN '/sales?lead='||a.entityId WHEN 'Document' THEN '/documents?focus='||a.entityId WHEN 'Payment' THEN '/payments' WHEN 'Invoice' THEN '/payments?focus='||a.entityId WHEN 'Refund' THEN '/refunds?focus='||a.entityId WHEN 'Task' THEN '/tasks?focus='||a.entityId ELSE NULL END,a.at
FROM AuditLog a JOIN case_map m ON m.entity=a.entity AND m.recordId=a.entityId JOIN ServiceCase c ON c.id='legacy-case-'||m.sourceKey;
DROP TABLE case_sources;
DROP TABLE case_map;
DROP TABLE case_roots;

CREATE INDEX "Booking_serviceCaseId_idx" ON "Booking"("serviceCaseId");
CREATE INDEX "VisaCase_serviceCaseId_idx" ON "VisaCase"("serviceCaseId");
CREATE INDEX "SalesLead_serviceCaseId_idx" ON "SalesLead"("serviceCaseId");
