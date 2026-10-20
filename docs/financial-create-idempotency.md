# Payment and invoice retry protection

Payments desk receipt and invoice forms send a random request key for each new form. Keep the same form and key when retrying an unchanged request after a lost response. No automatic retry occurs. Check the saved record before starting another transaction or opening a fresh form.

The server verifies permission and current customer/linked-record scope on every attempt. It stores a SHA-256 hash of normalized inputs and a minimal response in `FinancialMutation`, uniquely keyed by staff ID, operation and request key. The replay record, receipt/invoice, journal, audit and queued acknowledgement commit in the same transaction. Raw request bodies, notes and tax descriptions are not stored in the replay table.

An identical successful request returns its original result before testing mutable balance limits; changed details with an already-committed key return 409. Concurrent conflicts may return 409: check the result, then explicitly retry the unchanged form. The unique key prevents a second commit. Different staff do not share replay results. No global financial duplicate detector is implied: genuinely new keys/new forms are distinct requests.

Older API callers may omit the key for compatibility and therefore do not receive this retry protection. The keyed payment response contains a minimal payment identity/allocation summary; unkeyed callers retain the previous full payment envelope. Invoice response shape is unchanged.

This narrowly protects payment receipt and invoice creation. Other forms, including visa creation, must still be checked for an existing record after an ambiguous response; they are not covered by this financial request table.

## Isolated test

Apply migrations only to a synthetic database and run against a rebuilt application:

`DATABASE_URL=file:./financial-idempotency-verification.db node node_modules/prisma/build/index.js migrate deploy`

`DATABASE_URL=file:./financial-idempotency-verification.db node --import tsx tests/financial-idempotency-journey.mts`

The test refuses other database URLs and starts its server on port 3234. It verifies full-balance receipt/invoice replay, standalone invoices, changed-payload rejection, concurrent duplicate requests, one audit/journal effect, no raw private text retained, and scope revalidation.
