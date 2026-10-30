# CRM daily-work revamp — 30 October 2026

## Research completed before implementation

Primary product documentation, rather than private competitor screens or invented efficiency benchmarks:

- TravelJoy, [workflow setup](https://help.traveljoy.com/hc/en-us/articles/9335768898836-Step-2-Optimize-your-workflow): trip stages, repeatable tasks, payment reminders and starting the day with outstanding work.
- TravelJoy, [sales and commission reports](https://help.traveljoy.com/hc/en-us/articles/360016090912-Commissions-Sales-Reports): distinguish booking, travel and collection dates and let staff inspect underlying detail.
- Tern, [reporting overview](https://help.tern.travel/en/articles/13009064-reporting-overview) and [report finder](https://help.tern.travel/en/articles/17730070-where-to-find-it-in-reporting): begin with business questions, preserve scope, filter and drill into records, export the applicable dataset.
- Travefy, [Compass](https://travefy.com/blog-post/meet-compass): separate what changed from what requires an action and show the next task with its context.
- WeTravel, [upcoming payments](https://help.wetravel.com/en/articles/7234109-upcoming-payments-on-your-dashboard): due/past-due work leads directly to the booking or payment detail; paid cash is a different measure.

Design inference: a travel agency needs a transaction workspace, not a wall of unrelated module cards. Implement one start desk, stable navigation, record-specific next steps, short sequential entry forms, and evidence-backed reporting. Retain the existing authorization, accounting, uncertain-save protections and booking-platform contracts.

## Screen inventory and intended experience

| Screens | Daily task | Revamp contract |
| --- | --- | --- |
| Today, notifications | Decide what to work on next | Urgency, reason, record and action; distinguish notifications from work |
| Start work (new) | Begin a transaction without knowing its module | Searchable, permission-scoped action catalogue with requirements and destination |
| Enquiries and quotations, customer proposal | Capture request, revise quote, record acceptance | Preserve one selected enquiry and make request → quote → acceptance → booking clear |
| Customers and customer record | Find one customer, travellers, work and balance | Keep identity/context, readable section navigation and related work shortcuts |
| Tasks | Schedule and complete follow-ups | Due/overdue information, clear owner, completion distinct from deletion |
| Bookings, new booking, booking record, hotel stay | Record and service a trip | Guided entry, passenger/stay/price review; supplier confirmation distinct from CRM entry |
| Online bookings | Resolve booking-platform transactions | Clear platform ownership, status, documents, money and supported next action |
| Visa list, new case, case record | Open an application and resolve its requirements | Guided applicants → destination/checklist → fees, then per-applicant documents/stages |
| Documents, incoming documents, upload page | Collect, match and verify evidence | Separate unlinked incoming files, linked evidence and verification |
| WhatsApp | Handle a customer conversation | Customer context, consent/window restrictions, protected uncertain-send state |
| Payments/invoices, receipts, print | Receive and allocate cash, issue documents | Customer → allocation → amount → review; explicit advance vs collection; actionable receipt |
| Advances | Allocate previously received money | Current available balance and specific destination, no duplicate new receipt |
| Suppliers | Enter obligations and settlements | Separate bills from paid cash and link the statement |
| Refunds | Track approval through actual payout | Workflow exposure distinct from completed money returned |
| Reports | Daily close, collections, balances, margin, workload | Question-led catalogue, as-of vs movement dates, role scope, applied criteria, complete exports and drill-down |
| Packages | Author and publish customer catalogue | Draft, saved content and published snapshot stay distinct |
| Team and employee record | Staff administration | Role/access context and employment controls remain explicit |
| Checklists, requirements | Maintain reusable requirements | Template/version and per-applicant generated requirements remain distinct |
| Customer import | Validate and import existing records | Preview/resolve duplicates before creating; preserve recovery protections |
| Settings, security, audit | Configure agency and inspect history | Dangerous/security actions remain separate; no access expansion |
| Login, setup, recovery | Enter/recover a private workspace | Consistent forms, clear next action, no live credentials in fixtures |

## Reporting rules

- Existing integer-money/ledger calculations are authoritative. Do not manufacture totals or change financial semantics for presentation.
- Balance reports show an as-of date. Movement reports show a period and the actual date basis.
- Edited filters are drafts until Generate. Result pages and downloads retain the applied criteria.
- Exports cover all matching rows; on-screen pagination never silently limits exports.
- No success/zero-state when a request fails. Preserve retry context, cancel stale requests, and disclose coverage gaps.
- Access scope and source record links accompany results. Do not infer net profit from incomplete supplier costs.

## Delivery checks

Research and screen inventory → shared workspace system → transaction launch/handoffs → guided entry → report workspace → complete desktop/phone screen audit → financial and authorization regressions → isolated transaction journeys. All work uses disposable local fixtures; no supplier booking, payment, message or deployment is part of this UI revamp.

## Implemented and verified

- Shared workspace styling, visible grouped navigation, Start work, breadcrumbs and screen-specific guides cover the staff screen inventory. Record sections have desktop anchors and a phone section selector.
- Booking and visa entry use three steps with validation, retained inputs and a final review. Manual hotels have a first-class creation path and remain enquiries until actual confirmation is recorded. Customer shortcuts retain the selected customer.
- Receipt/invoice forms show the customer, allocation and money/document treatment before saving. Existing server permissions, request identities, accounting rules and recovery controls remain authoritative.
- Reporting has a grouped selector and searchable library, explicit date basis, applied-criteria disclosure, reloadable filter links, source-record drill-downs and complete exports. Draft filter edits do not relabel displayed results or downloads. Incomplete supplier costs are not presented as net profit.

Verification uses the production build and synthetic SQLite databases:

| Check | Result |
| --- | --- |
| Lint and production compilation/type validation | Passed |
| Full `npm test` | Passed, including 200 HTTP/workflow checks, 111 financial-reporting checks and 37 mocked legacy-provider integration checks |
| Accessibility | Zero findings across 25 routes / 50 desktop-and-phone visits; existing budget unchanged |
| UI metrics | Passed across 21 routes at desktop/phone sizes; no page overflow, median text 14px; compact density persists and changes row height |
| Complete screen inventory | 35 staff screen variants × 1440px and 390px = 70 captures, plus phone public-entry screens |
| New daily-work journeys | Seven groups: launch/guide, hotel creation, allocated receipt, visa/checklist, enquiry/task entry, report/export/filter recovery, read-only denial |
| Existing reporting browser suite | Passed, including 1440/390/320px layouts, exports, actual fixture balances, due terms, scoped filters, failure/retry and stale-response protection |
| Existing money browser suite | Ten groups passed across desktop/phone, including uncertain receipt acknowledgement, advances, supplier settlements and refunds |
| Existing records browser suite | Six groups passed across desktop/phone, including invoice credits, customer/traveller edits and versioned visa requirements |

Evidence is generated under ignored `test-artifacts/` and `tests/.runtime/`; no sample records are inserted into the application's configured database. The regression fixtures were also made portable for Windows paths and file URLs; assertions and acceptance budgets were retained.

Delivery includes [the staff daily-work guide](DAILY-WORK-GUIDE.md) and a dedicated pull-request/manual CI workflow for the new screen and transaction checks. Staff acceptance with agency records, VPS rollout, and real TripJack/Razorpay/Meta credentialed testing remain separate release activities. This work does not certify live delivery or supplier behavior.
