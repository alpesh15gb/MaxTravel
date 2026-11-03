# Agency daily workflows: implementation and visual acceptance plan

## Confirmed business decisions

- Ticket/document release requires full allocated settlement for the selected booking/delivery bundle. Agency administrators can approve an explicit, reasoned and audited exception. Credit approval does not silently mark invoices paid.
- A Max ID remains open after travel while balances, refunds, unfinished tasks or servicing remain outstanding. Automatic completion uses the latest end date across all included travel services, not just the first flight departure.
- Passports are required before international or visa confirmation, not for every domestic traveller or first-contact registration. PAN and Aadhaar are optional; use masked Aadhaar/last-four references by default.
- Email is the primary customer channel. WhatsApp remains an explicit manual staff action; new automated customer updates must not default to WhatsApp.
- Keep the five requested sidebar sections: Masters, Bookings, Tasks & follow-ups, Suppliers and Reporting. Team/access and agency configuration are account-menu tools. Internal messaging is available from the workspace header and relevant Max ID, without a sixth business sidebar section.

## Work and acceptance criteria

| Work | Required implementation | Realistic acceptance scenario |
| --- | --- | --- |
| Masters | Individual/company customer, separate travellers, multiple loyalty memberships/airlines, identity records, private manual documents, current manager, scoped staff audit | Admin registers a company, adds its travellers, assigns a branch-eligible staff member; that staff can enter permitted traveller details without seeing restricted identifiers or other customers |
| Credit and ticket custody | Private booking files, customer credit terms/due dates, allocated-balance release gate, versioned/revocable client access, reasoned admin override | Staff uploads a ticket on credit; partial/pending/failed payment cannot reveal itinerary or files; full verified payment unlocks the current delivery; the exception is visibly recorded without inventing money |
| Collections | Manual verified receipts plus Razorpay/PayGlocal collection options, configuration readiness, unique references, signed webhook inbox and reconciliation, idempotent ledger posting | Duplicate/out-of-order notifications post one receipt; tampered callbacks, wrong amount/currency/provider and uncertain creation do not mark paid; online-platform orders keep their separate payment authority |
| Customer email | Transactional email outbox, delivery failures/retry, verified release links and payment requests; explicit manual WhatsApp links/actions | A queued/failed email is distinguishable from sent email; no ticket attachment bypasses the release gate, and no automatic WhatsApp job is introduced |
| Internal messaging | Participant-scoped staff/admin chat, unread/read state, encrypted message body, replay-safe sending, active staff checks | Staff can message an eligible admin; a third staff member cannot read that direct conversation; a lost response retries without a second message |
| Rescheduling | Original-to-replacement ticket history, supplier quote reference, separate fare/tax difference, airline/no-show charge and agency fee, incremental demand/cost, actual replacement ticket proof | Original sell 5000/cost 4000; extra supplier cost 1200 plus agency fee 200 makes additional demand 1400 and combined expected profit 1200, without selling the original fare a second time |
| Traveller readiness | Inline add/select traveller, same-customer validation, passport readiness for international/visa confirmation, draft intake allowed | Domestic traveller can register without passport; international confirmation fails with an actionable missing-data message; a traveller from another customer is rejected |
| Automatic closure | Date-aware scheduled maintenance, completed services and reconciliation guards, auditable reason and explicit reopening on later service | A past trip with a pending refund remains open; a fully reconciled completed trip closes; a later reschedule reopens the same permanent Max ID |
| Dashboard moments | Admin-only birthdays today and passport expiry this month, India date boundaries, exact scoped counts and usable master links | Month/day boundaries and leap-day handling are explicit; secondary/legacy passport rows are deduplicated appropriately; staff do not gain a new global customer directory |
| Multiple bookings | One reviewed save for several flight/hotel/stay/insurance/bus/train lines under one Max ID, same-customer guests, atomic validation and idempotent retry | Valid flight and stay plus one invalid insurance line saves none; corrected batch saves once and all lines appear on the Max ID and relevant registers |
| Profit and reporting | Permission-gated per-booking and Max ID selling/cost/net margin, green profit/red loss, refunds/credit notes/reschedules handled consistently, dated XLSX/PDF exports | Profit 1000 is green, loss 200 is red; receipts are not mistaken for revenue; mixed currencies are not silently added; exported totals match the visible source rows |

## Research used for the design

- Travelport traveller profiles and repeated loyalty/documents: https://support.travelport.com/webhelp/uapi/Content/Profiles/Profile_Create_Traveler.htm
- Brex traveller information, ID names and preferences: https://www.brex.com/support/managing-brex-travel
- Airline changes depend on applicable fare rules and fare difference, not a universal hard-coded fee: https://www.airindia.com/content/air-india/in/en/frequently-asked-questions/payment-refund-cancellations.html and https://www.airindiaexpress.com/en/book-flights/
- Razorpay Standard Payment Links: https://razorpay.com/docs/api/payments/payment-links/create-standard
- Razorpay raw-body signature validation, duplicate events and event order: https://razorpay.com/docs/webhooks/validate-test
- PayGlocal existing reviewed integration references: https://payglocal.in/docs/api-reference/payments-v2/paycollect/gpi and https://payglocal.in/docs/key-management/request-construction. Merchant-specific travel/collection confirmation remains a separate activation requirement.
- UIDAI masked Aadhaar description: https://uidai.gov.in/kn/aadhaar-online-services

## Verification and rollout rules

Use isolated migrated databases, a current production build and browser accounts for admin, assigned staff, restricted staff and an unrelated branch. Visually inspect desktop/mobile screenshots and test the negative paths, not only successful saves. Provider mocks must be clearly labelled; no real card charge, supplier issuance, client email/WhatsApp message or production data reset is part of these isolated checks. Payment providers stay disabled wherever credentials or merchant confirmation are incomplete. Back up databases and retain the stable CRM encryption key before deploying additive migrations. Do not report a provider sandbox or VPS check as complete until it actually ran.

