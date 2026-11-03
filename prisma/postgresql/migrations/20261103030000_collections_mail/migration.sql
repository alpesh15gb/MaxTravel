-- CreateTable
CREATE TABLE "ClientEmail" (
    "collectionId" TEXT,
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "bookingId" TEXT,
    "deliveryId" TEXT,
    "createdById" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "messageId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentCollection" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "providerId" TEXT,
    "customerId" TEXT NOT NULL,
    "bookingId" TEXT,
    "visaCaseId" TEXT,
    "invoiceId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "checkoutUrl" TEXT,
    "activeKey" TEXT,
    "createdById" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATING',
    "lastError" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaymentCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CollectionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionSettlement" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "receiptIds" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientEmail_messageId_key" ON "ClientEmail"("messageId");

-- CreateIndex
CREATE INDEX "ClientEmail_status_createdAt_idx" ON "ClientEmail"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientEmail_createdById_requestKey_key" ON "ClientEmail"("createdById", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCollection_reference_key" ON "PaymentCollection"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCollection_providerId_key" ON "PaymentCollection"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCollection_activeKey_key" ON "PaymentCollection"("activeKey");

-- CreateIndex
CREATE INDEX "PaymentCollection_customerId_idx" ON "PaymentCollection"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCollection_createdById_requestKey_key" ON "PaymentCollection"("createdById", "requestKey");

-- CreateIndex
CREATE INDEX "CollectionEvent_status_createdAt_idx" ON "CollectionEvent"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionSettlement_provider_paymentId_key" ON "CollectionSettlement"("provider", "paymentId");

-- AddForeignKey
ALTER TABLE "ClientEmail" ADD CONSTRAINT "ClientEmail_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "PaymentCollection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientEmail" ADD CONSTRAINT "ClientEmail_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientEmail" ADD CONSTRAINT "ClientEmail_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientEmail" ADD CONSTRAINT "ClientEmail_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "ClientDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCollection" ADD CONSTRAINT "PaymentCollection_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCollection" ADD CONSTRAINT "PaymentCollection_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCollection" ADD CONSTRAINT "PaymentCollection_visaCaseId_fkey" FOREIGN KEY ("visaCaseId") REFERENCES "VisaCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCollection" ADD CONSTRAINT "PaymentCollection_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
