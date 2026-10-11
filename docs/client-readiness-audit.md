# Client readiness audit — 8 October 2026

## Status: in progress, no go-live approval yet

This audit supersedes the earlier walkthrough's completion claims. That walkthrough created a customer, visa case, booking enquiry, receipt, refund request and upload link, but did **not** exercise the full refund pipeline, actual ticketing, reissues, invoice creation, document upload/review, all roles, or mobile drawer interactions. A successful page response is not an end-to-end pass.

This pass uses a **new isolated SQLite database and private upload directory**, not the live database. Production on port 3210 and the unrelated app on port 3000 are not modified. Test evidence is stored under `test-artifacts/client-audit/` (ignored; contains only synthetic data). No external messages, charges or deployments are authorized by this audit.

## Acceptance criteria

- Inventory every currently implemented page, control and mutation, including APIs without reachable UI.
- Research travel-native CRM capabilities from primary vendor sources; distinguish missing features from optional integrations and client-dependent requirements.
- Exercise workflows using real browser input and check visible results, persistence, console/network errors and permissions; do not substitute direct API creation for a claimed UI pass.
- Label each case PASS, FAIL, PARTIAL, BLOCKED, API-ONLY or NOT IMPLEMENTED. Never infer broad coverage from a representative pass.
- Verify financial balances to the paise and compare money desk, workspaces and dashboard.
- Check public uploads, rejection/reupload, signed file access, expiry/revocation, employee/session controls, export, search and mobile behavior.
- Evaluate deployment separately: HTTPS, storage, backup **and restore**, startup/restart, security, dependency status, operational documentation and client acceptance.
- Deliver `docs/travel-crm-gap-analysis.md`, this report, and `docs/client-function-coverage.json` with an explicit go/no-go verdict and prioritized release gates.
- Report limitations rather than call untested work complete. No implementation fixes or public deployment in this assessment.

## Planned function inventory

| Area | Controls / cases to exercise |
|---|---|
| First run / authentication | Fresh root/setup; validation; owner creation; setup replay; wrong/correct login; show password; sign out; password change; session revocation; missing/denied route |
| Dashboard | Empty/populated KPIs; each quick action; refresh; priority filters; exception navigation/actions; financial coherence |
| Customers | New/cancel/close; individual/corporate/sub-agent; validation; search/type filters; primary traveller; duplicate contact handling; export; profile edit/reassignment availability |
| Customer 360 | All 12 tabs; all quick actions; context preservation; add/edit traveller; primary/DOB/passport fields; notes; activity; money masking; file views; links copy/revoke |
| Visa | New/cancel/back; customer/applicant selection; missing applicant; requirements; optional fields; fees; list filters; edit fields/dates; stage chips and select; closure/reopen/outcome; checklist completeness; WhatsApp update; collection |
| Ticketing | Enquiry/PNR; passengers; optional supplier/cost/source/deadline; list filters; extend deadline; statuses; actual ticket numbers; invalid/duplicate tickets; reissue request/start/replacement tickets/complete/reject; refund status guard; withdrawn sale guard |
| Money | Standalone/booking/case invoices; due date; collect deep links; partial/final receipt; customer advance; all payment modes; overpay-as-you-type; precision; receipt filters; refresh; export; invoice/receipt print, corrections and advance allocation availability |
| Refunds | Request/max/validation; each supplier/approval/processed/paid step; partial/full; rejection availability; net balance and withdrawn-sale behavior |
| Suppliers | New/duplicate/validation/cancel; payable; due/overdue; mark paid; filter; paid history/edit availability |
| Tasks | New from module/customer; owner/customer/priority/due/details; Open/Mine/Overdue/Done; mark done/reopen; export; edit/comment/cancel availability |
| Communications | Select customer/thread; filter; all five quick replies; substitutions; draft; log; safe handoff URL (do not send); Customer 360/history; provider/webhook unconfigured |
| Checklists | New; add/remove requirement; every rule; save; version supersession; old cases stable; expand/filter; no match; destination/applicant selection matching |
| Documents / portal | Generate/copy/list/revoke links; signed-out portal; per-traveller requirements; wrong signature/type/size; file upload; progress; view; reject; reason; reupload/version; accept; filters; expiry capture and submit/archive availability; optional extraction review (no OCR provider) |
| Team / access | Create/edit/reset/activate/deactivate; self-protection; duplicate email; role/branch; salary/bank; employee detail/workloads; owner/read-only/HR/accounts/operations/assigned role UI; cross-scope denial and API enforcement |
| Settings | Agency identity/windows; validation; save/persist; custom stage add/toggle; in-use/system guards; actual effects; role/branch configuration availability |
| Search / notifications / audit | Every indexed record class; keyboard arrows/Enter/Escape; scoped results; read/unread behavior; audit actors/entities/pagination/details; export authorization |
| Responsive/accessibility/errors | 420px dashboard/forms/customer/tables/drawer; keyboard closing/focus; page overflow; console/failed requests; offline/error recovery; date/timezone boundaries |
| Deployment | Current build/checks; dependency security; production storage assumptions; TLS/proxy/session configuration; backup and isolated restore; restart persistence; concurrency/idempotency; monitoring/recovery/runbook; client sign-off |

## Baseline evidence

- 24 `page.tsx` files and 43 `route.ts` files discovered (67 total). Includes private, authentication and public upload routes.
- Current source has no files newer than the production build ID when inspected.
- Fresh run: `npm run typecheck` exit 0; `npm run lint` exit 0; `npm test` exit 0 with 136 assertions. These are **API/render regression tests**, not 136 client browser workflows.
- Browser tests and deployment verification are pending; do not use this checkpoint as a release certificate.
