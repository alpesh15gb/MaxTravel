# Production-readiness pass — what changed and how it was verified

**Date:** 7 October 2026
**Scope:** every defect and friction point found in [ux-transaction-review.md](ux-transaction-review.md),
plus a coherence and hardening sweep on the same code paths, and refund truthfulness (§1.4).
**Result:** all three reviewed defects are fixed, four friction points removed, two further
money-coherence bugs found and fixed during verification — a withdrawn booking still taking receipts,
and a partial refund overwriting the sale status — plus a shell-layout defect (the desktop sidebar was
parked off-screen) and the requested removal of the decorative marketing copy — first the dashboard,
setup and auth screens, then every module page heading (§1.6). `typecheck`, `lint` and `build` are clean and the
isolated regression suite passes **136 checks** (was 109; 27 new assertions cover the fixes).

Every figure below comes from a real run — no claim in this document is inferred.

---

## 1. Defects from the review — fixed

### 1.1 Receivables ignored bookings and visa cases — **fixed** (the commercial one)

**Before:** "Receivables" counted only unpaid invoices, in two independent places
(`lib/pulse.ts` and `payments/PaymentsClient.tsx`). An agency that took a deposit against a
booking and never raised an invoice was told it was owed nothing.

**Now:** money owed is derived in exactly one module, [src/lib/receivables.ts](../src/lib/receivables.ts),
and consumed by the dashboard pulse, the money page and Customer 360. The rule:

- a booking or visa case is a demand in its own right → `selling price − money received`;
- a standalone invoice is a demand in its own right;
- an invoice **linked** to a booking or visa case is *not* counted again, because the work record's
  balance already includes receipts taken against its linked invoices (this is what prevented the
  old "invoice-only" number from double-counting a partly-paid booking);
- cancelled, void and refunded bookings are withdrawn sales, not debt.

The KPI now also carries an honest note, e.g. `bookings ₹300 · visa ₹150 · invoices ₹15`, so the
number can never be misread as invoices alone.

**Verified live:** dashboard and money page both showed `₹465.00` / `₹465` with that exact
breakdown, while Customer 360 for the same customer showed `₹450` (the paid visa invoice correctly
excluded). Before this pass the dashboard showed `₹0` in the same database state.

### 1.2 "Margin" reported the whole selling price as profit — **fixed**

**Before:** `sellingPrice − supplierCost`, with `supplierCost` defaulting to `0`, so an uncosted
₹53,000 ticket displayed **Margin ₹53,000**.

**Now:** when the supplier cost is not entered, the card reads **"Margin (set supplier cost)"**,
shows the honest indicative figure (`markup + service fee`) and says so in a caption; the
supplier-cost row reads **"Not entered"** instead of a misleading `₹0`. Once a real cost is
entered it reverts to the true `sellingPrice − supplierCost` margin.

**Verified live:** the fare panel on `BK-2026-0001` rendered
`Supplier cost: Not entered` and `Margin (set supplier cost): ₹0` (markup 0 + service fee 0), where
the old label/value pair would have shown `₹210.3`.

### 1.3 Hydration error on every dashboard load — **fixed**

**Before:** `/dashboard` logged React #425 and #422 on **every** load. The `"use client"` page
formatted today's date with `toLocaleDateString("en-IN", {weekday,day,month})`, which Node and
Chromium render differently (`Wed, 7 October` vs `Wed 7 October`).

**Now:** the route is a server component ([dashboard/page.tsx](../src/app/(app)/dashboard/page.tsx))
that computes the chip with ICU-free integer parts and month/weekday tables
([src/lib/dates.ts](../src/lib/dates.ts)) and passes the finished string down as a prop, so the
server HTML and the client render are the same string by construction — not by agreeing on ICU data.
The "Updated …" footer uses the same table-based clock.

**Verified live:** after a full reload of `/dashboard` the browser console is **empty** (previously
two errors per load), and the chip still reads `Wed, 7 October`.

### 1.4 A partial refund marked the whole booking `REFUNDED` — **fixed**

