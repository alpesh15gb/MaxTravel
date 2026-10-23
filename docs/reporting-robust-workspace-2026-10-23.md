# Reporting workspace: truthful filters, coverage and usable detail

Research and bounded implementation, 23 October 2026. Base: `db257d6`.
This is source inspection plus isolated synthetic tests, **not a live staff usability observation**. Live CRM sign-in is pending. Local browser execution was denied and was not retried. This worktree changes no accounting policy, database schema, role permissions or external service configuration.

## Findings addressed in this tranche

| Finding at base | Change | Acceptance evidence |
| --- | --- | --- |
| `ReportCentreClient.tsx` offered nine flat buttons; report purpose and date basis were easy to miss. | Searchable catalogue grouped into customer accounts, suppliers/refunds, sales/operations. Mobile chooser and optional search disclosure. The selected report's definition and India-calendar basis are visible before generation. | Pure catalogue/date tests; CI browser search, category, viewport and screenshot assertions. |
| Exports already used the applied query, but controls could be edited without showing that the displayed report was still on old filters. | Applied account/date/staff/status summary, unapplied-change status, restore action. Paging and downloads retain the applied query. Failed/new runs clear old results/downloads. Explicit loading, empty and recoverable error states. | Browser fixture preserves existing export-link assertion and adds metadata, dirty-state, retry and delayed-JSON checks. |
| Balance reports required an unused From date. Presets and cutoff-aware controls were absent. | One as-of date for ageing/payables; India today, last 7/90 days, this/last month for period reports. Statements clamp presets to the preserved-history date; wholly unavailable historical presets are disabled. Presets only edit controls; Generate applies them. | 7 pure checks include leap year, 18:30 UTC rollover, inclusive ranges, max 366 days, cutoff handling and query normalization. |
| `account-reports.ts` only set `party` for statements, while `report-export.ts` otherwise described every account as All permitted accounts. Operations exports claimed INR despite including all currencies. | Server-generated metadata names the actual selected customer/supplier, owner/status, date basis and coverage; CSV/XLSX carry it plus explicit Asia/Kolkata calendar. Supplier metadata ignores irrelevant customer filters even on direct API URLs. | Isolated register CSV/XLSX tests, supplier direct-URL tests and browser filtered CSV comparison. |
| Sales/operations labeled every Booking as Ticketing, even a HOTEL product. Cost coverage existed but an uncosted confirmed-booking count was absent. | Normalized product facts produce Flight/Hotel/explicit unknown. Added missing-cost count without changing any monetary formula. | INR hotel sales totals remain identical; non-INR hotel remains visible only in all-currency operations; missing-cost margin remains null. |
| Dense registers required horizontal reading on phones; async completion lacked a post-JSON identity check. | Full desktop table; phone record cards expose key fields and all remaining columns in a disclosure. Request abort plus generation guards protect report selection. Payment-terms save cannot be dismissed while pending and ignores unmounted completion. | Type/lint/build; CI delayed-response, pending terms, 1440/390/320 cards, geometry and screenshot assertions. Browser results remain pending. |
| Overview date edits were not distinguished from applied data, and stale data remained during failed reloads. | Explicit applied dates/current-vs-period coverage and summary-only CSV note; dirty-date warning; clear old data on new/error requests; response guard. Dates are disabled during application, so a completing request cannot overwrite newer edits. | CI overview held-response and dirty-export checks. |

The primary Generate action is attached to the filter form from the selected-report header, so it is available before long mobile filters. Catalogue titles are navigation labels, not headings preceding the page h1. CI checks the natural unscrolled action bounds at 390 and 320 px before clicking anything that could autoscroll.

## Date and money contract (preserved, now surfaced)

- **Customer/supplier statements:** journal effective date; opening balance brought forward. Earlier pre-cutover activity is an opening position, not reconstructed dated detail. Pending customer refunds are current workflow amounts, not historical cash.
- **Outstanding/ageing and supplier payables:** end of selected India day. Customer credit is separate from open obligations; missing due dates are not guessed overdue.
- **Receipts/refunds:** receipt received date and paid-refund date, not booking date. Pending requests are not returned cash.
- **Refund exposure:** requests created in the period with **current** workflow status; not an as-of historical exposure series.
- **Cancellations:** cancellation-date cohort; current recorded charge allocations and lifetime linked receipts/paid refunds. Not period cash flow.
- **Sales/margin:** booking date/visa creation date, current prices/status. Pipeline is separate from confirmed value; known-cost confirmed booking margin is not net profit. No costs are invented for visa work or missing-cost bookings.
- **Work/travel:** work booked/created in the period, showing current stage/travel/deadline fields. It is **not a travel-date filter**. All currencies, no monetary totals.
- **Overview:** sales use booking/visa/invoice dates; cash uses cash dates; Outstanding now is an all-date current snapshot. CSV contains summary breakdowns. Its outstanding panel is honestly capped at top 100; account-register exports include all matches.

### Historical receipt allocation boundary

The separately owned historical-ageing correction must be integrated with this UI. Historical ageing is unavailable when a scoped nonzero linked receipt has no verifiable allocation audit, including direct-created or platform-created receipts—not merely legacy imports. Unsupported historical totals should return a clear 409, not silently reuse today's allocation. Current-day ageing and customer statements remain usable. The error UI retains filters and offers explicit **Use today's balance** and, for a selected customer, **Open customer statement** actions; it never automatically changes the date.

