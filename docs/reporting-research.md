# Travel CRM reporting and launch review — 11 October 2026

The agency confirmed one office, one server and up to 20 staff. This pass retains
the existing visa/ticketing workflow and adds decision-oriented reporting.

## Research and product decisions

- [TravelJoy business overview](https://help.traveljoy.com/hc/en-us/articles/38940307804436-Business-Overview-Report)
  groups sales and business activity with date filters. Decision: make Reports a
  permanent navigation destination, with current-month defaults and explicit dates.
- [TravelJoy reporting types](https://help.traveljoy.com/hc/en-us/articles/360016090952-What-types-of-reporting-can-I-see-in-TravelJoy)
  separates sales and funds reporting. Decision: keep sales value, actual receipts,
  paid refunds and present outstanding balances distinct.
- [Rezdy report overview](https://support.rezdy.com/hc/en-us/articles/19867712055068-Reports-Overview)
  uses time trends, booking status and payment methods. Decision: show monthly
  sales/collection bars and booking, visa, payment-method and task breakdowns.

These are product design references, not claims that this app has all vendor features.
The app's existing data model supports visa cases and flight bookings; it does not
currently support itinerary proposals, commission splits, GDS inventory or card charging.

## Delivered

- `/reports` and `/api/reports`: finance permission required; CSV additionally requires
  export permission and writes an audit entry. Scope follows branch/assigned record rules.
- India-calendar date ranges, inclusive final day, maximum 366 days; invalid dates rejected.
- No invented trends: empty periods explain how actual transactions populate reports.
- Sales omit withdrawn/non-INR bookings and linked invoices. Outstanding uses the shared
  receivables definition. Margin explicitly excludes bookings without positive supplier cost.
- Report definitions explain enquiry/quote inclusion and the distinction from accounting revenue.
- Responsive navigation/search, keyboard skip link, more breathing room and panel hierarchy.
- Notifications require an explicit mark-read action instead of silently clearing the inbox.
- Docker Compose single-instance packaging, optional HTTPS proxy and packaged backup/restore tools.
- Database configuration no longer accepts a PostgreSQL/MySQL URL against a SQLite-only schema.
- Production Docker dependencies exclude build-only tooling; Prisma remains for migrations.

## Verification and limits

The regression suite includes report authentication, HR exclusion, invalid date ranges,
dashboard receivable reconciliation, complete receipt totals, monthly total reconciliation,
CSV and export auditing. Accessibility and UI metrics include Reports at desktop and phone widths.
See generated `verification-results.json`, `test-artifacts/a11y/report.md` and
`test-artifacts/ui/report.json` for the latest actual results.

`tests/container-launch.mjs` verifies the built container in a disposable volume, including
20 concurrent authenticated report/pulse reads, restart persistence and backup/restore.
That read probe is not a 20-staff mixed-workload capacity certification.

Build-tool dependencies retain upstream audit advisories (including the unpatched braces
3.0.3 advisory); they are excluded from the runtime image. Run full and production-only
dependency audits separately and do not interpret the latter as a clean development audit.

The app remains single-instance SQLite, uses Float storage with paise arithmetic, and loads
accessible financial work records to calculate current balances. Large datasets need query
profiling and likely reporting aggregation. Reports are operational summaries, not a tax,
statutory accounting, invoice-ageing or audited profit-and-loss system.

See [single-office-launch.md](single-office-launch.md) for installation, HTTPS, backups,
actual-server acceptance and the remaining deployment-specific work.
