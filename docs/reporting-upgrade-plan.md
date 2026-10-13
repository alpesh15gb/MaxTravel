# Max Travel CRM reporting upgrade plan

Prepared 13 October 2026. Scope: research and implementation plan only; no live application changes.

## Recommended outcome

Build reporting around three questions: what does each customer owe us, what do we owe suppliers/customers, and what did the agency actually earn? Deliver customer statements first, followed by collection control, supplier/refund reporting, then management reporting. Charts support these workflows; each total must open the transactions behind it.

Assumptions: one office, up to 20 staff, India business calendar, INR first, current ticketing/visa services. Corporate/group accounts and other currencies are later extensions. Confirm the agency's billing and cancellation policy before implementing financial posting rules.

## Research: established products and applicable lessons

These are selected benchmarks, not a market-share ranking or a hands-on evaluation. Findings come from public vendor documentation inspected on 13 October 2026. TRAMS documentation includes older material and is used for mature accounting patterns, not a claim about current UI.

| Product | Vendor-documented capability | Implication for Max Travel |
|---|---|---|
| Dolphin Dynamics | Client-facing statements, branded invoices/statements, credit control and more than 70 business reports | Statements should be customer-ready documents with useful booking references and credit-control actions. |
| TravelWorks | Receivables, payables, general ledger, reconciliation, travel-specific reporting and agent/branch indicators | Report customer debt, supplier debt and agency earnings separately. |
| TRAMS / ClientBase ecosystem | Client statement exports including partial payments and vouchers; client/vendor statements and activity reports | A running ledger and allocation history are core requirements. |
| TravelJoy | Sales and expected/collected/past-due commissions; date choices, payment status/due dates, currency-specific reporting | Separate sales, cash collected and earned/collected commission; explicitly choose the relevant date basis. |
| Travefy | Bookings track payments, outstanding balances and reservation details | Keep statements and reports linked to customer/trip records rather than isolated spreadsheets. |

Sources:

