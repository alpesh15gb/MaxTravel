# Reporting upgrade — installation and acceptance

Local implementation, 13 October 2026. This does not update the VPS automatically.

This release also formats WhatsApp document requests with a greeting, bold section labels,
numbered document lines, a standalone private URL and an expiry labelled IST. The worker upgrades
valid unsent automatic requests from the previous paragraph layout when claiming them for delivery;
it does not create duplicate messages or change messages already sent. Manual built-in document
templates use the same numbered list. Agency-authored custom templates remain agency-controlled.

## What ships

- Reports catalogue: customer statements, customer outstanding/ageing, receipts/refunds register, supplier statements/payables, refund exposure, sales/cost coverage and work/travel register. Existing business overview remains available.
- Customer 360 > Customer statement opens the report with the customer selected.
- Customer/supplier statements: opening, movements, closing, running balance; A4 PDF with repeated headers and carried balances; XLSX/CSV with all rows. Registers export XLSX/CSV.
- Set explicit booking, visa-case and standalone-invoice due dates from customer ageing. Terms changes preserve earlier journal snapshots.
- Exact integer paise in a BigInt journal; transactionally recorded charges, adjustments, receipts, paid refunds and supplier settlement changes. Reissue charges and rejected reissue reversals are included.
- Scoped customer access, separate supplier/refund gates, export permission checks and audited exports.
- Read-only source-to-journal reconciliation command.

## Before migration

Schedule a maintenance window. Stop incoming financial writes, including the worker if it can cause writes. Back up the database and upload tree using the existing backup procedure and verify a restored copy. Keep the previous release identifier and its matching backup.

The migration adds `FinancialEntry`, `Booking.paymentDueDate` and `VisaCase.paymentDueDate`. It does not delete or replace existing data. Existing records become source-specific opening entries at migration time. Their original invoice/receipt dates are not fabricated into historical journal rows. New entries are recorded at write time.

The journal does not change existing charge/refund policy: priced enquiries remain operational demands; a partial paid refund can raise the current demand balance; cancellation withdraws the charge and exposes the remaining held money as customer credit. Reconcile these definitions with the agency's business policy before sharing statements with clients.

## Deploy using the existing container workflow

Use the compose files already active on the server. Preserve Evolution overrides if installed; do not replace them with a different compose invocation. Follow [VPS deployment instructions](vps-nginx-deploy.md) and [Evolution instructions](evolution-pilot.md).

After backup and updating the source, rebuild/recreate the app using that existing workflow. The container entrypoint applies committed migrations before serving. New runtime dependencies include PDFKit, ExcelJS and a bundled Noto Sans font; use the updated lockfile and rebuild the image. Do not copy only `.next` into an old image.

With the app started, run inside the app container:

```bash
node scripts/reconcile-reporting.mjs
```

For example, on the existing single-file VPS configuration:

```bash
docker compose -f compose.vps.yaml exec app node scripts/reconcile-reporting.mjs
```

For an active Evolution compose setup use its existing `docker compose exec app ...` invocation instead. The reconcile command reads data and exits nonzero on a mismatch; it does not repair anything or rewrite financial history.

## Deploy without Docker

Stop the old application before migration and preserve its environment/database path.

```bash
npm ci
npm run db:generate
npm run db:migrate
npm run reports:reconcile
npm run build
npm start
```

Run with the application's configured environment. Never run migrations against a newly invented database path or use `prisma db push` in place of the committed migration.

## Acceptance on the deployed instance

1. `/api/health` must be healthy; inspect migration/startup logs.
2. `reports:reconcile` must report zero source differences. Investigate nonzero differences before issuing client statements.
3. Open an existing customer statement. Compare opening and closing signed balances with the customer's demands, actual receipts and paid refunds. Negative means customer credit; it is not a negative receivable to be silently netted against another customer.
4. Open customer ageing and verify explicit/no due-date buckets. A linked invoice does not add a second charge or give the entire booking its due date automatically.
5. Record a small authorized real financial transaction through normal workflow only if operationally appropriate; verify its journal/statement movement. Do not put fake demonstration money in production.
6. Download PDF and XLSX; verify agency/customer identity, all transactions, dates and totals. PDF contains only the selected party statement, never internal supplier costs/margin.
7. Check a restricted user's reporting access and export permissions.
8. Resume normal writes and the worker after acceptance. Keep the backup until the agreed recovery window has elapsed.

## Definitions and remaining boundaries

- Historical statements/ageing before the migration cutoff are unavailable. Existing source balances are brought forward explicitly. Receipt registers retain original receipt dates.
- Statements use signed account positions; outstanding lists show positive obligations and credits separately. These can intentionally differ from the old dashboard's clamped receivables. Pending refunds are disclosed separately and labelled current, even on a past statement.
- Supplier history is preserved from migration onward. Earlier partial settlement dates cannot be recovered from a cumulative `paidAmount` and single `paidOn`.
- Only INR is supported; non-INR bookings and their cash movements are excluded rather than converted using invented exchange rates.
- Supplier financial reports require agency-wide finance scope because existing supplier dues carry no branch ownership. Mixed-owner customer accounts are not exposed as misleading partial statements.
- This release does not introduce a general ledger, statutory P&L/GST/TDS reporting, expense entry, commission settlement, foreign-exchange accounting, customer-credit allocation, automated statement delivery or quantified partial supplier-refund recoveries. Those need additional financial workflows and policy decisions.
- Reports are not automatically sent to clients. Download/preview statements first. Document-request WhatsApp messages now use numbered lists, separate link/expiry lines and clear spacing. Valid unsent legacy automatic requests are reformatted when processed; already sent messages are unchanged.
- Reporting calculations currently read scoped source/journal records in a consistent snapshot and paginate the response. Large datasets still require profiling and database aggregation before multi-office scaling.
- PDF embeds a Latin Noto Sans font. Test the actual customer names used by your agency; broader script coverage requires additional fonts.
- Existing development dependency audit advisories remain. The new Excel export uses a patched UUID override rather than introducing the vulnerable transitive version.

## Local checks

```bash
npm run typecheck
npm run lint
npm run build
npm test
node tests/reporting-browser.mjs
```

The reporting tests migrate a copy of the previous schema with synthetic records and verify its opening balances, transaction history, ageing, scope, exact paise, complete XLSX and real PDF output. All test databases/uploads live under ignored `tests/.runtime/`; the configured live database is not used.

See [reporting-upgrade-plan.md](reporting-upgrade-plan.md) for the broader roadmap. This release implements the available-data reporting foundation; the remaining boundaries above are not presented as finished features.

Verified locally on 13 October 2026: production build, 26 reporting checks, WhatsApp formatting checks, 198 smoke checks, 37 workflow checks, accessibility checks and the UI metrics gate passed. Browser verification covers customer statements, PDF/Excel exports, due-date editing, supplier statements and phone layout. No live deployment or real WhatsApp send was performed.