**Before:** any movement in the refund pipeline rewrote the *sale* status — `REFUND_REQUESTED` on
request, `REFUND_PENDING` while in flight, `REFUNDED` when paid, and `CANCELLED` when the request was
rejected. A ₹10 refund against ₹50 received therefore marked a live, ticketed booking `REFUNDED`,
and a rejected refund request cancelled it. `CANCELLED`/`VOID`/`REFUNDED` also made the booking
un-billable, so a partly refunded sale silently dropped out of receivables and out of the money
desk's allocation list.

**Now: a refund is money leaving, not a status of the sale.**

- Requesting a refund, and every pipeline stage, leave the booking's status exactly as sold.
- A **rejected** refund changes nothing at all.
- Only a completed refund that returns **every rupee recorded as received** withdraws the booking:
  `api/refunds/update` compares the paid refunds against the receipts inside the same transaction
  and sets `REFUNDED` only when they cover it.
- Money returned now reduces money received, everywhere: receivables, the money desk, the booking
  workspace, the ticketing list, Customer 360 and the WhatsApp `{outstanding}` template all use
  `netReceived` from `lib/receivables.ts`. A partly refunded booking therefore owes *more*, not
  less — the error the old model could not express.
- The money desk accepts receipts up to the **net** balance (₹170.30, not ₹160.30, on that example),
  so the UI and the API agree to the paise.
- Refunds are visible where the work is: the booking workspace has a **Refunds** panel
  (`RF-2026-0001 ₹10 · paid · returned 07 Oct 2026`) with `Receipts ₹50 · refunded ₹10 · net received
  ₹40`; the header shows a `₹10 refunded` chip, or an amber `refund in progress · ₹X` chip while the
  pipeline is still running; the ticketing list shows the same derived chips and net balances.

**Verified live:** `BK-2026-0001` stayed **TICKETED** with the `₹10 refunded` chip and net received
₹40 (outstanding ₹170.30) after the partial refund, its rejected `RF-2026-0002` was visible as
*rejected* without touching the sale, and the fully refunded `BK-2026-0002` showed `refunded`,
`₹50 refunded`, balance ₹0, and was no longer offered as an allocation target. The dashboard read
`Receivables ₹335.3 — bookings ₹170.3 · visa ₹150 · invoices ₹15`.

### 1.5 The desktop sidebar was parked off-screen — **fixed**

**Before:** on any screen wider than 1024px the whole navigation rail was invisible. The shell adds
`-translate-x-full` to `<aside class="app-sidebar">` while the mobile drawer is closed, and the
desktop reset (`lg:translate-x-0`) lived inside the `.app-sidebar` rule in `@layer components` —
which Tailwind emits *before* the utilities layer, so the translate utility won at every width. The
rail kept its 244px slot (`position: sticky`) but was painted 244px to the left, leaving a blank
column where the navigation should be. Measured live at 1440px: `transform: matrix(1, 0, 0, 1, -244, 0)`, nav rect `x: -244`.

**Now:** the desktop reset is a single, deliberately more specific rule at the end of
`globals.css` (`@media (min-width:1024px) { aside.app-sidebar { transform:none } }`), and the
components-layer declaration was removed so there is one owner of that property. Verified at 1440px:
`transform: none`, rail rect `x: 0 → 244`, nav links visible; and at 420px the drawer still opens from
the hamburger (`translate-x-0`, scrim present) and closes on Escape. A third check now fails the
suite if that reset ever disappears from the built CSS.

### 1.6 Slogan headings on every module page — **simplified**

**Before:** each working screen opened on an uppercase slogan and a decorative title — "VISA
OPERATIONS / Dossiers, beautifully organized.", "RELATIONSHIPS / Every customer. One clear view.",
"AIR OPERATIONS / From enquiry to take-off.", "FINANCE, WITHOUT THE FRICTION", "PAPERWORK, WITH PEACE
OF MIND", "CLOSE THE LOOP", "YOUR PARTNER NETWORK" — followed by filler prose ("A connected home for
your customers, their travellers and every journey together.", "Track real refund requests from
supplier follow-up to approval and recorded payout.").