## Implemented workflows

The five-section workspace, expanded private customer/traveller masters, multi-service booking entry, source-scoped staff entry, internal chat, ticket custody, email outbox, reschedule quote/replacement history, administrative reminders, reconciled Max ID completion and financial exports are implemented. Existing permanent reference values are retained; new user-facing navigation uses Max ID.

Collections distinguish recording an already received payment from requesting an online payment. The new CRM Razorpay adapter is test-mode only and disabled by default. PayGlocal is shown as held pending merchant-specific confirmation; this release does not introduce a new CRM PayGlocal payment transport. Online booking-platform transactions retain their separate supplier/payment authority and cannot be manually reissued or rewritten as local cash records.

### Supplier operations

Supplier bills can link to a booking or visa application. Due-date filters include both selected India-calendar dates; settled/voided history opens automatically when specifically filtered. New bills use actor-bound request references to prevent duplication after a lost acknowledgement. Supplier and linked work cannot be silently moved on an existing bill. Partial payments, explicit reversals and audited entry voids retain the original history. These actions record business events only; they do not instruct a bank transfer. A voided entry has no liability and cannot be paid or reopened by editing; a correct replacement is a new payable. Late bills/refunds reopen a previously completed Max ID when new outstanding work is found.

### Security and operational boundaries

- Preserve the existing stable `CRM_DATA_ENCRYPTION_KEY`; do not generate a new key on every deployment. Masters, membership/identity values, import staging, internal messages and email outbox use authenticated encryption.
- Private travel files require staff/source access or a current, revocable client delivery capability. Every client download rechecks settlement, refund state, ticket/file revision and any audited administrator exception.
- Case-assigned staff can enter only the relevant traveller/passport and service records. Assignment does not grant access to the whole customer master or unrelated bookings. Revocation is checked on subsequent requests.
- The worker isolates independent jobs. Unknown gateway or SMTP outcomes are retained for review instead of blind replay; one failing job family does not starve all other jobs.
- Email delivery requires configured SMTP and the existing CRM encryption key; without them the email controls and worker remain held. A queued record is not delivery proof. No itinerary/PNR is automatically exposed through generic booking/receipt notices. WhatsApp automation rules are disabled; staff-initiated use remains available.
- Gateway readiness requires the explicit CRM collection opt-in, test merchant keys, webhook secret and verified public origin. Browser returns and payment screenshots do not create receipts. No real payment or supplier operation was performed by the isolated tests.

## Upgrade and recovery

This release adds seven committed feature migrations, beginning with `20261102100000_customer_masters` and ending with `20261103060000_visa_supplier_payables`, for both database providers. The last migration preserves supplier bills and their settlement history while adding optional visa linkage; it also aligns the existing booking foreign key. Use `prisma migrate deploy`, never a reset or `db push`, against the deployed database. Verify and retain database/upload backups and the encryption key before rollout. A rollback involving the database must use the matching verified backup and application image, rather than attempting to remove financial history with ad-hoc SQL.

Backup/restore, controlled test-data reset, encrypted-record readiness and import undo/merge safeguards include the new models. Existing user accounts, MFA and integration identity requirements are retained. This work does not activate CRM↔booking command identities or bypass missing staff MFA. Signed booking snapshots preserve authoritative supplier cost (including explicit zero); the upgrade backfills that provenance only for existing online-source records with their signed integration link; a source label alone is not proof. The booking exporter supplies the final recorded supplier arrival day from confirmed/reviewed segments. Missing or incomplete arrival data remains unresolved instead of falling back to the outbound departure. Completed manual replacements use their current dates while original money/refund checks remain in force. Unknown booking/visa cost remains finance work even when no supplier profile has been selected; an operator must confirm the cost, including an intentional zero, before closure.

## Verification record

Verification runs against the current production build in a credential-free isolated checkout with disposable migrated SQLite databases and synthetic actors. External browser traffic is blocked. Tests cover admin/staff and desktop/phone journeys; schema upgrades preserve legacy master data and a partially paid supplier invoice. Unit suites cover custody balances/refunds/exceptions, immutable payment evidence and replay, SMTP uncertainty, scoped chat, passport readiness, closure/reopening, export arithmetic, and backup/restore. PostgreSQL schemas/models are generated and validated; a PostgreSQL server migration is not claimed.

The release verification includes the existing regression, accessibility and UI suites, plus Masters, internal chat, agency daily-work, case/work assignment and financial-entry browser scenarios. Current pass/fail evidence is recorded by those suites; this document is not a claim of exhaustive real-world certification.

The 2026-11-03 verification passed the production build, TypeScript, ESLint and full existing regression chain, then the updated Masters (12 groups), internal chat (5), daily agency work (12), record-entry (6), money-entry (10), Max ID (16) and import (5) browser groups. Dedicated ticketing, cancellation, financial replay, visa and reporting journeys passed; the sales journey covers desktop/phone acceptance of an exact quote version and single booking conversion. Upgrade tests exercise real SQLite migrations, including preserved partial settlements and trusted versus merely labelled online costs. Signed booking-event/receipt/refund replay checks passed. The booking repository passed 489 unit tests plus type/lint checks. CRM operations scripts passed 35 reset/encryption tests; the production dependency audit reported zero vulnerabilities. These are isolated application checks, not live supplier/payment certification.

Still requires operator/provider verification after deployment: actual SMTP delivery, merchant-approved hosted checkout and gateway reconciliation/refunds, real airline/hotel servicing, current live staff/branch/MFA setup and production background-worker operation. Payment holds remain enabled until their setup is approved.
