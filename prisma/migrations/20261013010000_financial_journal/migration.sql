ALTER TABLE "Booking" ADD COLUMN "paymentDueDate" DATETIME;
ALTER TABLE "VisaCase" ADD COLUMN "paymentDueDate" DATETIME;
CREATE TABLE "FinancialEntry" (
 "id" TEXT NOT NULL PRIMARY KEY, "partyType" TEXT NOT NULL, "partyId" TEXT NOT NULL,
 "sourceType" TEXT NOT NULL, "sourceId" TEXT NOT NULL, "revision" INTEGER NOT NULL,
 "amountMinor" BIGINT NOT NULL, "reference" TEXT NOT NULL, "description" TEXT NOT NULL,
 "dueDate" DATETIME, "effectiveAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "actorId" TEXT, "opening" BOOLEAN NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX "FinancialEntry_sourceType_sourceId_revision_key" ON "FinancialEntry"("sourceType","sourceId","revision");
CREATE INDEX "FinancialEntry_partyType_partyId_effectiveAt_idx" ON "FinancialEntry"("partyType","partyId","effectiveAt");
CREATE INDEX "FinancialEntry_sourceType_sourceId_idx" ON "FinancialEntry"("sourceType","sourceId");

-- No fabricated pre-migration history: every existing source is an opening at deployment.
-- Track zero sources too so later activation/editing posts only the true change.
INSERT INTO "FinancialEntry" (id,partyType,partyId,sourceType,sourceId,revision,amountMinor,reference,description,dueDate,opening)
 SELECT 'opening-booking-'||id,'CUSTOMER',customerId,'Booking',id,1,
 CASE WHEN status IN ('CANCELLED','VOID','REFUNDED') THEN 0 ELSE CAST(ROUND(sellingPrice*100) AS INTEGER) END,
 bookingNo,'Opening booking charge · status '||status,NULL,true FROM Booking WHERE currency='INR';
INSERT INTO "FinancialEntry" (id,partyType,partyId,sourceType,sourceId,revision,amountMinor,reference,description,dueDate,opening)
 SELECT 'opening-case-'||id,'CUSTOMER',customerId,'VisaCase',id,1,CAST(ROUND(sellingPrice*100) AS INTEGER),caseNo,'Opening visa charge',NULL,true FROM VisaCase;
INSERT INTO "FinancialEntry" (id,partyType,partyId,sourceType,sourceId,revision,amountMinor,reference,description,dueDate,opening)
 SELECT 'opening-invoice-'||id,'CUSTOMER',customerId,'Invoice',id,1,
 CASE WHEN bookingId IS NULL AND visaCaseId IS NULL THEN CAST(ROUND(amount*100) AS INTEGER) ELSE 0 END,
 invoiceNo,'Opening invoice charge (linked invoices do not add a charge)',dueDate,true FROM Invoice;
INSERT INTO "FinancialEntry" (id,partyType,partyId,sourceType,sourceId,revision,amountMinor,reference,description,opening)
 SELECT 'opening-payment-'||p.id,'CUSTOMER',p.customerId,'Payment',p.id,1,-CAST(ROUND(p.amount*100) AS INTEGER),p.receiptNo,'Opening receipts',true FROM Payment p
 WHERE p.bookingId IS NULL OR EXISTS (SELECT 1 FROM Booking b WHERE b.id=p.bookingId AND b.currency='INR');
INSERT INTO "FinancialEntry" (id,partyType,partyId,sourceType,sourceId,revision,amountMinor,reference,description,opening)
 SELECT 'opening-refund-'||r.id,'CUSTOMER',r.customerId,'Refund',r.id,1,
 CASE WHEN r.status='PAID' THEN CAST(ROUND(r.amount*100) AS INTEGER) ELSE 0 END,r.refundNo,'Opening paid refunds',true FROM Refund r
 WHERE r.bookingId IS NULL OR EXISTS (SELECT 1 FROM Booking b WHERE b.id=r.bookingId AND b.currency='INR');
INSERT INTO "FinancialEntry" (id,partyType,partyId,sourceType,sourceId,revision,amountMinor,reference,description,dueDate,opening)
 SELECT 'opening-due-'||id,'SUPPLIER',supplierId,'SupplierDue',id,1,CAST(ROUND(amount*100) AS INTEGER),'DUE-'||substr(id,-8),description,dueDate,true FROM SupplierDue;
INSERT INTO "FinancialEntry" (id,partyType,partyId,sourceType,sourceId,revision,amountMinor,reference,description,opening)
 SELECT 'opening-settlement-'||id,'SUPPLIER',supplierId,'SupplierSettlement',id,1,-CAST(ROUND(paidAmount*100) AS INTEGER),'DUE-'||substr(id,-8),'Opening supplier settlements',true FROM SupplierDue;
INSERT INTO Settings (id,key,value) VALUES ('financial-journal-cutover','financialJournal.cutover',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
