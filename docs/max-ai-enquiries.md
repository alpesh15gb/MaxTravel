# Max AI website enquiries

The existing signed booking-platform endpoint accepts schema-version 1 `enquiry.created` events for visa assistance, travel insurance, holiday packages and cruises. The booking website only emits an event after the customer reviews the enquiry, supplies a contact and confirms consent. Max AI itself cannot submit an enquiry.

The receiver creates a native sales enquiry and service case for the configured integration owner and branch. These appear in the sales register and return a matching lead/case receipt to the booking worker. No booking, visa application, insurance policy or payment is created. Visa, holiday and cruise enquiries cannot use the generic sales booking conversion; their fulfilment requires the team's application or supplier workflow.

Customer-supplied contacts are **unverified**. Each imported enquiry gets a separate provisional contact; the receiver never looks up, merges or updates an existing customer solely by the supplied email or telephone number. Staff should verify the contact before linking existing records or sharing customer information. Exact signed event replays return the same receipt; changed bodies and conflicting event identities are rejected.

Budgets retain their original total/per-person basis in `SalesLead.requestedBudgetJson`. Structured amounts are excluded from unrestricted notes and exposed only to staff with `payment:view`. Missing budgets are not shown as zero. CRM sales stages and booking-admin enquiry statuses remain independent.

## Deployment

Deploy this CRM before the booking website. Migration `20261117120000_max_ai_enquiry_budget` adds one nullable column and is committed for both SQLite and PostgreSQL. The existing documented SQLite Docker deployment uses `bash deploy/crm-deploy.sh` from `/opt/max-travel-crm`; it backs up, builds, migrates and checks health. Separately configured PostgreSQL deployments must use their established PostgreSQL migration procedure with private owner credentials.

Reuse the existing `BOOKING_PLATFORM_SIGNING_KEYS`, `BOOKING_PLATFORM_OWNER_ID` and `BOOKING_PLATFORM_BRANCH_ID`. The owner must be active and permitted to own cases. Matching signing keys remain private in the booking app and CRM environments. The booking side requires its enquiry migration and a refreshed CRM worker; a successful CRM deployment alone does not establish delivery.

See the booking repository's [complete enquiry deployment and verification guide](https://github.com/alpesh15gb/MaxTripJack/blob/main/booking-platform/docs/MAX-AI-ENQUIRIES.md) for both repositories' commands, delivery statuses, retry controls and permissions. This is the MaxTravel CRM, not the separate Safar CRM deployment.

## Isolated integration test

After installing the locked dependencies and generating the Prisma clients:

```bash
npm run db:generate
npm run test:platform-enquiries
```

The test command expands to:

```bash
node --import ./scripts/standalone-server.mjs --import tsx tests/platform-enquiries.mts
```

It creates and migrates a uniquely named temporary SQLite database, sets a synthetic signing key and invokes the real signed route handler for all four services. It verifies native sales visibility, replay/conflict/authentication handling, unverified-contact isolation, protected budget projection, child-only visa/insurance drafts and the absence of booking/application creation. Cleanup checks the resolved temporary path before deleting the test directory. It does not send a live enquiry, make network delivery requests or send customer messages. This test does not replace PostgreSQL or deployed VPS acceptance testing.
