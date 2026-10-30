# Client cases and settings

## Register at first contact

Open **Cases & journeys → Register client request**. Choose the customer, requested service and a short request title. The CRM allocates a permanent reference such as **CASE-2026-0001** immediately, before a visa application or booking needs to exist. Search for the existing customer first; a new visit/request gets a new case, not a new customer profile.

Open the case and use **Add visa application**, **Prepare quotation** (flight/hotel, with customer sales access), or **Add booking** to continue. The customer and service remain fixed to that case. Application references (`VC-…`), booking references (`BK-…`), PNRs, ticket numbers and receipt references remain available alongside the shared case ID.

Creating a visa, manual booking or sales enquiry directly also creates its case automatically. Converting an accepted quote retains the enquiry's case ID. Manual ticket reissues retain the original booking's case ID. Booking-platform records also receive a case; when their parent booking is already linked, related platform service records inherit its case.

## Track the journey

- Search the case ID in universal search, Cases, bookings, visa lists or enquiries.
- The case shows its coordinator, status, follow-up, linked service work, documents, tasks, receipts/refunds and dated history. Linked service records retain their staff assignments and their existing access checks.
- Record a note whenever changing case status, ownership or follow-up. This records who changed it and when. It does not alter a visa decision, confirm a supplier booking, issue a ticket or settle customer/supplier money.
- Due case follow-ups appear in **Today → Tasks & conversations**. Set the next follow-up after resolving the item, or clear it on closure.
- History is paginated. Documents, tasks and cash sections disclose their display limits and link back to complete source work. Case cash entries are not a reconciled net balance; use customer statements for that.
- Case exports respect the current case filters and the user's access, include all matching cases up to 10,000, and refuse a larger export instead of silently truncating it.

Staff see cases they coordinate, have assigned service work within, or registered while still assigned to that customer; branch roles remain limited to their branch. Document, finance and service details still require their respective permissions. An administrator can reassign the case coordinator. This does not silently reassign other service records or change a customer's relationship manager. The existing customer handover option explicitly transfers open case coordination alongside the selected related work and records that transfer in case history.

## Configure as an administrator

Go to **Settings → Case management**. The server requires `settings:manage`; staff cannot change these defaults.

| Setting | Effect |
| --- | --- |
| Case ID prefix | 2–8 uppercase letters/digits, starting with a letter; affects future IDs only |
| Default case owner | Active owner who can update cases in the customer's branch; otherwise the person registering the request |
| First follow-up after | 0–365 days; zero disables the automatic date on new cases |
| Require resolved service work before completion | Prevents completion while the linked visa decision/booking remains unresolved; does not certify settlement of money |

The case counter cannot be reset through Settings. Existing IDs, owners and follow-ups are not changed by saving defaults. Historical case IDs cannot be edited through the API. Cancelling a case requires a note and does not itself cancel linked travel or pay a refund.

The case tracking statuses are stable operational keys: Open, In progress, Waiting customer, On hold, Completed and Cancelled. Visa processing stages are separately configurable in **Settings → Visa workflow**, including the existing custom-stage and activation controls. The two workflows serve different purposes.

## Rollout

This change adds migration `20261030110000_service_cases`. Use the established backup procedure with the currently deployed version, stop application writes for the upgrade, apply committed migrations, regenerate Prisma and deploy the new build together. Do not run the new application against the older schema.

The migration allocates cases for existing valid records, links accepted quotes to their bookings and existing reissue chains, preserves all original service references, and copies safe source audit labels with their original dates/actors. It does not invent old customer notes or infer completed case status from a sale: backfilled cases start Open for staff review. Existing detailed evidence remains in its source records. Customer consolidation retains the case IDs while moving their customer relationship to the retained profile.

Registration and updates use request identities so retrying an uncertain acknowledgement retrieves the same result without creating duplicate cases/history. Conflicting revisions are rejected and the user's local note is preserved for review.

Run `npm run test:cases` for the historical migration and synthetic desktop/phone case journeys. No provider calls, real payments, live messaging or application-database migration are part of these tests.

## Verification for this release

- Lint, type checking and the production build passed.
- The historical migration test passed: quote/booking/reissue continuity, retained old references and safe audit history, continuing counters, foreign-key checks and repeated deployment.
- Sixteen synthetic browser groups passed, including registration/update lost-response recovery, applicant documents and receipts, mismatched-service rejection, unresolved closure refusal, staff scope/finance protection, default assignment, settings changes, quote entry/conversion, reissue continuity, universal search, case export filters and audited customer work handover with former-owner denial.
- The workspace sweep passed with 37 staff screen variants at 1440px and 390px (74 captures), plus seven daily-work journeys and public phone-entry checks.
- The full CRM regression suite passed, including 200 HTTP/workflow checks, 111 financial-reporting checks, 37 mocked legacy-provider checks, UI metrics and accessibility (27 routes / 54 visits, zero findings). Acceptance budgets were not increased.

The screenshots and fixture logs are local, ignored artifacts under `test-artifacts/` and `tests/.runtime/`. Staff acceptance and deployment against agency data remain release activities; the configured application database has not been migrated by this work.
