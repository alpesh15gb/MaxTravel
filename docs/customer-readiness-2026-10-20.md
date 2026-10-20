# Customer-readiness review — 20 October 2026

## Scope and benchmark

This review improves daily agency operations, not just appearance. Relevant official workflow comparators (not a popularity ranking):

- [TravelJoy dashboard](https://help.traveljoy.com/hc/en-us/articles/360016247971-Using-the-Dashboard): trip stages, waiting-on status and task queues.
- [TravelJoy daily workflow](https://help.traveljoy.com/hc/en-us/articles/9335768898836-Step-2-Optimize-your-workflow): overdue and due-today work.
- [Travefy CRM](https://avanti.travefy.com/products/crm): customer profiles connected to trips, tasks and invoices.
- [Tern agency operations](https://tern.travel/agencies): agency oversight and trip reporting.
- [Tourwriter payments](https://learn.tourwriter.com/portal/en/kb/articles/itinerary-payments): separate customer and supplier balances.

## Implemented

- Dashboard work queues separate travel deadlines, documents, payments/refunds and follow-ups, using actual records and counts.
- Consistent workspace hierarchy and navigation, accessible mobile drawer, customer cards at narrow widths and useful customer filters.
- Task Today includes overdue work; closed history no longer crowds open tasks out of the query. Editing preserves assigned owner and local datetime values.
- Branch checks fail closed when the user has no branch, including focused task links. Record assignment checks match list scoping.
- Manually entered bookings cannot claim the reserved external-platform source and lock themselves against manual edits.
- Sales lists resolve customers beyond the 500-entry picker; lost enquiries cannot publish or convert accepted quotes.
- Task state changes are transactional and audited; repeated completion does not change the original completion timestamp.
- Backup manifests count snapshot data and hash copied files, not live data. Restore verifies source integrity and refuses stale SQLite recovery sidecars before overwrite.
- Container build context excludes environment secrets and key files. Deployment documentation covers encryption-key recovery and private first-run setup.
- Evolution Compose explicitly selects its provider; Meta Compose remains the preferred documented integration.

## Validation and release gates

Regression tests added: `tests/workflow-regressions.ts`, `tests/backup-restore.mjs`, and additional HTTP checks in `tests/staff-sales-flow.mts`. Existing typecheck, lint, build, reporting, core security, smoke, accessibility and UI gates remain required; budgets have not been relaxed. CI retains UI screenshot artifacts for review.

The local environment blocks Chromium process sockets; browser verification must not be claimed on the basis of a successful compile. The existing CI browser jobs are the independent visual/accessibility gate. Optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` supports explicitly selected managed Chromium on review hosts; CI continues to use its pinned browser.

## Customer-site acceptance still required

This change does not deploy to a customer or prove a live installation is ready. Before handover, complete `docs/single-office-launch.md`: actual-host HTTPS and private bootstrap, owner/restricted-staff checks, backup + restore drill including encryption keys and documents, expected peak concurrent use, provider credentials/webhook delivery, health/backup alerts and office-specific configuration. SQLite remains a single-server architecture; do not run replicas or use a network filesystem. No production data or provider credentials were used in this review.
