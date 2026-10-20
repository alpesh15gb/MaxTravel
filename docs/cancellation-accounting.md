# Manual cancellation accounting contract

Only staff-entered actual booking/supplier terms determine charges. The app does not infer a fee, settle a supplier, or execute a customer refund. This operational model is not a statutory or tax-compliance claim.

- Explicit cancellation/void replaces the original customer demand with **supplier cancellation charge + agency cancellation fee**. Both values are mandatory, nonnegative, and accept zero; reason is mandatory. Original selling price and supplier cost remain historical facts.
- Cancellation gross sales = total charges, cost = supplier cancellation charge, margin/net agency revenue = agency fee. Never subtract customer cash refunds again from those figures.
- Customer journal balance = cancellation charges − receipts + PAID cash refunds. A positive balance remains collectible directly against the cancelled booking; negative means customer credit.
- New refund request = max(0, receipts − PAID refunds − existing pending refunds − cancellation charges). The submitted confirmation must exactly match this value, including zero. Existing promises above the remaining credit must first be reconciled/rejected, not silently overwritten.
- Refund requests/approvals reserve but do not move cash. Only PAID records cash returned. Rejection releases a reservation without changing charges. Even a full cash refund of an active booking/deposit does **not** cancel the sale or lower its price.
- Same cancellation status retry is a no-op, not another refund or financial adjustment. Closed terms are not editable through this workflow. A materially different correction requires an explicitly designed adjustment workflow; do not reopen a cancelled booking to hide it.
- Legacy CANCELLED/VOID/REFUNDED records keep null allocation fields and are labelled unknown/unclassified. Migration does not infer fees, rewrite historical entries, or modify opening journal entries.

## Reconciliation limitations

Supplier dues, supplier settlements and supplier cash recoveries are independent. Recording supplier cancellation cost **does not** assert that an original supplier payable has been reduced or that a supplier refund has arrived. Staff must reconcile original dues/settlements and refunds separately against actual supplier statements. No automatic settlement or new duplicate SupplierDue is created.

Existing linked travel invoices are historical documents and may no longer describe the cancellation amount. New invoicing and collection against those cancelled-travel invoices are blocked; reconcile the documents separately and collect explicit cancellation charges directly against the booking. This flow does not issue tax credit notes automatically.

Reports show current booking state within the booking-date cohort, not formal cancellation-date revenue recognition. Journal adjustments remain dated at the actual write; original and opening entries are preserved.

## Isolated verification

- `node --import tsx tests/cancellation-accounting.ts`
- After generating Prisma/building and applying migrations only to a fresh synthetic test database: `DATABASE_URL=file:./cancellation-verification.db node --import tsx tests/cancellation-journey.mts` (local port 3231).
- The journey refuses any other database URL. It creates only synthetic local records and tests full/partial/zero refund, unpaid and partial-deposit additional collection, duplicate retry, rejected requests, scope isolation, pending reservation conflicts, and journal reconciliation.
