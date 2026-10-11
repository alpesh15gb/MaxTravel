# Travel OS redesign research

Research date: 7 October 2026.

## Sources reviewed

- [TravelJoy](https://traveljoy.com/): central client workspace, tasks and reminders, invoices and payments, group management, branded communications.
- [Travefy](https://travefy.com/): connected client records, trips, invoices, commissions, communication, branding and mobile-first client experience.
- [AltexSoft travel agency software guide](https://www.altexsoft.com/blog/travel-agency-software-choosing-tools-for-booking-accounting-marketing-and-tour-building/): operational separation between inventory booking, itinerary management, accounting and CRM; supplier coordination and markup/profitability are essential back-office responsibilities.

These are product-pattern references, not endorsements, integrations or evidence of capabilities implemented in this app. Vendor claims have not been independently audited.

## Our operating model

This agency system prioritizes visa processing, air ticketing and collections rather than a leisure itinerary builder. Keep the customer as the common anchor, with distinct travellers, cases, bookings, invoices, documents and tasks. A CRM is not a live inventory/GDS integration or a payment gateway.

1. **One relationship, one workspace.** Customer 360 connects family/group travellers, documents, active work, money and communication.
2. **Exceptions before charts.** Pulse highlights deadlines, overdue money, incomplete dossiers and team follow-ups. No invented trends, counters or activity to decorate an empty workspace.
3. **Short, safe transactions.** Select a customer and related record, show the balance, review the amount, save once. Never ask staff to type database IDs. Validate ownership and use atomic financial updates.
4. **Progressive disclosure.** Put required inputs first and reveal optional flight, supplier or dossier details without overwhelming staff.
5. **Honest communication.** A message stored locally is not delivered to WhatsApp. Clearly label the manual handoff until a provider is configured.
6. **Designed empty states.** Each unconfigured module explains its purpose and offers the next permitted action.
7. **An agency, not a demo.** No sample customers, employees, transactions, documents, hardcoded agency identity or shared credentials. First-run setup creates the agency's actual owner; only operational role/workflow definitions are initialized.
8. **Consistent premium workspace.** Warm light surfaces, deep navy text, teal actions, quiet semantic status colors, clear typography, accessible controls and responsive navigation.

## Acceptance criteria

- Work in the existing `travel-os` Next.js/TypeScript/Prisma app; preserve existing routes and role-based access.
- Existing unwanted records are removed after a local recovery backup; no automatic demo seeding remains.
- Live database has zero users and zero operational records on delivery and opens `/setup`.
- First-run setup asks for real agency and owner information; no credentials are pre-filled; initialization cannot be repeated after an owner exists.
- Every current app module, detail screen, creation form, login and public upload page uses the light design system.
- Primary transaction flows remain simple: customer → visa/booking → invoice → payment; linked balances update atomically and cross-customer allocations are rejected.
- Empty states, loading states, validation messages, mobile navigation and universal search are usable.
- No fabricated delivery, success, KPIs or integration status.
- Verify typecheck, production build, isolated API regression tests and browser flows. Keep all test records out of the live database.
- Document any unconnected external systems and remaining infrastructure constraints rather than claiming full production readiness.

## Delivery status (7 October 2026)

Met and verified: no demo records, accounts, credentials or hardcoded agency identity remain; the live database is empty and routes to one-time `/setup`; setup creates only the real agency owner plus role/stage reference data and cannot be replayed; every module, detail screen, creation form, login and upload portal uses the light design system; primary flows are customer → visa/booking → invoice → receipt with atomic paise allocation, linked-record validation and no raw IDs; empty/loading/error states, mobile navigation and scoped universal search are in place; WhatsApp is labelled as a logged manual handoff.

Verified by `npm run typecheck`, `npm run lint`, `npm run build` and `npm test` — an isolated suite (own database and uploads, live data untouched) covering setup, RBAC/scoping, money integrity, uploads, honest logging and route rendering; results recorded in `verification-results.json`.

Not claimed: real WhatsApp delivery, GDS/inventory, OCR, payment movement, multi-instance scaling, or database-level auditing. The previous demo database is kept locally as `prisma/dev.pre-revamp.db` (git-ignored) purely as a recovery copy; delete it once you no longer need the old records.
