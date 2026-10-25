# Reporting and export review — 25 October 2026

Baseline: `c27b8e352a9bdaf55f94df9fb3da1376f0f402d6`, tree `3e5df6ecc245dbb40d02272cb257b203153ae123`.

## Research and decisions

Official sources were reviewed, not live competitor accounts. These are workflow benchmarks, not a claim that another product's accounting definitions fit this CRM.

| Product / official source | Documented behavior | Decision for Max Travel |
| --- | --- | --- |
| [TravelJoy commissions and sales](https://help.traveljoy.com/hc/en-us/articles/360016090912-Commissions-Sales-Reports) | Distinguishes booking, travel and commission dates; currency selection applies to the reporting tabs. | Preserve each report's explicit date basis and currency scope. Never relabel operational margin as accounting profit. |
| [TravelJoy teams and assistants](https://help.traveljoy.com/hc/en-us/articles/360028239792-Introduction-to-TravelJoy-teams-and-assistants) | Individual reporting and team-wide access differ by role; assistants do not receive all sensitive reporting. | Preserve permission checks and complete-account scope in downloads, not only screens. |
| [Travefy contact exports](https://intercom.help/travefy/en/articles/6387185-how-to-export-contacts-from-travefy) | Team exports are admin-only; protected fields are excluded; filtered export confirms the selection. | Download only authorized columns and make completeness/filter context explicit. |
| [WeTravel bookings report](https://help.wetravel.com/en/articles/14790109-how-to-access-the-bookings-report) | Separates booked, paid, upcoming and past-due amounts; offers export; documents UTC and periodic refresh. | Keep receipts, obligations and current workflow amounts distinct. Retain India-calendar dates and explicit generated UTC timestamp instead of adopting another system's timezone. |
| [TravelWorks dashboard and reports](https://www.travelworkssolution.com/travel-agency-software/dashboard-reports) | Describes deadlines, individual performance and manager/branch views. | Preserve readable context and scope. Public page does not verify native Excel layouts or column names; no inferred TravelWorks schema is used. |
| [Tourwriter reporting](https://learn.tourwriter.com/portal/en/kb/articles/reporting-in-tourwriter) | Separates itinerary, item and traveller-payment data sources; supports filters and CSV export. | Retain source-grain distinctions and existing report definitions rather than mixing trip cohorts with cash movement. |

## Confirmed defects fixed

- Generic payment/audit CSV silently stopped at 5,000 rows. These routes now return every matching row up to 50,000, fetching one extra row to detect overflow. Above that limit they return a 422 error and **no partial file**. The message directs users to date-filtered Receipts & refunds or Audit trail filters.
- CSV escaping differed across three routes. Whitespace/control-prefixed formula text could reach spreadsheets through generic export; negative numeric values were apostrophe-prefixed in generic/overview exports. A shared helper quotes every cell, escapes quotes/newlines, adds UTF-8 BOM/CRLF, protects untrusted formula-like strings, and preserves trusted numeric negatives.
- Empty generic exports lost their schema (`no data`). They now retain explicit machine-readable headers and omit finance columns when finance permission is absent.
- Generic date-only fields used UTC day slices despite the agency's India-calendar reporting. They now use the shared India-day conversion; exact audit timestamps remain UTC. Booking exports include their recorded currency when money is visible.
- Summary amounts in XLSX had no currency/precision format, and dates were text. Amounts remain numeric with two-decimal INR display; valid report-calendar dates are typed Excel dates. Unknown/not-applicable amounts stay blank, distinct from numeric zero.
- Excel details now include row count, complete-scope coverage, generated UTC time and blank-amount meaning alongside existing filters/definitions. Body rows have measured wrapped heights, restrained banding, readable headers, frozen header/identifier columns, AutoFilter and repeatable print headings.
- Enum statuses become readable labels in financial CSV/XLSX; arbitrary customer text and identifiers remain literal text, including numeric-looking references with leading zeroes.
- Export functions refuse a paginated report object rather than writing an incomplete report beside full totals. API exports already request the full report; this adds a fail-closed invariant.
- Financial filenames now include both selected start and end dates, without putting customer names into download filenames.

## Preserved financial and authorization behavior

No schema, dependency or financial calculation changes. No journal mutation or historical reconstruction changes. Historical receipt-allocation evidence still fails closed. Existing cancellation allocation, unknown-cost coverage, current-vs-historical explanations, supplier cash-recovery limitations and accounting reconciliation remain intact.

`payment:view` remains the established money visibility policy (also used by booking details). Generic downloads additionally require `export:data` plus the resource permission. Supplier statements/payables still require `supplier:view` and agency-wide finance access. The work does not add supplier costs to generic exports or introduce an alternative role policy.

Report-specific CSV/XLSX use declared columns only: internal navigation identifiers are not serialized. All nine reports continue to export the complete scoped selection rather than the screen's 50-row page. No misleading grand total is added to running balances, ageing buckets or mixed workflow measures. Summary figures remain authoritative server snapshot values, not invented spreadsheet formulas.

## Verification

Only synthetic data was used. Local test commands use Node's `--import tsx` loader: the optional `tsx` CLI IPC listener is unavailable in this sandbox. No browser or live service was launched.

- `node --import tsx tests/export-format.ts`: 101-row fixture; negative/zero/unknown/large amounts; literal hostile text; CSV quoting; XLSX dates, identifiers, numeric amounts, currency formats, row count, pane/filter/print settings; empty exports; rejection of partial objects; IST midnight boundary. Writes synthetic XLSX/CSV/PDF under ignored `tests/.runtime/export-format/`.
- `node --import tsx tests/export-routes.ts`: in-memory route dependencies, not real authentication. Verifies 5,001 complete payment rows, 50,001 refusal, no successful export audit on refusal, query scoping, permission denial, empty headers, withheld money, booking currency, India dates and UTC audit timestamps.
- `node --import tsx tests/reporting.ts`: **111 checks**, including existing disposable-SQLite accounting/journal/reconciliation suite and new complete-money/row round trips for all nine report workbooks.
- `tests/reporting-workspace.ts`, `tests/report-read.ts`, `tests/reporting-diagnostics.test.mjs`: passed.
- TypeScript no-emit, source ESLint and `git diff --check`: passed.
- Artifact Tool imported and rendered synthetic baseline and changed XLSX; both summary and transaction sheets visually inspected. Workbook values/formats were independently round-tripped through ExcelJS. No native Microsoft Excel desktop execution is claimed.
- Synthetic PDF was rendered with Poppler and text-extracted: repeated table headings, carried balance, page numbers and closing balance remain readable. PDF math/layout code was unchanged apart from completeness guard.

## Limits and follow-on boundaries

Native Excel print behavior and a real authenticated download click still need the integrated CI/browser run. The route-unit tests explicitly mock auth/database and do not substitute for security integration tests. No live client data was exported; no VPS, provider, production database or deployment was touched.

CSV cannot guarantee that spreadsheet applications preserve numeric-looking text identifiers on double-click. XLSX is the preferred human spreadsheet format for financial reports because it retains typed identifiers, dates and money. Generic CSV keeps existing machine-readable column contracts; import those identifier columns as text when needed.

Large-ledger refusal is deliberate. It is not a background export queue or streaming-export implementation. Existing date filters and report scope provide the supported narrower route. Extremely long cell text remains intact but may exceed Excel's maximum visible row height; it can be read in the formula bar. The export does not silently cut the data.
