# Messaging retirement and maintenance worker

The 2026-11-03 release removes WhatsApp from the CRM and public booking application: inbox, composer, consent, quick replies, provider setup, callbacks, sends, queues, alerts, reports, phone-contact buttons and package contact fields. Customer email, internal staff chat and private business documents remain.

The committed migration removes the retired provider tables and configuration. Existing customer documents stay attached to their business records. Generated/imported PDFs move to the generic PrivatePdfAttachment model without deleting their stored files; staff access stays scoped. Old public/provider attachment endpoints are removed. Security audit history and applied historical migration files are retained.

Use the current pinned VPS updater. It verifies backups before applying migrations and changes the existing active CRM worker to scripts/maintenance-worker.mjs and /api/jobs/maintenance. It carries the shared worker authentication secret into CRM_WORKER_SECRET, strips WA_/EVOLUTION_ environment values from the candidate CRM containers, and detaches their dedicated provider network. It preserves private database/upload mounts, SMTP, the data-encryption key and active-service selection. Unrelated standalone services are outside this application rollout. Private recovery snapshots retain the previous configuration for rollback.

For new installations, combine compose.vps.yaml with compose.worker.yaml. Configure the same CRM_WORKER_SECRET in app and worker; it must contain at least 32 characters. No provider credentials are required. The worker runs customer email, work/follow-up materialization, payment-collection reconciliation and guarded Max ID closure. APP_ORIGIN and the normal staff security controls remain in force.

Old webhook subscriptions in a separately managed provider account may be disabled there by the account owner; the app no longer processes those callbacks. Previous deployment guides and verification reports describe historical releases; use this retirement guide and current environment example for the active configuration.

## Verification

Both applications were built in isolated production fixtures. The populated SQLite upgrade proves preservation of customer documents, imported PDFs, audit, staff, internal chat and queued customer email, with no foreign-key violations. PostgreSQL schema validation passed; no PostgreSQL server migration or VPS rollout is claimed by these local checks.

Focused CRM tests cover worker authentication and lease protection, work reminders, Max ID closure, encrypted legacy contact preferences, signed booking events and private PDF access, customer Masters, imports, reporting (111 checks), agency payment/release workflows, reset numbering and the reset/encryption operator tools (35 tests). Booking checks cover 489 unit tests, nine package contract tests, build/type/lint, 38 desktop/mobile browser scenarios and six final affected contact/footer/package checks. The updater suite covers 39 tests plus targeted retirement assertions for unknown workers and shared network preservation.

The final CRM UI review covers 25 routes at desktop and phone sizes, zero accessibility findings outside the established budget, and actionable task/document/sales handoffs. A former communication bookmark now redirects to permission-checked Customer email, and the visa page keeps a primary Edit Case action. There is no placeholder provider UI or automatic fallback integration.

All scenario data was synthetic. These checks did not send real customer email, issue supplier bookings, take payments or modify a VPS database. Run the pinned update and check the live application after the operator rollout.

Final browser checks also passed: five navigation/scope/transaction groups, 12 customer Masters groups, six case-workflow groups with 48 screenshots, 12 agency transaction groups, and five internal-chat groups. Binary finance exports were validated for HTTP status, MIME type and file signature.
