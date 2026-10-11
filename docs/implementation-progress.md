# Travel OS — implementation checkpoint (8 October 2026)

Implementation was authorized after the audit phase. This report supersedes the audit-only
documents for release decisions. The live agency database, its uploads and the production
build in `.next` were not modified; every change was built and verified against an isolated
runtime database and the dedicated output directory `.next-implementation`.

## Verified working

Gates (all run against the final tree):

- `npm run typecheck` — exit 0
- `npm run lint` — exit 0, no warnings
- Isolated production build (`NEXT_DIST_DIR=.next-implementation npm run build`) — exit 0 on Next.js 15.5.27
- `npm test` regression suite — 137/137 checks passed
- Real-browser acceptance (`tests/implementation-verify.mjs`) — 12/12 checks passed
- `npm audit --omit=dev` — 0 vulnerabilities in the production dependency tree

## Security and correctness fixes

1. **Next.js upgraded 14.2.35 → 15.5.27 (exact).** Removes the Windows filesystem RCE
   (GHSA-p293-qw3h-jr36), the SSG/ISR cache-poisoning advisories and the bundled vulnerable
   postcss. A `postcss` override pins the resolved copy at 8.5.29. Dev-only advisories
   (braces/chokidar/fast-glob via Tailwind 3 and eslint-config-next) do not reach production.
2. **Cross-origin mutation protection (`src/middleware.ts`).** All non-GET API requests now
   reject cross-site `Origin`/`Sec-Fetch-Site`, including first-run setup — closing the
   127.0.0.1-vs-localhost setup bypass and the missing origin checks on ordinary mutations.
   Responses are `private, no-store`.
3. **Finance leak closed.** Ticket fares, reissue fare differences/penalties and receipts are
   masked server-side for roles without `payment:view`; the operations role sees explicit
   restricted notices. Customer 360 visa balances and the visa list follow the same rule.
4. **Internal error messages no longer leak.** `jsonError` returns a generic 500 body; details
   go to server logs only.
5. **Visa readiness is enforced.** Stage transitions to submission and beyond are transactional
   and blocked until every required document is received, verified where the checklist demands
   it, and not expired before the travel date. Approval/rejection decisions reset coherently
   when a case reopens; outcome and decision dates can no longer persist backwards.
6. **Reissue chain repaired.** Original bookings now show their chain and Start/Complete/Reject
   controls (`reissueChain` was previously unqueried). Reissue selling price includes the
   airline penalty in the fare breakdown (stored as taxes) instead of vanishing from the math.

## Workflow capabilities added

- **Customer corrections & handover** — full profile edit (name, contact, type, status,
  address) plus relationship-manager reassignment, optionally carrying bookings, visa cases
  and open tasks, restricted to owner/branch-manager roles, audited.
- **Booking corrections** — PNR entry converts a saved enquiry to PNR_CREATED; airline,
  sector, flight, dates, supplier editable. Fare components require finance permission and
  lock once tickets/payments/invoices exist — changes then require a reissue.
- **Task management** — edit title/owner/priority/due/details while open; cancel with
  confirmation; cancelled tasks stay visible under Done; details render on the card.
- **Refund rejection** — Reject action in the refunds desk requires a recorded reason and an
  authorized approver; the reason is stored and displayed.
- **Documents** — the portal now demands an expiry date for expiry-checked requirements and
  stores it; rejected documents appear in the Re-upload requested queue with their reason;
  re-upload clears verification state.
- **Quick replies actually work** — the inbox always offers the five built-in templates
  (previously an empty dropdown on fresh installs); selection resolves placeholders
  server-side (customer, outstanding, PNR, deadline, stage, docs) and unresolved `{tokens}`
  are blocked from logging.
- **Printable finance documents** — invoices and receipts render print/PDF-friendly pages at
  `/payments/print?invoice=…|receipt=…`, scoped and access-checked, with honest "not a
  statutory GST document" wording and printed-by attribution.
- **Supplier payables** — payables support part payments and full settlement, reopen, paid
  history, editable supplier master details, and the open-payables stat now reflects
  remaining balances.

## Known remaining limits (not hidden)

- Rejected-refund reasons replace/append to the single reason field; there is no separate
  rejection-reason column.
- Booking financial fields freeze after first commitment; structural amendments still go
  through the reissue flow only.
- Checklist matching still binds one applicant type per case; per-applicant checklists remain
  future work.
- No GST/tax computation, credit notes, advance allocation, import/merge, commissions,
  quotations or client self-service portal. This remains an operations workspace, not an
  accounting or full-CRM replacement — see `docs/travel-crm-gap-analysis.md`.
- The App Router RSC refresh can occasionally serve a stale render right after a mutation in
  rapid automation; a reload always shows committed data. Watch in real use; if it annoys
  staff, move critical desks to router.refresh-free navigation or explicit reloads.

## Deployment gates still outstanding (unchanged)

Production HTTPS/TLS termination and proxy config, backup **and restore** rehearsal, restart
persistence, monitoring/alerting, client data migration, accountant sign-off on tax wording,
and client acceptance testing on the client's own hardware. The demo workspace
(`tests/demo-server.mjs`, port 3212) is for review only — not a deployment.
