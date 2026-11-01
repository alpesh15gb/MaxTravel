# Booking and CRM verification — 1 November 2026

## Result and limits

The owner-supplied logo is shared by the booking website, booking staff workspace and CRM. The exact original JPEG SHA-256 is `9A5DDE646A046B044C3E5B74F0E991B912A5194946BE4D42F8735C94C8346F78`.

Both protected PRO Vercel previews were deployed and checked with synthetic accounts and isolated preview databases. Cross-app transaction checks remain local, as requested. No production customer records, real charges, supplier reservations or outgoing customer messages were used.

This is evidence for the flows below, not certification of every possible production scenario. Live TripJack issuance/cancellation/refunds, PayGlocal UAT and real email/WhatsApp delivery remain provider acceptance work. PayGlocal's merchant travel-payload approval hold remains enabled; six hosted-checkout cases are intentionally skipped behind that hold.

## Changes found through verification

- Online CRM bookings now link directly to their permanent case IDs.
- Confirmed hotels persist as `CONFIRMED`; hotel filtering, confirmation totals and document automation agree with that state. Superseded PDFs remain blocked before sending.
- A dedicated `/start-work` transaction chooser separates starting a transaction from tracking assigned work at `/work`.
- Follow-up shortcuts and legacy task-entry URLs open the current case-linked work form. Closing it removes the launch parameter; read-only staff cannot open its write dialog.
- Test email/MFA services can use explicitly isolated loopback ports. Windows temporary database paths, ESM preload URLs and owned-server cleanup were repaired. No production authentication or storage guards were relaxed.

## Passed checks

| Area | Evidence |
| --- | --- |
| Actual two-app transactions | Flight and hotel search/review/payment HTTP → booking worker confirmation → real signed outbox delivery → native CRM booking, permanent case, paid invoice and exactly one receipt. Only external supplier and legacy payment-adapter responses are simulated. |
| Cross-app staff work | Administrator assigns work on each synced booking; ticketing staff open their delegated source record, start work and submit a result; a separate administrator approves it. Finance access is denied to ticketing staff. |
| Customer view and replay | Both confirmed transactions appear in the real customer's My Trips at desktop/phone widths. Shared customer mapping is not duplicated. Exact event replay creates no duplicate case/receipt; forged signatures are rejected. |
| Booking application | 452 unit tests; 608 main browser cases; two unconfigured-payment and four held-checkout browser cases. Ten operations cases were rerun after the staff-logo change. |
| Native app | 50 unit tests. Physical-device and signed-release validation are separate. |
| Booking server/database | Search/review, guest shopping, checkout, payment signatures, CRM commands, after-sales services, cancellation, refunds, reporting SQL and PayGlocal SQL/crypto contracts; real local SMTP verification/reset and BetterAuth MFA lifecycle. |
| CRM core | Main suite, accessibility/26-route UI metrics, work migration/engine checks, case workflow, customer import, encryption, scanning, maintenance, search scopes and staff MFA/session/security HTTP. |
| CRM daily work | Visa/checklists/appointments, ticketing, cancellation accounting, payment/refund idempotency, advances, customer consolidation, document intake, authentication, invoice configuration, audit exports, first setup and enquiry → accepted quotation → native booking. |
| CRM screen inventory | 43 current screens × desktop/phone = 86 captures, plus seven daily-work journeys. Case workflow rerun produced 48 captures across four end-to-end groups. |
| Reporting | Statements, balances, supplier accounts, scoped staff/status/date filters, work/cash drilldowns, PDF/Excel/CSV exports, draft/applied criteria, delayed responses, recoverable failures and read-only export denial. |
| Catalogue publication | Two real local applications verify draft privacy, publication, revision updates and withdrawal across SSR/API reads. Media ownership, integrity, quotas and symlink rejection also pass. |
| Protected cloud previews | CRM: 24 admin/staff screen checks, real PostgreSQL case assignment/submission/approval and invoice replay. Booking: 30 admin/staff/viewer/customer checks, scoped grants, MFA, replay and foreign-origin denial. No browser runtime errors or page overflow were found. |

## Repeatable transaction check

CRM command: `npm run test:two-app-transactions`.

Use two clean, built fixture checkouts, the booking workers build, `BOOKING_FIXTURE_ROOT`, an empty loopback PostgreSQL database named exactly `bridge_booking_verification` via `TEST_BOOKING_DATABASE_URL`, and an isolated loopback Mailpit SMTP port via `TEST_SMTP_PORT`. The harness refuses configured runtime environment files and existing database tables. It blocks unexpected external provider calls and stops only its own process handles.

The GitHub workflow `.github/workflows/two-app-transactions.yml` builds both applications and runs this check with disposable services. It deliberately pins a compatible booking contract revision. Evidence includes `test-artifacts/two-app-transactions/proof.json` and screenshots; databases, credentials and raw private runtime files are not uploaded.

Local run evidence is under `D:/Max Travel Booking/.artifacts/full-flow-20261101/`, outside tracked source. The main browser HTML report is preserved there before disposable-worktree cleanup.
