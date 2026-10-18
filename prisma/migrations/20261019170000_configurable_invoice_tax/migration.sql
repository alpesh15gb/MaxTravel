ALTER TABLE "Invoice" ADD COLUMN "documentKind" TEXT NOT NULL DEFAULT 'OPERATIONAL';
ALTER TABLE "Invoice" ADD COLUMN "taxSnapshot" TEXT;

CREATE TABLE "InvoiceCreditNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "creditNoteNo" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "taxSnapshot" TEXT,
    "issuedById" TEXT,
    "issuedOn" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceCreditNote_creditNoteNo_key" UNIQUE ("creditNoteNo"),
    CONSTRAINT "InvoiceCreditNote_invoiceId_key" UNIQUE ("invoiceId"),
    CONSTRAINT "InvoiceCreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InvoiceCreditNote_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