## Existing capabilities deliberately retained

Nine account reports plus overview already existed. Complete-account finance scope, supplier ALL-scope requirement, refund/export permissions, audited exports, exact-paise journal arithmetic, single read snapshots, 50-row display pagination with complete exports, CSV formula neutralization, native numeric XLSX cells and single-party statement PDF exports remain unchanged. Downloads rerun applied filters against the latest records; they are not immutable saved snapshots, and the UI now says so.

## Evidence and CI wiring

- `node --import tsx tests/reporting-workspace.ts`: 7 checks passed.
- `node --import tsx tests/reporting.ts`: 60 checks passed before integration of the separately owned allocation correction. Existing totals/reconciliation assertions retained.
- `npm run typecheck`, `npm run lint`: passed after review fixes.
- `npm run build`: passed again after review fixes; existing Next middleware deprecation warning remains (the first uncached build also emitted framework Edge-runtime warnings).
- `node --check tests/reporting-browser.mjs`: syntax validation only, **not a browser pass**.
- `tests/reporting-browser.mjs` was not previously invoked by CI despite its artifact directory being uploaded. `.github/workflows/ci.yml` now runs it explicitly after a successful production build, with Chromium installed by the existing test job. `test-artifacts/reporting/` is already uploaded with `if: always()`.
- Browser fixture remains isolated: owned `tests/.runtime` SQLite, synthetic users and local app only. It preserves existing statement ₹81,400, linked drill-down, due-term permission, supplier, PDF/XLSX and no-runtime-error assertions, then adds dirty/applied metadata, delayed completion, error recovery, read-only direct-export 403 and responsive cards. The companion mobile journey now waits for the actual mobile cards rather than a hidden desktop table.
- Pending CI artifacts: catalogue and generated filtered/dirty reports at 1440/390/320; read-only/error screenshots; filtered CSV, XLSX and PDF. No live browser/auth claim is made.
- The `tsx` CLI test command could not start its optional IPC listener in this sandbox (`EPERM`); the supported `node --import tsx` entry point ran the same test files without that listener. No browser or network permission workaround was attempted.

### First CI evidence review and follow-up

Run `40040827807` executed the reporting browser fixture successfully. The full test chain identified nine raw-color token violations in the new scoped CSS; those were corrected to existing semantic tokens without changing the gate. Source-resolved text contrast remains above 4.5:1 and focus-ring contrast above 3:1.

Actual `filtered-sales-1440.png` review then showed insufficient horizontal cell spacing despite functional assertions passing. The follow-up adds scoped inline cell padding/minimum widths, an actual rendered-text spacing assertion (20px minimum between adjacent header/value text), geometry JSON and a rightmost-column screenshot. The existing horizontal scrolling region remains keyboard-focusable. Actual `history-error-320.png` showed a responsive sidebar transition captured mid-frame; deliberate captures now wait for real drawer visibility/animations and restore document scroll top, without hiding UI or forcing focus. The initial Generate-button viewport assertion still runs at the natural top position before any action can scroll to it. Staff names now have a human-readable display value from already scoped rows; technical exports retain the applied owner identifier. These follow-up geometry/capture assertions require a new CI run; their presence is not a browser-pass claim.

## Remaining priorities, not implemented here

1. Persist verifiable allocation history across every receipt creation path before promising broad historical ageing availability. Do not fabricate missing past allocations.
2. Add travel-date and supplier/product dimensions only with explicit date-basis definitions and matching drill-down/export tests. Hotel check-in is not currently a separate Work/travel filter.
3. Add metric-to-record drilldowns, sorting and shareable/saved filter URLs while preserving complete-account scope and applied-query consistency.
4. Frozen report snapshots/export jobs and bounded large-data performance need a separate design; current complete exports are rerun synchronously.
5. Commissions, general-ledger P&L, taxes, multi-currency conversion and recognized revenue require business/accounting policy decisions. UI changes must not imply these exist.
6. Live owner/staff usability observation, keyboard/screen-reader review and CI screenshot inspection remain necessary before claiming the reporting experience is verified end-to-end.

## Official research informing the design

These are product/help and standards sources, not proof that our implementation behaves correctly:

- [Travefy: How to Create Reports](https://intercom.help/travefy/en/articles/13627539-how-to-create-reports): report exports follow selected booking/travel, supplier and advisor filters. Supports making applied filters explicit at export.
- [Rezdy: Reports—Transactions](https://support.rezdy.com/hc/en-us/articles/19867758498716-Reports-Transactions): distinguishes payment, order and fulfilment dates; detailed filtered rows and full-result downloads. Supports explicit date basis and detail completeness rather than one ambiguous date range.
- [TravelJoy: Commissions/Sales Reports](https://help.traveljoy.com/hc/en-us/articles/360016090912-Commissions-Sales-Reports): separate booking/travel/commission timing and currency considerations. Supports stating money coverage, not treating all sales-like totals as profit.
- [React: useEffect](https://react.dev/reference/react/useEffect): fetch cleanup must prevent stale completion from updating state; abort alone is not the whole presentation contract.
- [W3C: Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html): loading/results/errors should be programmatically announced without unnecessary focus changes. The workspace uses short status messages instead of making the entire result table a live region.
