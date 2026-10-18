# Travel CRM benchmark and release plan — 18 October 2026

## What established travel platforms make connected

This benchmark reviews vendor-published product and support material. It compares workflow patterns, not vendor security, performance, or feature quality. Products focus on different markets: advisor CRMs, tour operators, and agency back offices are not interchangeable.

| Workflow pattern | Public product evidence | Fit for Max Travel |
|---|---|---|
| Enquiry → follow-up → proposal → approval → trip | TravelJoy highlights CRM, client preferences, tasks/reminders, proposals with client approvals, and proposal conversion. Tern connects advisor CRM/proposals/itineraries with agency operations. | Core: retain the existing lead/quote/acceptance path and tighten its follow-up and booking handoff. |
| Shared trip workspace and traveler experience | TravelJoy supports client-ready itineraries and group trips; Travefy's CRM launch ties contacts to itineraries, invoicing, commission tracking and email. | Core for a flight/hotel seller: customer and traveler data, confirmed booking snapshots, travel documents and support history. A general tour-day itinerary builder is optional unless Max Travel sells packages. |
| Collections and finance connected to trips | TravelJoy documents deposits, installments and payment reminders; Tern connects booking-level commission data to agency reporting and payouts. | Core: keep receipts, invoices, refunds, TripJack booking state and CRM customer balances consistent. Never represent a manual record as an external payment. |
| Supplier payables, commission statements and settlement reconciliation | Tern describes supplier statement matching, partial supplier commission receipts, agent splits and payout statements. Sembark and Moonstride describe supplier ledgers, payment tracking, costing and purchase ledgers. | Core for offline bookings and services purchased on credit; useful for TripJack only when it represents an actual unpaid supplier liability. TripJack prepaid wallet debits must not be duplicated as supplier payables. |
| Operations calendar, responsibilities, alerts | TravelJoy promotes tasks, reminders and shared calendar; Moonstride describes sales pipeline, task management, activity calendar and operational alerts. | Core: booking deadlines, travel dates, refunds, document work and lead follow-ups need a clear owner and due date. |
| Reusable forms, content and group workflow | TravelJoy supports intake forms, reusable libraries, and group booking/payment schedules; Sembark focuses on tour costing, supplier contracts, movement charts and vouchers. | Later/conditional: Max Travel's confirmed scope is direct flights and hotels plus visa/ticketing services, not tour departures, rate contracts or group payment pages. |

## Current product fit

Travel OS already includes customer/traveller profiles, visa and airline operations, sales leads, versioned quotes with client acceptance, staff tasks, online flight/hotel booking synchronization, invoices, receipts, refunds, supplier dues, reports, and Meta Cloud messaging workflows. The booking-platform webhook is the source of truth for TripJack/Razorpay booking snapshots; CRM staff must not manufacture provider charges or statuses.

The highest-fit gap addressed in this release is supplier accounting detail: supplier records were limited to three legacy categories, a payable could not point to its related booking or supplier invoice, and settlements were only an aggregate `paidAmount`, so staff could not audit each payment or safely reverse an incorrect entry. This release adds supplier types for airline, hotel and booking platform, booking-linked payable records, payment-by-payment settlement history, references/method/date, idempotent recording, reasoned reversals, journal updates, and migration of existing aggregate settlement history.

## Prioritized remaining work

1. **Acceptance and deployment:** apply CRM migrations to the existing CRM database after backup; run a restore rehearsal, scanner-enabled upload checks, MFA rollout and browser acceptance. Verify the actual booking-to-CRM event path against the demo environment before production.
2. **Supplier statement reconciliation:** import a supplier statement and match its lines against multiple payables; keep this behind a manual accounting process until source statement formats and accounting sign-off are known.
3. **Quote and client trip handoff:** improve the accepted quote → booking flow to prefill traveller and service details, then surface confirmed documents and actionable changes in a client trip view. Keep supplier price/cost fields private.
4. **Finance completeness:** support accountant-approved tax documents for linked booking/visa charges, partial credit notes and customer refunds with immutable adjustment history; test tax arithmetic and source-payment reconciliation with the accountant's scenarios.
5. **Customer retention and workflow rules:** structured travel preferences and communication consent history, customizable follow-up rules, reusable task templates, and group trips only if the business sells them.
6. **Scale and accounting:** multi-currency/FX, a PostgreSQL migration, finance-safe profile consolidation, and commission receivable/payout workflows only if the agency's contracts need them.

## Implementation guardrails

- Do not copy a vendor's UI or assume its advertised workflow is independently verified.
- Keep Indian tax configuration accountant-owned. The app stores the selected configuration and snapshot; it does not decide statutory applicability.
- A supplier payable is a liability only when the agency actually owes money to the supplier. A prepaid TripJack wallet debit is not an outstanding payable.
- Settlement entry records accounting evidence only. The CRM does not transfer funds.
- Keep all supplier and booking operations behind current server-side role and record-scope checks, audit changes, and preserve a reversible history.

## Sources

- [TravelJoy product overview](https://traveljoy.com/) and [proposal creation guide](https://help.traveljoy.com/hc/en-us/articles/4407244320532-Create-an-Itinerary-or-Smart-proposal)
- [TravelJoy CRM, proposal and group workflow updates](https://traveljoy.com/blog/post/summer-2025-product-updates)
- [Travefy CRM suite announcement](https://travefy.com/blog-post/travefy-launches-all-new-crm-suite)
- [Tern agency features](https://tern.travel/agencies) and [supplier commission reconciliation guide](https://help.tern.travel/en/articles/9415229-tern-agency-commission-reconciliation)
- [Sembark travel CRM](https://sembark.com/travel-crm-software/) and [features catalogue](https://sembark.com/travel-software/features/)
- [Moonstride feature catalogue](https://www.moonstride.com/features/)