- [Dolphin business travel](https://www.dolphind.com/products/dolphin-for-business-travel-agents/)
- [TravelWorks features](https://www.travelworkssolution.com/travel-agency-software/features)
- [TRAMS report resource guide](https://trestechnologieshelp.zendesk.com/hc/en-us/articles/4412271533715-Trams-Back-Office-Trams-Crystal-Reports-Resource-Guide)
- [TRAMS report definitions](https://static.trams.com/TBO49/content/chapter%2013%20reports.htm)
- [TravelJoy commissions and sales](https://help.traveljoy.com/hc/en-us/articles/360016090912-Commissions-Sales-Reports)
- [Travefy bookings](https://intercom.help/travefy/en/articles/16109252-bookings)

All subsequent design choices are recommendations for this CRM, not vendor feature claims.

## Current CRM assessment

Inspected `src/lib/reports.ts`, report page/client/API, `receivables.ts`, Prisma schema and prior reporting research.

Already available: date-range sales and receipts, paid refunds/net collections, current receivables, partial booking margin, monthly trends, stage/status/payment-method breakdowns, scoped access and audited summary CSV export.

Material gaps:

- No customer statement with opening balance, transaction rows and closing balance; no statement PDF or transaction workbook.
- Outstanding is a current snapshot, even when a historical report range is selected. There is no true as-of balance.
- Sales include enquiries/quotes with a selling price. This is pipeline value and should not be mistaken for confirmed sales or revenue.
- Linked invoices are excluded to prevent double counting, but a future statement must also avoid counting receipts twice across work and invoice links.
- Current sales and margins depend on mutable status/prices; historical results can change after an edit/cancellation.
- No full ageing. Invoices have due dates, but booking/case demands need explicit due-date/payment-term rules.
- Outstanding UI returns only the largest 100 records. Full report totals and exports need complete, paginated detail.
- No transaction-level supplier settlement ledger. `SupplierDue` has cumulative paid amount and one paid date, which cannot describe multiple partial settlements accurately.
- No dedicated credit/debit notes, unapplied advance allocation history, refund liability ledger, expense ledger or general ledger.
- Money columns are Float with paise arithmetic. New financial postings should use integer minor units or exact decimal storage.
- Current margin covers only INR bookings with positive cost; it excludes visa costs, overheads and refunds. It cannot be called net profit.

## Report centre design

Keep the existing Reports entry. Replace the single summary screen with an overview and a searchable report catalogue:

1. Customer accounts: statements, outstanding/ageing, receipts and customer credits.
2. Sales and earnings: ticketing/visa sales, service-level gross margin, commissions when supported.
3. Suppliers and refunds: supplier statements/payables, refund liabilities and supplier recovery.
4. Operations: ticketing deadlines, departures, visa pipeline and staff workload.

Use one consistent report layout: report name and definition, relevant filters, summary totals, sortable paginated detail, drill-down links, export/print. Filters must include the date meaning (transaction date, due date or travel date), customer, service, staff and status where relevant. Show generation time, currency and active filters on exports.

## Phase 0 — financial definitions and migration foundation

Complete this dependency before promising historical statements.

- Decide when a booking/case becomes a posted customer charge; keep enquiry/quote value in pipeline reports.
- Define the canonical demand. Recommended: a posted invoice or work charge, never both for the same obligation. A linked invoice can be a presentation of an existing charge; only explicitly approved incremental billing creates another charge.
- Add an append-only customer account journal: customer, currency, signed minor-unit amount, business effective date, recorded timestamp, source/reference, entry type, actor and reversal link. Use stable unique event keys for idempotency.
- Separate charge/credit-note events from cash receipt/refund events. Store allocations separately so allocations do not create a second cash movement.
- Write financial events atomically with their source transaction. Correct by reversing/posting a new event; never rewrite posted history. Limit backdating and retain both business and recorded dates.
- Support opening balances with provenance and approval. Reconstruct pre-migration history only where evidence is complete; otherwise import a reconciled opening balance at a published cutover date and mark earlier statements unavailable.
- Reconcile the journal against existing work/receipts/refunds before enabling it. Do not force a match where old cancellation rules are inconsistent: produce a discrepancy list for finance approval.
- Define due dates/payment terms and how credits allocate. Unknown due dates get an explicit 'No due date' bucket, not invented overdue days.
- Use exact money storage for new events; audit conversion/rounding when migrating existing values.

Important refund rule: a cash refund increases signed customer balance; a cancellation/credit note reduces the charge. These are separate events. Refunding does not automatically imply a new debt or a sale reversal. Existing logic can raise a partly refunded booking's receivable; review this policy before exposing it to clients.

## Phase 1 — customer statements (first deliverable)

Entry points: Customer 360 > Statement and Reports > Customer statement.

Filters: customer, date range, currency; all transactions or outstanding items. Optional booking/case filter must label its scope and compute opening balance for that same scope.

Header: agency identity/contact, customer name/code, statement period, currency, generation time and payment instructions configured by the agency.

Summary: opening balance, charges, credit notes, receipts, refunds, closing balance, amount due now and customer credit where applicable. Separate pending refunds from paid refunds.

Rows: effective date, reference, description, booking/PNR/case/invoice reference, charge/debit, receipt-or-credit and running balance. Clearly label a refund-paid debit; clients must not mistake it for a new service charge. Show optional traveller/travel date only where useful. No passports, supplier costs or internal margin in client output.

Formula: opening balance + charges + refunds paid + debit adjustments - receipts - credit notes = closing signed balance. Positive means customer owes agency; negative means agency holds customer credit. A pending refund is a separate payable disclosure, not cash already returned.

Illustrative statement:

| Date | Reference | Description | Debit | Credit | Balance |
|---|---|---|---:|---:|---:|
| 1 Oct | Opening | Brought forward | — | — | 10,000 |
| 3 Oct | BK-... | Confirmed flight charge | 40,000 | — | 50,000 |
| 4 Oct | RCP-... | UPI receipt | — | 30,000 | 20,000 |
| 6 Oct | CN-... | Approved fare credit | — | 5,000 | 15,000 |

Values are illustrative INR, not live customer data. A linked invoice does not add another INR 40,000 charge.

Outputs: on-screen statement, branded paginated PDF/print and transaction CSV/XLSX. PDF and spreadsheet must use the same report dataset and totals. Include carried-forward headings and totals on multi-page statements.

Sharing: first preview/download. Add explicit user-triggered WhatsApp/email sharing only after private statement delivery is implemented. No automatic bulk sends. Downloads require scope/export checks; shared links require expiry, revocation and audit. In-app sharing must not silently attach internal financial detail.

Phase acceptance: opening balance includes events before start; selected-period rows reconcile to closing balance; identical timestamps have stable ordering; linked invoices/receipts are counted once; credits, advances, partial receipts, cancellations and paid refunds work; reruns cannot duplicate postings; old cases and receipts survive migration; exports match screen and obey permissions.

## Phase 2 — collections and daily finance control

| Report | Required content and action |
|---|---|
| Customer outstanding and ageing | Customer totals, not due, overdue 1–30/31–60/61–90/90+ days, no-due-date bucket, due dates and owner; drill down to open obligations and generate statement. |
| Receipt register / daybook | Every receipt and paid refund, method, customer, allocation, collector, reference and business date; cash-in/cash-out/net totals. Call it a cashbook only once all agency cash movements are recorded. |
| Collections follow-up | Due amount, next due date, last contact, owner and next action; user-triggered reminders. |
| Customer advances / credits | Unapplied receipts, available credit and allocation history. Depends on advance/allocation workflow, not a guessed negative invoice. |

Age open amounts using the due date and event/allocation state at cutoff. A receipt after cutoff cannot reduce earlier ageing. Do not offset unrelated overdue items with unallocated credits invisibly. Exports include all matching rows, not just the current page or top 100.

## Phase 3 — suppliers and refunds

- Supplier statement: opening payable, supplier bills/cost events, credits, dated settlements and closing payable. Add supplier payment transactions before promising historical balances.
- Supplier ageing: due buckets, upcoming settlements, partial payments and booking/case links.
- Refund tracker: customer refund promised, approved, paid and still owed; supplier recovery expected, received and overdue. Keep supplier recovery separate from cash returned to the customer.
- Cancellation/reissue report: original charge/cost, retained fee, customer credit/refund, supplier recovery and any additional charge.
- Record partial supplier recoveries and settlements with dates/references; never infer historical cash from a mutable cumulative amount.

## Phase 4 — sales, margin and operations

- Confirmed sales by ticketing/visa, customer, destination, supplier, staff and period; quotes/enquiries remain separately visible.
- Service-level gross margin with cost coverage indicators. Distinguish gross booking value, agency fees/markup, supplier commission expected/received and net collections. Never label booking turnover as agency income.
- Uncosted/partially costed work report; no fake zero-cost profitability.
- Visa costs and supplier fees must be captured before visa margin is reported. Expense ledger and recognized revenue policies are prerequisites for net profit/P&L.
- Visa stage ageing, missing-document cases, turnaround and outcomes; ticketing deadlines, departures, cancellations/reissues; team workload and overdue tasks.
- Corporate consolidated statements, credit limits, commissions, saved views and scheduled delivery follow after foundations. New hotel/package/GDS/tax reports require their own transaction data; do not show empty modules as finished features.

## Implementation approach

- Add dedicated report services/APIs for customer statements, ageing, receipt register, supplier statement and refund exposure. Keep a shared journal/obligation/allocation calculation layer.
- Keep access scopes consistent across summary, detail, Customer 360, PDF, spreadsheet and shared links. Prevent report totals from revealing inaccessible records.
- Read each report from one consistent snapshot; paginate detail and aggregate in the database. Index customer/currency/effective date, allocation target, source event and due date.
- Preserve INR-only launch boundaries; never sum different currencies. Later reports group by currency and require explicit exchange-rate provenance for converted totals.
- Maintain transaction drill-down from each metric and explain report definitions. Show data exceptions instead of silently excluding unsupported records.
- Audit exports and statement sharing. Neutralize spreadsheet-formula injection in CSV/XLSX text fields.

## Verification and rollout gates

1. Finance approves charge, credit, refund, opening-balance and date policies using concrete examples.
2. Back up and run migration on a restored copy. Reconcile every customer's balance, not only a grand total.
3. Cover partial/multiple receipts, pre-period receipts, post-cutoff refunds, price edits, cancellations with retained fees, linked invoices, advances, backdated entries, mixed currencies, missing due dates and cross-scope access.
4. Render and inspect PDF pages with long names, many rows, blank periods and credits. Verify totals against UI and full exports.
5. Run regression and appropriate accessibility/responsive checks. Test realistic data volume before setting capacity promises.
6. Shadow-run against current finance figures; investigate all differences. Enable statements after sign-off, then customer sharing.

Recommended build order: Phase 0 + Phase 1 together, Phase 2 next, Phase 3, then Phase 4. Estimate calendar delivery after the journal migration and agency policy decisions are scoped; promising a quick statement PDF before those would hide the hardest dependency.

## Decisions to confirm during implementation

- Is the bill-to account always an individual customer, or are companies/agents billed for multiple travellers?
- When is a visa/booking charge committed: confirmation, invoice issue or another milestone?
- What are the default credit terms and cancellation/retained-fee policies?
- What opening-balance date and external records can finance verify?
- Which additional supplier/visa expenses and commissions are actually recorded today?

These questions do not block this plan. They gate posting and migration decisions during implementation.
