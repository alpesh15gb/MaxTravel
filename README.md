# Max Travel CRM — Travel Agency Operating System

Deploy on the existing Ubuntu VPS: [Docker + system Nginx installation and updates](docs/vps-nginx-deploy.md).

Use the official [Meta Cloud API setup](META-WHATSAPP-SETUP.md) for WhatsApp. The Evolution guide is retained for legacy installations.

Latest additions and rollout: [CRM completion update](docs/crm-completion-2026-10-18.md). Includes staff MFA/sessions, encryption, enquiries/quotes, incoming documents, applicant checklists, customer import and advance allocation; the document explicitly records remaining finance and release work.

Travel workflow benchmark and prioritized roadmap: [Travel CRM benchmark](docs/travel-crm-benchmark-2026-10-18.md). The supplier desk includes booking-linked payables and an auditable settlement ledger; imported statement reconciliation is still a later workflow.

Operational system for visa processing, air ticketing, payment collection, document
collection/verification, WhatsApp communication, employee tasks, and supplier/refund
tracking. Built around: **Search anyone, know everything, see what is pending, take action.**

The workspace is a premium light UI: warm white surfaces, deep navy text, teal actions,
quiet semantic status colours, a persistent navigation rail on desktop that becomes a drawer on small
screens, and universal search. Screens open straight on the greeting, the numbers and the work — no
marketing filler.

## Run

```bash
npm ci
cp .env.example .env        # set DATABASE_URL, a real JWT_SECRET and APP_ORIGIN
npm run db:generate         # generate the Prisma client
npm run db:migrate          # create the SQLite database from the committed migrations
npm run build && npm start  # http://localhost:3000
```

Open **`/setup`** on a fresh install and create your agency and its owner account. This is
the only account created for you; every other person, customer and transaction is entered by
real staff. No demo customers, employees, invoices or credentials exist or are seeded.

```bash
npx prisma db seed   # optional, safe: initialises only role and visa-stage definitions
```

The seed never creates users, branches, customers or transactions, and it never deletes
anything. Roles and workflow stages can also be edited from **Settings** afterwards.

> **Protect the first run.** Whoever reaches `/setup` first becomes the owner. Do that on the
> machine that will host the app before exposing it on a network or the internet.

## Modules

**Reports & insights** (`/reports`) provides date-filtered sales, net collections, current
receivables, costed booking margin, monthly trends, workflow breakdowns and audited CSV export.
The report catalogue also includes customer and supplier statements with running balances,
PDF/Excel/CSV exports, customer/supplier ageing, editable payment due dates, a receipt register,
refund exposure and detailed sales/work registers. Preserved financial history starts at the
journal migration cutoff; existing records become explicit opening balances. Customer 360
links directly to the selected customer's statement. Run `npm run reports:reconcile` to verify
source positions against the journal without changing data.
See [reporting deployment and acceptance](docs/reporting-deployment.md) before updating a live office.
See [reporting research](docs/reporting-research.md) and the
[single-office launch guide](docs/single-office-launch.md) for the latest work and deployment path.

**Workspace** — Agency pulse (`/dashboard`), Customers + Customer 360, Visa cases, Ticketing,
Documents. **Finance** — Money & invoices, Refunds, Suppliers. **Operations** — Tasks,
WhatsApp desk, Team. **Manage** — Visa checklists, Audit trail, Agency settings.

- **Agency pulse** answers "what needs attention now": PNR deadlines, overdue money,
  dossiers blocked on documents, passport-validity warnings, unverified documents, supplier
  dues, pending refunds and overdue tasks. A fresh workspace shows truthful zeros and a
  getting-started path instead of invented trends.
- **Customer 360** (`/customers/[id]`) connects travellers, cases, bookings, documents,
  money, refunds, WhatsApp history, tasks, notes and an activity timeline with permitted
  quick actions.
- **Universal search** (`⌘K`) spans customers, travellers, employees, phone/email, case,
  booking, invoice, receipt and document references, ticket numbers and PNRs, honouring the
  signed-in user's scope.