**Now:** all 17 `PageHeader` call sites carry a plain title and one factual line, and the decorative
eyebrow is gone — along with the same voice in the new-customer and payment dialogs ("A NEW
RELATIONSHIP", "A CLEAR REQUEST FOR PAYMENT") and the customer workspace ("EVERY JOURNEY,
CONNECTED"):

| Page | Heading | Description |
|---|---|---|
| `/ticketing` | Bookings | Create and track bookings, passengers, PNRs and ticketing deadlines. |
| `/visa` | Visa cases | Track applicants, destination requirements, documents and stages. |
| `/customers` | Customers | Each customer's travellers, bookings, visa cases and balances in one place. |
| `/documents` | Document desk | Document requirements and uploaded files for each traveller. Up to 400 recent records in your scope. |
| `/payments` | Money & invoices | Invoices, receipts and outstanding balances. |
| `/refunds` | Refunds | Refund requests recorded against bookings and visa cases. No money is transferred by this app. |
| `/tasks` | Tasks & follow-ups | The next action, its owner, priority and due date. |
| `/suppliers` | Suppliers & payables | Processors, consolidators and the money you owe them. |
| `/employees` | Your team | Roles, access and current workloads. Salary and bank details are permission-restricted. |
| `/checklists` | Visa checklists | Requirements for each destination, visa type and applicant type. Versions preserve existing case requirements. |
| `/settings` | Agency settings | Agency identity, alert windows and visa workflow. |

Two disclosures were kept deliberately, because they are facts rather than decoration:
"No money is transferred by this app." on `/refunds`, and the login form's eyebrow, which shows the
agency's own name. The employees detail page also stopped printing the person's name twice — the
header already carries it, so the body now shows only their join date. A new check fetches all
fourteen module pages, fails if any slogan returns, and fails if one of the plain headings goes
missing.

---

## 2. Friction removed

| From the review | Change |
|---|---|
| Visa workflow chips looked clickable but were static | Chips are now real buttons when the role may edit: the current stage is disabled with `aria-current="step"`, the others move the case with a hover affordance, tooltip and an "Select a stage to move this case" hint. Verified live: clicking **Assessment** moved the case, updated the header badge and dropdown, logged the timeline entry and toasted "✓ Stage updated". |
| Native date inputs gave no format hint | The invoice due-date field carries `Day-month-year (DD-MM-YYYY)` as a field hint, and the visa edit dialog states the same for its whole date grid. |
| Number inputs accepted raw text and were caught only on submit | The receipt form now rejects an overpayment **as you type**: inline message ("Amount exceeds the ₹300.00 outstanding on the linked record…"), `aria-invalid`, a `Maximum ₹300.00` hint and a disabled Save. Verified live at 999 → blocked, 300 → clear. |
| Receipt → linked invoice crediting was coherent but undocumented | The payment dialog now states that a receipt taken against a linked invoice is also credited to that booking or visa case, and that the two never double-count. The rule is also documented in the README and in code. |
| Decorative marketing copy on the working screens | The dashboard hero ("THE BIG PICTURE" and both of its blurbs), the dashboard eyebrow and tagline, the setup page's "A FRESH START / Your agency. Your workspace. / No sample records. No shared passwords." framing (now a plain "Set up your agency"), and the auth-side "Private workspace · Role-based access" line are gone. The dashboard now opens on the greeting, the date and the numbers. The same pass then stripped the slogans from every module page heading (§1.6). Three checks keep that copy from creeping back: the dashboard, the setup page, and a sweep of all fourteen module pages. |

## 3. Money-coherence bug found while verifying (new)

A refund moved a booking to `REFUNDED` after only a **partial** refund, yet the refunded booking was
still offered as an allocation target on the money page, and the API accepted new receipts against
it. A withdrawn booking's balance is no longer a receivable, so accepting money against it would
have inflated a dead record. Fixed in both places:

- the money page no longer lists cancelled/void/refunded bookings as allocation targets;
- `POST /api/payments` returns **400** — *"This booking is cancelled, void or refunded. Allocate the
  money to open work, or record it as a customer advance."* — and creates nothing (asserted, with a
  payment-count check).

