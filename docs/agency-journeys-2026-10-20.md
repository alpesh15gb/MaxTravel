# Agency journeys and reporting review — 20 October 2026

This continuation goes beyond the workspace refresh. It traces operator handoffs, financial
invariants and administrator visibility using synthetic fixtures. It does not certify an
unconfigured customer installation or promise that all possible bugs have been eliminated.

## Journey coverage

| Journey | Operator flow and safeguards | Evidence |
|---|---|---|
| Visa intake | Customer/travellers → matching destination/type checklist → age-at-travel requirements → per-applicant documents | `tests/visa-checklist.ts`, `tests/visa-journey.mjs` |
| Visa processing | Explicit checklist (including intentionally exempt checklist) before submission; appointment timestamp before booked stage; actual stage history; decision retries preserve date/history | `tests/visa-journey.mjs` |
| Document review | Stable traveller IDs, meaningful rejection reason, failed request preserves reason, no automatic message; focused review links from customer/dossier | `tests/staff-handoff-browser.mjs`, visa journey |
| Ticketing | Enquiry/quote → attach passengers → record actual tickets → collect/invoice; same-name passengers distinct; externally managed records redirect to source desk | `tests/ticketing-journey.mts` |
| Reissue | Linked original/replacement, real issued ticket, valid transitions; cannot silently discard paid replacement; repeated completion is idempotent | ticketing journey |
| Payments | Linked invoice instalments cannot exceed original work demand; receipts link to saved document and correct view; repeated navigation does not reopen creation | ticketing and staff-handoff journeys |
| Cancellation/refund | Explicit supplier charge + agency fee + reason; exact refundable remainder or additional balance; cash refunds do not silently cancel sales | cancellation accounting scenarios and smoke suite |
| Staff administration | Record history on customer, visa, booking, tasks, documents, refunds, invoices and receipts; employee/action/record/date filters; role-scoped CSV/API/page | `tests/audit-visibility.ts`, `docs/EMPLOYEE-AUDIT-REVIEW.md` |
| Reports | INR-only totals, credited-invoice exclusion, genuine cost coverage, customer-account scope, staff/status filters, applied-filter exports and source drill-down | `tests/reporting.ts`, `tests/reporting-browser.mjs` |

## Cancellation accounting rules

- Staff enter actual contractual supplier cancellation cost and agency fee, including explicit zero.
- The cancelled booking's customer charge becomes their sum, not the old trip price.
- Customer balance = cancellation charges − receipts + completed customer refunds.
- Requested/in-progress refunds reserve cash; they are not cash already returned.
- Customer refund cannot exceed the funds held after agreed cancellation charges and other reservations.
- If a partial deposit is smaller than agreed cancellation charges, the remaining charge stays collectible.
- Gross cancellation charge, supplier cost and agency margin are distinct; refund cash is not subtracted from revenue twice.
- A cash refund on a still-active booking does not erase that sale. Cancellation must be explicit.
- No actual bank/card refund, airline issuance or supplier settlement happens through a status change.
- Supplier recovery is reconciled separately against actual supplier statements. Do not infer a supplier cash receipt from a customer refund.
- Legacy withdrawn bookings lacking the new breakup stay explicitly unknown/unclassified; migration does not invent historical fee allocations or rewrite journal history.

## Workflow benchmark

Official TravelJoy workflow guidance emphasizes actionable trip/task queues and waiting-on status;
Travefy links customer, trip and invoice work; Tourwriter separates customer receipts and supplier
payments. These patterns inform clear handoffs and accounting distinctions, not copied branding.
See [the benchmark sources](customer-readiness-2026-10-20.md#scope-and-benchmark).
Zoho's official audit/timeline documentation is a relevant mature-CRM comparator for employee
and record history; travel-specific evidence and exact limits are in [the audit review](EMPLOYEE-AUDIT-REVIEW.md).

## Validation and boundaries

Run `npm run build`, `npm test`, `npm run test:crm-core`, `npm run test:staff-sales`,
and `npm run test:journeys` in an isolated test environment. Journey tests create synthetic
records, use manual/local provider fixtures and never point at a deployed customer database.
Browser coverage includes failed requests, cancel/retry, scoped navigation, receipt confirmation,
report exports and desktop/phone layouts. CI retains screenshots and report artifacts.

The following are not implied by passing application tests:
- Customer-host HTTPS, secure keys, off-site backups/restore drills and load acceptance.
- Live provider credentials, actual airline ticket issuance or real payment processing.
- Statutory/tax-compliance certification or formal revenue-recognition policy.
- Operational reports use INR; foreign-currency cash is not silently mixed into INR totals.
- Reissue fare differences are nonnegative incremental charges. Fare-decrease supplier credits
  and customer refunds require their separate explicit workflows, not an automatic offset.
- Historical branch snapshots for audit logs; restricted users see only currently authorized records, while full administrators retain deleted/global activity.
- Durable idempotency for every create endpoint. Receipt and invoice forms now keep a per-user
  request key across ambiguous retries so the same save returns the original record; API callers
  must send the key to opt in. Other create flows, including visa intake, still require checking
  for an already-created record after an ambiguous network failure. See
  [financial retry protection](financial-create-idempotency.md).
- Automatic supplier balance reconciliation after cancellation. Retained fee values must come from
  actual terms, and supplier recovery must be recorded/reconciled separately.

Use the [single-office launch checklist](single-office-launch.md) before customer handover.
