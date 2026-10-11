# Complete travel CRM gap analysis

**Researched:** 8 October 2026. **Scope:** Travel OS source, schema and current UI compared with travel-native products. Vendor feature pages describe advertised capabilities; they are not independent security or performance verification. No provider is selected or integrated by this research.

## What a complete travel CRM covers

The full lifecycle is **lead → qualification → quote/options → client approval → reservation → collection/invoicing → supplier fulfilment → travel support → reconciliation → retention**. A customer directory and operational booking stages alone do not complete that lifecycle. Not every agency needs live GDS, a marketing suite or AI: those are business-scope choices, not universal release requirements.

## Primary-source benchmarks

1. [TravelJoy](https://traveljoy.com/): client CRM, forms, branded proposals/itineraries, payments/authorizations, group trips, automated tasks/emails and booking tools. Its US card/ACH details do not establish India availability.
2. [Travefy](https://travefy.com/): proposals, itineraries, CRM, invoices, commission tracking, communication, mobile/offline travel experience and supplier integrations.
3. [Tern agency features](https://tern.travel/agencies): advisor CRM/proposals/itineraries/payments; booking-derived commission splits, reconciliation, payout statements, agency reporting, locked accounting records, shared libraries and compliance documentation.
4. [Sembark feature catalogue](https://sembark.com/travel-software/features/): enquiry capture/distribution/follow-ups, profiles, component-based itinerary costing, margin/tax controls, tour calendar, vouchers, supplier ledgers, proforma invoices, instalments, payment collection, supplier pricing and role management.
5. [moonstride](https://www.moonstride.com/): enquiry allocation, quotation conversion, itineraries, reporting, customer profiling, multi-service packages, supplier/back-office and booking-engine capabilities. AI is optional, not a prerequisite for a complete CRM.

## Travel OS comparison

| Capability | Current implementation | Remaining work | Priority / dependency |
|---|---|---|---|
| Customer 360 / travellers | Profiles, family travellers, work history, passport masking, notes, activity | Customer profile corrections, merge/dedup, import, ownership reassignment; structured preferences/tags/consent | **P0** corrections and assignment for normal staff operation; P1 import/merge |
| Enquiry / sales CRM | Customer + booking/visa ENQUIRY states, tasks | Dedicated lead pipeline, source/channel, qualification/budget, lost reason, assignment, conversions and follow-up SLA | P1; P0 if replacing sales CRM |
| Quotes / proposals | QUOTE_SENT is a status, not a quotation object | Versioned options, component costing, margins, validity, approval, terms and quote-to-booking conversion | P1; P0 for package-selling client |
| Itineraries / vouchers | Airline sector/date strings and Trips tab over bookings | Day-by-day itinerary, hotels/transfers/activities, reusable content, supplier confirmation, PDF/shareable vouchers | P1; scope dependent |
| Visa operations | Multi-applicant cases, checklist versions, stage history, review | Per-applicant checklist selection, rules actually enforced, stage/readiness gates, outcome/date consistency, post-creation requirements, staff upload/expiry UX | **P0** operational correctness; verify before release |
| Ticket operations | PNR/deadline, real-ticket recording, reissue chain | Enquiry-to-PNR updates/booking edits, lifecycle integrity, replacement-ticket workflow and fare/refund consistency | **P0** for ticketing client |
| Receipts / invoices | Manual receipts; paise arithmetic; linked balances | Printable/client-deliverable invoices/receipts; invoice corrections/credit notes; advance allocation/reconciliation; ledger/payment schedules | **P0** documents and corrections if replacing finance records |
| India tax/accounting | One total and description, INR defaults | GSTIN/address, line items, SAC/HSN/place of supply, tax basis, GST/TCS/TDS where applicable, credit notes, accounting export/integration | **P0 only where legally/applicably required**; accountant must confirm rules |
| Refunds | Booking-linked supplier pipeline; partial/full net balances | UI rejection/cancellation, supporting references, authorized approvals, visa/standalone-invoice refunds, amendments and actual payout reconciliation | **P0** correction/rejection controls; broader support P1 |
| Suppliers | Supplier directory + manual dues/paid flag | Amend supplier/payable, paid history/ledger, partial payments/advances, linked costing, contracts/rate seasons and reconciliation | P0 basic correction/history; P1 full ledger |
| Commission | Indicative markup/margin | Supplier commission receivable, advisor/agent splits, collection/reconciliation/payout reports | P1; P0 if agency depends on commissions |
| Tasks / workflows | Assigned due/priority tasks, done/reopen, alert dashboard | Edit/cancel/comments, recurring/automatic tasks, SLA/calendar, workflow automation | P0 correction; P1 automation |
| Communications | Honest manual WhatsApp logging and handoff | Verify all template variables, consent/history, email/calls, real provider inbound/outbound/delivery and automation | P0 accurate handoff text; provider optional |
| Client experience | Expiring upload-only portal | Proposal approval, itinerary/invoice download, statements, payments, self-service status, terms/insurance consent | P1; define client promise |
| Team / access | 12 hard-coded roles, ALL/BRANCH/ASSIGNED, HR/finance masking | Usable role/branch and record assignment, handover, role regression matrix, MFA/account recovery as appropriate | **P0** assignment/security; admin configurability P1 |
| Reporting / export | KPIs, scoped CSV exports, audit | Sales/conversion/margin/ageing/destination/supplier/staff reports, arbitrary date ranges, migration/import completeness | P1; client required reports P0 |
| Multi-currency / multi-service | Booking currency string; values render INR | Currency-aware amounts/FX, service-specific reservations/costs, supplier/customer currency accounting | P1; **P0 if client sells in multiple currencies** |
| Privacy / durability | Session checks, scope guards, private upload storage, in-app audit | Proven deployment isolation, HTTPS, secrets, backup AND restore, retention/deletion policy, upload safety, no raw internal errors, monitoring, recovery and concurrency testing | **P0** release gate |
| Live inventory / gateway / OCR | Explicitly absent | Connect only when business scope and credentials require it; no inferred delivery/charging/approval | Optional; not a universal blocker |

## Recommended release framing

Do not sell the present system as a **complete travel CRM or accounting replacement**. A narrower **single-agency visa and airline operations pilot with manual finance/WhatsApp** may be viable only after the audit's critical defects are resolved, backup/restore and deployment security are proved, staff assignment works, and the client accepts explicitly documented omissions.

### Product milestones after safety gates

1. Correctable customer/work records and assignment/handover.
2. Enquiry-to-quote-to-booking with branded itineraries and client approval.
3. Client-deliverable invoices/receipts and accountant-approved tax handling, advances/credit notes/supplier ledger.
4. Commission, reporting and workflow automation.
5. Optional live integrations and richer client self-service.

## Client acceptance questions before deployment

- Is the client visa/ticketing only, or also tours/hotels/transfers/groups/corporate travel?
- Which country, tax registrations, currencies, reporting and statutory documents apply?
- How many staff, branches, concurrent writes and daily records/uploads? Who owns/assigns work?
- Where will the Node app, SQLite database and private files live? What are backup frequency, recovery point/time, support owner and retention rules?
- Must messages/payments be automated, or does the client explicitly accept manual logging/handoff?
- What existing data must be imported and reconciled? Which roles sign off the end-to-end acceptance test?

These are acceptance gates, not assumptions that should be silently decided by the implementer. Hosting is not selected and no deployment is performed by this assessment.