**Verified live:** after signing in on the same fixture, the allocation list for that customer showed
only `BK-2026-0002` and `VC-2026-0002`; the refunded `BK-2026-0001` was gone.

## 4. Hardening added

- **Security headers** (`next.config.mjs`): `X-Frame-Options: SAMEORIGIN`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`,
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Cross-Origin-Opener-Policy: same-origin`.
- **No framework fingerprint:** `poweredByHeader: false` (the `X-Powered-By` header is gone).
- **No search indexing:** `robots: { index: false, follow: false }` on the root metadata, so a
  private agency workspace can never land in a search index.
- Asserted by the suite (`Private workspace is not indexable and leaks no framework version`).

TLS/HSTS is intentionally not set in the app: it belongs to the reverse proxy that terminates HTTPS.

## 5. Verification evidence

| Check | Command | Result |
|---|---|---|
| Types | `npx tsc --noEmit` | exit 0 |
| Lint | `npm run lint` | exit 0, no warnings |
| Build | `npm run build` | exit 0, 54 routes |
| Regression suite | `npm test` | **136 checks passed, exit 0** (recorded in [verification-results.json](verification-results.json)) |
| Browser | Chromium against the isolated fixture on `127.0.0.1:3211` | console empty on `/dashboard`, `/payments`, `/visa/[id]`; all requests 200 |

New assertions: the desktop sidebar reset ships in the built CSS, the dashboard carries no decorative
hero copy, first-run setup asks for an agency without marketing framing, every module page carrying a
plain operational heading instead of a slogan, receivables include unpaid
bookings and visa cases, money returned raises what the
customer still owes, a part-paid standalone invoice counts only its remainder, a work-linked invoice
is not counted twice, the money page agrees with the dashboard, requesting a refund does not un-sell
the booking, a completed partial refund leaves the sale status truthful, a rejected refund neither
cancels nor refunds the sale, a refund covering every receipt withdraws the sale, a withdrawn booking
drops out of receivables and cannot take new receipts, a partly refunded booking shows its refunds
and net receipts on the sale, an uncosted booking never shows the selling price as profit, the
dashboard day chip is server-computed, the workspace is not indexable and leaks no framework
version, a sale cannot be marked refunded by hand and a withdrawn sale stays closed, built-in
message templates are always offered, unknown upload links cannot be revoked while a revoked link
stops working, booking and case money stay hidden without finance visibility, and case fees cannot
change without finance visibility (while operational edits still can).

The live workspace on `:3210` and its database were **never touched** by any of this work; every
check ran against a throwaway SQLite database and upload root under `tests/.runtime/`.

## 6. Deliberately unchanged — decisions or credentials needed

These are not oversights; each one changes behaviour or needs something only you can supply.

1. **A refund does not have its own booking status.** The sale status is now preserved (see §1.4) and
   the refund's own state is shown as a derived chip and a Refunds panel instead of overwriting the
   booking. If you would rather have an explicit booking status such as `PARTIALLY_REFUNDED` in the
   status dropdown, that is a labelling decision to make next — the data to drive it already exists.
2. **External integrations are still absent by design.** No WhatsApp Business provider (messages are
   logged manual handoffs), no GDS/inventory, no OCR (fields are confirmed by a human), no payment
   gateway. These need vendor accounts and credentials — the app states honestly what it does.
3. **SQLite single-process storage.** Fine for one office with backups. Multi-instance or
   high-value accounting should move to PostgreSQL with `Decimal` money columns.
4. **In-memory rate limiting** resets on restart and does not coordinate across processes. It now
   counts failures per account *and* per client address (§9.1), which narrows the spray case, but a
   second instance would still keep its own counts.