- **Client upload portal** (`/upload/[secure-token]`) needs no login: expiring tokens,
  per-document status, real progress, and private storage behind short-lived signed URLs.

## Money and references

Invoices and receipts are recorded in **integer paise** and written in one database
transaction with the linked booking/case balances, so partial receipts, overpayment
rejection and cross-customer allocation checks cannot drift apart. Staff pick a customer and
a related record from loaded lists — never a raw database ID. Records carry readable agency
reference numbers (`C-2026-0001`, `VC-2026-0001`, `BK-2026-0001`, `INV-2026-0001`,
`RCP-2026-0001`, `DOC-2026-0001`, `EMP-2026-0001`).

Money owed is derived in **one** place (`src/lib/receivables.ts`) so the dashboard, the money page
and Customer 360 can never disagree. A booking or visa case is a demand in its own right, a
standalone invoice is a demand, and an invoice **linked** to a booking or visa case is not counted a
second time (its amount is already part of that record's selling price, and receipts taken against
it are credited to both). Cancelled, void and refunded bookings are withdrawn sales: they are not
receivables and they accept no new receipts. The receivables card always shows its breakdown
(`bookings ₹… · visa ₹… · invoices ₹…`).

**Refunds are cash movements, not cancellation instructions.** A requested or completed
refund never silently changes an active booking's sale status. Returning a deposit leaves the
agreed sale in place until staff explicitly cancel or void it. Refunds reduce net receipts;
refund requests reserve the refundable cash and completed refunds record money returned.

**Cancellation has an explicit, reviewable financial breakup.** Staff enter the actual supplier
cancellation charge, the agency cancellation fee (zero is valid), and the reason/terms. The
customer's replacement demand is the sum of those charges. The app shows the amount to return
or still collect before saving; it does not guess fees or send money. Reports separate gross
cancellation charges, supplier cost and agency margin. Earlier cancelled records with no
recorded breakup remain unclassified rather than acquiring invented revenue or cost. Supplier
cash recovery and settlement reconciliation are separate explicit actions; a customer refund
does not prove that the supplier returned money. See the [end-to-end journey review](docs/agency-journeys-2026-10-20.md).

This module **logs receipts**; it does not charge cards, settle refunds or move money.

## Privacy and hardening

The app is treated as a private system: it is served with `X-Frame-Options: SAMEORIGIN`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy` restrictions
and `poweredByHeader: false`, and its pages carry `robots: noindex, nofollow`. TLS/HSTS belongs to
the reverse proxy in front of it.

## Running it for real

[docs/operations.md](docs/operations.md) is the operator's runbook: configuration, first run,
upgrades, backups, the container path and an incident checklist. The short version:

- **The app validates its configuration at boot and refuses to start** on a missing or weak
  `JWT_SECRET`, an unusable `DATABASE_URL`, an `APP_ORIGIN` that is not a bare origin, or an
  `UPLOAD_ROOT` inside `public/`. It prints every problem and exits 1 instead of serving in a
  half-working state, and it logs one start-up line naming where the data lives — never a secret.
- **`GET /api/health`** answers `200` when the app, its database and its deployed schema are all
  ready, and `503` otherwise, distinguishing `checks.database` from `checks.schema` so the fix is
  obvious. It is unauthenticated and reveals nothing but statuses, uptime and a timestamp.
- **Schema changes ship as migrations.** `npm run db:migrate` (`prisma migrate deploy`) is the only
  command that touches the schema; `prisma db push` is not part of any procedure here.
- **Backups are a command, and so is checking one.** `npm run backup -- --out <dir>` captures the
  database and the upload tree with a manifest of row counts and checksums; `npm run restore --
  --in <dir> --out <dir>` restores and *verifies* against that manifest, and fails loudly if the
  copy does not match. Do the restore drill before you need it.
- **Packaging.** `Dockerfile` + `scripts/docker-entrypoint.sh` apply pending migrations and then
  serve on port 3000 with `/data` holding the database and uploads. `.github/workflows/ci.yml` runs
  typecheck, lint, the production build and the full test chain on every push.

## Roles and access

12 roles with module, action, approval, export, `sensitive:view` (passport numbers masked
server-side) and `hr:view` (salary/bank) permissions, plus record scope modes `ALL` /
`BRANCH` / `ASSIGNED` enforced in list queries, pulse, search and API guards. Deactivating an
employee or changing a password invalidates their existing sessions.

## Verification

Next.js 16 requires Node.js 20.9 or newer; the container and CI use Node.js 22 or newer.
Development and production builds explicitly retain webpack. The ESLint 8 configuration
remains on its compatible `eslint-config-next` 15.5.28 version so this framework migration
does not change lint rules; lint runs separately because Next.js 16 removed `next lint`.

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint CLI (existing rules)
npm run build        # production webpack build
npm test             # isolated regression suite (138 checks), then the accessibility gate
npm run test:a11y    # the accessibility gate alone (run npm run build first)
```

