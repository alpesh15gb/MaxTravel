# Employee and record audit review — 20 October 2026

## Recommendation and official product evidence

Use two linked views: an administrator's searchable employee audit and contextual record history. Do not equate ordinary customer interaction notes with a reliable mutation audit.

- [Zoho CRM: Monitoring Audit Logs](https://help.zoho.com/portal/en/kb/crm/security-control/audit-log/articles/monitor-audit-log): chronological user actions, entity/user/action/date filters and filtered export. Its hierarchy model is product-specific; MaxTravel retains its existing permission and branch/assignment rules.
- [Zoho CRM: Timeline in Record Detail Page](https://help.zoho.com/portal/en/kb/crm/manage-crm-data/timeline/articles/timeline-in-record-detail-page): record-context change/interaction history, user/time/source filters. Supports the contextual-history recommendation, not copying Zoho's retention promises.
- [TravelJoy: February 2025 updates, published March 6, 2025](https://traveljoy.com/blog/post/traveljoy-travel-agency-software-updates-feb-2025): form-submission audit on submitted trip forms, recording sent/opened/signed events. This is evidence of contextual audit in travel-agency software, **not evidence of a universal employee-change audit**.

## Delivered

- `/audit`: employee name/code/ID (or `system`), inclusive IST date range (matching the agency timestamp display and financial reports), exact action, record type and record ID filters; persistent filtered pagination; full record IDs and untruncated details; record-specific history links.
- `/api/audit`: authenticated `audit:view`, same scope/filters and bounded pagination, private no-store response.
- Audit CSV uses identical scope and filters, deterministic ordering, existing 5,000-row limit and export permission. Previously it was unscoped.
- Shared `AuditTrailLink` integrated into customer, visa and booking detail by respective screen owners, plus compact History actions on task/document/refund rows and desktop/mobile invoice/receipt rows; existing `audit:view` permission required. No permissions expanded.
- Scope follows affected record, not actor branch: an employee in branch A acting on a branch B record does not make it visible to branch A. Restricted users see currently accessible Customer, Booking, VisaCase, Document, Traveller, Payment, Invoice, Refund and Task records. Unknown/deleted/global records fail closed; ALL-workspace administrators retain them.
- Customer profile corrections log changed field names, customer reference, safe status transition, assignment IDs and related-work-handover flag, transactionally. No profile values, credentials or document contents copied. No-op saves do not add misleading changes.

## Explicit remaining limits

- Existing event detail is heterogeneous; this does not retroactively reconstruct changes or promise every screen action was audited. Read-only page visits are not employee work and are not automatically logged.
- Historical branch/assignment snapshots do not exist in AuditLog. Deleted records and global configuration events are intentionally unavailable to restricted roles; a migration is needed for historically scoped retention. Current record access can change after reassignment.
- Bulk handover records the customer-level summary, not individual before/after audit entries on every affected child. Other existing generic edits still need explicit safe field-name summaries.
- Central filtering is not an immutable/WORM or tamper-evident audit archive. No new retention/deletion policy is asserted. Audit indexes/snapshot columns are a future schema migration; current scope resolves accessible IDs.
- Static scan found setup, notification acknowledgement and public upload routes without direct audit calls; webhook handlers may delegate to audited helpers. This is a review queue, not a claim that all are defective. Upload intake warrants a separate privacy-aware actor/source event review.

## Verification

`node --import ./scripts/standalone-server.mjs --import tsx tests/audit-visibility.ts` passed against a freshly migrated isolated SQLite database (`prisma migrate deploy`). Scenarios: cross-branch actor vs affected record, restricted explicit record filter, ASSIGNED access, missing branch fail-closed, ALL administrator, system actor, inclusive day-end/exclusive next-day, malformed/reversed dates, field-name-only details, every linked list-row entity (Task/Document/Refund/Invoice/Payment) under both BRANCH and ASSIGNED scope, and shared query use by page/API/CSV. This is query integration plus source wiring verification, not browser or HTTP authorization testing.

`npx tsc --noEmit --pretty false` passed. Parent owns aggregate build/browser checks and publication. No live data accessed or changed; no commits or external business actions.