5. **`/setup` is a one-time unauthenticated creation endpoint.** Run it on the host before exposing
   the app, or keep the app behind an authenticating reverse proxy until the owner account exists.
6. **Timestamps and dates render in the viewer's local timezone.** This pass removed the one
   *proven* cross-engine mismatch (the dashboard chip). Formatting every timestamp in a fixed agency
   timezone, and rendering them server-side only, is a larger change and is recommended before
   serving staff in several timezones at once.

## 7. Full-pass review — 7 October 2026 (every route read, what it found)

Scope: all 42 API routes, all 25 pages, every `lib` module, the permission matrix, the suite and
the docs. Each fix below carries a new suite assertion unless noted.

1. **A sale could be marked `REFUNDED` by hand.** `POST /api/bookings/status` accepted any status
   from any status, so the refund pipeline's fully-refunded rule was bypassable and money owed
   could be hidden with one dropdown change. `REFUNDED` is now set only by the completed-refund
   pipeline, and a cancelled/void/refunded sale stays closed (re-travel goes through a new booking
   or a reissue). The reissue reject path also no longer resurrects a sale that has since moved on,
   and reissues cannot start from a withdrawn booking.
2. **Money figures leaked to roles without finance visibility.** The list pages showed
   "Restricted", but the booking and visa detail pages rendered full fares, receipts and refunds
   to anyone with `ticketing:view`/`visa:view` (e.g. `TICKETING_EXECUTIVE`, `OPERATIONS`). Both
   detail pages now mask financial fields server-side — the client never receives them — and render
   "Restricted"; the visa edit API rejects fee changes without `payment:view` while still allowing
   operational edits; the edit form hides fee inputs and never posts masked zeros back.
3. **Signed file URLs fell back to a public secret.** Both file routes used `"dev-secret-change-me"`
   when `JWT_SECRET` was unset, so anyone could mint URLs for any stored path. Both now fail
   closed instead. (Verified by code review and typecheck; asserting it would need a secret-less
   build.)
4. **Upload links could never be revoked.** A leaked link stayed valid for up to 30 days with no
   way to kill it, and the list endpoint had no UI. New `POST /api/upload-links/revoke` (same
   permissions and record scope as creation); the customer workspace Documents tab now lists every
   link with expiry/use state, copy and revoke. The generator button is also labelled honestly
   ("Share upload link", not "Upload Document").
5. **Quick-reply templates were undead UI.** The inbox dropdown and the server template path
   referenced `QuickReply` rows, but nothing seeds them and nothing creates them — the dropdown
   could never appear. The five built-ins now live in `lib/whatsapp.ts`, are always served (a
   stored row with the same key overrides), and the send path is unchanged.
6. **Duplicate visa-stage endpoint removed.** `/api/visa/stages-patch` duplicated
   `PATCH /api/visa/stages`; the settings page now uses `PATCH` and the route is deleted.
7. **Dashboard KPI icons and notes were index-fragile.** The card list is permission-filtered, so
   position-based icons and fallback notes misaligned for restricted roles (e.g. HR saw the wrong
   icons). Both now travel with the card from the server. Dashboard quick-action descriptions were
   also de-sloganed.
8. **Dead code removed.** `lib/badges.ts` (claimed to be the "single source of truth" while
   nothing imported it — and carried unreadable dark-on-dark chips), `lib/format.ts`, and
   `serialize.money()` were all unreferenced. Refund amounts now format to paise like the rest of
   the app.