`npm test` boots its own SQLite database and upload directory under `tests/.runtime/`, runs
the real production server on port 3211 and exercises: first-run setup and setup replay
protection, login and cookie safety, unauthenticated access, empty-state rendering for every
route, light-workspace UI markers, customer/visa/booking creation rules, reference numbers,
cross-customer and overpayment rejection, exact paise arithmetic, ticket-number integrity,
upload token size and file-signature checks, signed private file reads, WhatsApp honest
logging (never "delivered"), read-only and cross-scope permission enforcement, session
revocation, HR/finance separation, populated route rendering, CSV export, money-owed coherence
across the dashboard/money page/Customer 360, the desktop navigation rail reset in the built CSS,
absence of decorative hero, setup and module-heading copy, net-of-refund balances and collection limits,
partial/rejected/complete refund behaviour, withdrawal of fully refunded bookings from allocation,
manual refund-status bypass and withdrawn-sale resurrection rejection, upload-link revocation,
booking/case money masking without finance visibility, always-on message templates,
an uncosted booking never reporting its selling price as profit, the dashboard date chip being
server-computed, and the no-index/security headers.

**Your live database is never touched by the tests.** The latest run is recorded in
[docs/verification-results.json](docs/verification-results.json), and the redesign research and
acceptance criteria are in [docs/revamp-research.md](docs/revamp-research.md). The transaction
usability review is [docs/ux-transaction-review.md](docs/ux-transaction-review.md) and the fix pass
with its evidence and remaining gaps is [docs/production-readiness.md](docs/production-readiness.md).

## Not connected (by design)

- **No WhatsApp Business API provider.** Outbound messages are honest manual handoffs
  (opening WhatsApp with the prepared text) and everything is logged as *logged*, never as
  *delivered*. The inbound webhook stays disabled until `WA_VERIFY_TOKEN`/`WA_WEBHOOK_SECRET`
  are set.
- **No GDS/inventory API and no OCR.** Tickets are recorded from the numbers staff enter;
  document fields are reviewed and confirmed manually.
- **No payment gateway.** Receipts are a record of money actually received.

## Known limitations

- SQLite, single process: fine for one office (with backups), not for multi-site scale. Money
  is stored as SQLite `Float` while all arithmetic is done in integer paise — migrate the
  money columns to `Decimal` and switch the datasource to PostgreSQL before high-value or
  multi-instance accounting use.
- Rate limiting counts failures per account (5 in 10 minutes) and, when the request carries a
  forwarded address, per client address (20 in 10 minutes), answering `429` with a `Retry-After`.
  It is in-memory, so it resets on restart and does not coordinate across processes.
- `/setup` is a one-time creation endpoint; run it before exposing the app, or place the
  app behind an authenticating reverse proxy during initial setup.
- Audit records cover in-app actions; database-level changes are not captured.