9. **Validation tightened.** Visa edit validates money, dates and supplier existence (raw
   `Number()`/`Date` 500'd on garbage); traveller edit validates name and relation; stage creation
   validates its name; the audit page sanitises its page number.
10. **Copy corrections.** The Refunds header claimed visa-case refunds, which the schema does not
    support (bookings only); the shell's remaining slogans are gone.

Still observed, deliberately left for later (all fine at current scale): `jsonError` returns
internal messages on 500s, so a Prisma error can leak schema details — return a generic message in
production; the dashboard pulse loads unbounded tables (no `take`) and the webhook scans all
customer phones per inbound message — add limits before data grows ~10×; login rate-limiting is
keyed by email only, not IP; opening Notifications marks all read; audit detail is truncated with
no expansion; export money columns are safe only while every `export:data` holder also holds
`payment:view` — re-check if roles change.

## 8. Going live — checklist

1. `cp .env.example .env`, set a strong `JWT_SECRET` (`openssl rand -hex 32`) and `DATABASE_URL`.
2. `npm ci && npm run db:generate && npm run db:migrate && npm run build && npm start` on the host
   that will serve the app. The schema now ships as committed migrations, so `db:migrate` (not
   `prisma db push`) is the command that creates or upgrades the database — see §9.
3. Open `/setup` **from that host first** and create the agency and owner account.
4. Put the app behind HTTPS (reverse proxy) — that is where HSTS belongs.
5. Back up the SQLite file **and** the upload directory on a schedule, and verify one restore:
   `npm run backup -- --out <dir>` then `npm run restore -- --in <dir> --out <fresh-dir>` — see §9.
6. Add real staff under **Team**, configure visa checklists and agency settings, then start entering
   real customers. Nothing in this workspace is demo data.

## 9. Production-readiness pass — 11 October 2026

Scope: make the workspace safe and boring to **operate**, not just to use. Everything claimed below
was exercised on this machine against the built app; §9.3 lists what was not.

### 9.1 Behaviour that changed

| Area | Before | Now |
|---|---|---|
| Start-up configuration | Read at import time. A missing secret surfaced as a failed sign-in; a database path typo as a 500 on the first query. | `src/lib/config.ts` + `src/instrumentation.ts` check `JWT_SECRET`, `DATABASE_URL`, `UPLOAD_ROOT` and `APP_ORIGIN` before the server accepts a request, print **every** problem and exit 1. One start-up line names where the data lives and how long a session lasts, and never prints a secret. |
| Health | None, so a proxy could not tell "up" from "up but broken". | `GET /api/health`: `200` only when the database answers **and** the deployed schema is present, otherwise `503`, with `checks.database` and `checks.schema` distinguishing the two reasons. No secrets, versions, paths or data. |
| Unexpected 500s | One generic sentence; matching a staff report to a log line meant guessing. | Every unexpected fault carries a 12-character reference that is also written to the server log with its stack, so `[error <reference>]` finds the exact failure. |
| Login throttling | Failures counted per email address only, so one address could spray a common password across every account. | Counted per account (5 in 10 minutes) **and** per client address (20 in 10 minutes), answered with `429` and `Retry-After`. The account bucket is authoritative; the address bucket engages only when a forwarded header carries an address (`TRUST_PROXY`). |
| Dashboard pulse | Loaded every document, task, invoice and booking the user could see on every dashboard view, with no `take`. | The attention lists are bounded per kind with the filter pushed into SQL, and a capped list adds a visible "list capped" card linking to the full page. Bookings, visa cases and invoices stay complete, because they carry the money figures and the KPI counts. |
| Schema changes | No migration history at all: every install was `prisma db push`. | `prisma/migrations/0_init` is the committed baseline; deploys, the container entrypoint and every test harness now run `prisma migrate deploy`. |
| Backups | Prose advice in a checklist. | `scripts/backup.mjs` (SQLite `VACUUM INTO` plus the uploads tree plus a manifest of row counts and checksums) and `scripts/restore.mjs`, which verifies checksums, row counts **and** the file tree before declaring success. |
| Packaging | None. | `Dockerfile`, `.dockerignore`, `scripts/docker-entrypoint.sh` (fails fast on configuration, proves the volume is writable, applies migrations, then `exec`s the server) and `.github/workflows/ci.yml`. |
| Test browser | Playwright was vendored by hand under a git-ignored directory, so every browser suite — including the accessibility gate — died with `MODULE_NOT_FOUND` on a fresh clone or in CI. | `playwright` is a declared devDependency recorded in the lockfile, and `tests/browser.mjs` resolves the project's copy first, falling back to the vendored one so existing local setups keep working. |

### 9.2 Verification evidence

| Check | How | Result |
|---|---|---|
| Types, lint, build | `npm run typecheck`, `npm run lint`, `npm run build` | exit 0 |
| Regression suite and gate | `npm test` | **138 checks passed**, then `PASS — no accessibility findings outside the accepted budget` (0 findings, 0 in budget), exit 0 |
| Boot validation | Started the built server six ways: short secret, placeholder secret, no `DATABASE_URL`, unknown scheme, missing database directory, `APP_ORIGIN` with a path | each printed its reason and exited **1** |
| Health, two states | One instance against an unmigrated database, then the same instance after `migrate deploy` | `503` with `schema: not-deployed` → `200` with `database: ok, schema: ok`; `no-store`; no version or path in the body |
| Error reference | Forced a real fault (sign-in against an unmigrated database) | `500` carrying the reference, the same reference in the server log, no internals in the message |
| Login throttling | Six failures on one account; twenty failed attempts across twenty accounts from one forwarded address | `429` with `Retry-After`; a different account and a different address stayed at `401` |
| Migrations | `migrate deploy` on an empty directory twice, then `migrate status` | applied once, second run a no-op, "Database schema is up to date"; 35 tables; a row written through the client |
| Migrating a `db push` database | `prisma migrate resolve --applied 0_init` on the existing development database | status clean afterwards, existing rows untouched |
| Backup and restore | `backup.mjs` on a synthetic database plus two documents, then `restore.mjs` | restored and verified: database checksum, 16 model row counts, upload tree |
| Restore failure paths | Restore over an existing database without `--force`; a tampered document; a tampered database; a directory that is not a backup | all four refused with an explanation and a non-zero exit |
| Container | `docker build`, then run with a mounted volume | image built; the entrypoint applied `0_init`; `/api/health` answered `200`; `/data` holds the database and uploads; Docker's own `HEALTHCHECK` reported `healthy`; a restart was a no-op migration with the data intact; running without a secret exited 1 |
| Container package | `sh -n scripts/docker-entrypoint.sh` | syntax clean |
| CI path for the browser suites | The vendored Playwright copy hidden, so only the declared dependency could resolve | `npm run test:a11y` passed at 0 findings |
| CI definition | `npx js-yaml .github/workflows/ci.yml` | parses; three jobs (verify, build, test) |

### 9.3 Not proven here, and deliberately left

- **The container has been run only on this machine's Docker daemon.** Nothing proves it under an
  orchestrator: Kubernetes probes, a read-only root filesystem, a network volume with different
  ownership, or a registry round-trip. The first real deployment should treat those as untested.
- **No external monitoring or alerting.** `/api/health` is the hook for it; nothing pages anyone
  today. This is still an open decision (§10 of [operations.md](operations.md)).
- **One instance only.** SQLite and the in-process rate limiter are unchanged: two containers
  sharing one database file, or behind a load balancer, remain unsupported until the PostgreSQL
  migration happens.
- **Money is still stored as SQLite `Float`** (all arithmetic is integer paise, and the suite pins
  that). The PostgreSQL/`Decimal` migration remains the prerequisite for high-value or multi-instance
  accounting.
- **The inbound WhatsApp webhook still scans every customer phone number per message**, and is
  disabled unless both WhatsApp variables are set. That scan wants a normalized phone column before
  data grows.
- **Opening Notifications still marks everything read**, and audit detail is still truncated with no
  expansion.
- **`/setup` is still an unauthenticated one-time endpoint.** Run it before exposure, or keep the app
  behind an authenticating proxy until the owner account exists.
- **Nothing is scheduled.** Backups run when a human or cron runs them; the runbook suggests a
  cadence, the repository installs none.
- **The migration baseline is a single squashed `0_init`.** It describes the schema as it stands; a
  database created before it is baselined with `migrate resolve` (verified above), and future changes
  should arrive as additional migrations rather than by regenerating it.
