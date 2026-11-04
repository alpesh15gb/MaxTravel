# Trip-Centred UI Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the CRM's screens and flows around one idea, the **Trip** (the existing Max ID / `ServiceCase`), so staff handle a customer's whole job from one page and a five-item menu.

**Architecture:** UI-only rebuild. New pages (`/today`, `/trips`, `/trips/[id]`, `/trips/new`) read existing Prisma models through two new read helpers and a pure stage function. All writes keep going through the existing API routes and wizards (`/api/cases`, `/api/sales`, `/ticketing/new?case=`, `/visa/new?case=`, payments, `/api/work`). Old routes stay working and redirect where a new page replaces them.

**Tech Stack:** Next.js 16.4.1 (App Router, webpack build — read `node_modules/next/dist/docs/` before using any Next API), React 19, Prisma 5, Tailwind, tsx test scripts.

**Spec:** This document's "Design" section, agreed in chat on 2026-11-04 (research: Tern, Travefy, TravelJoy, Sembark all centre on the trip).

## Design

- **One hub:** a Trip = an existing `ServiceCase`. Its quote(s), bookings (flight, hotel, other), visa cases, payments/invoices, documents and to-dos all show on `/trips/[id]`. Label the ID **"Max ID"** everywhere (owner's explicit request); the object is called a "Trip".
- **Stage bar:** every trip shows one derived stage: `ENQUIRY → QUOTED → BOOKED → TRAVELLING → DONE`, plus `CANCELLED`. Derived from data, never stored (no schema change).
- **Menu (sidebar, all roles, filtered by permission):** `Today · Trips · Customers · Suppliers · Reports`. Settings stays a single link in the account menu. Quick "+ New" menu: `New trip`, `New customer`, `New to-do`.
- **Starting work:** always "New trip for <customer>" (customer picked or created inline), then "What do they need?" → Enquiry/quote · Flight · Hotel · Visa · Other service. Creates the Max ID via `POST /api/cases`, then opens the existing wizard with `?case=<id>`.
- **Today:** one page answering "what must I do now": my overdue/today to-dos, trips travelling in the next 7 days, payments to collect, enquiries to follow up, new online bookings.
- **Customer page:** tabs `Trips · Travellers & documents · Money · Activity`; the next-step banner speaks in trip language and its main button is "New trip".
- **Online bookings** from the booking site are trips too (they already create a `ServiceCase`); they get an "Online" badge and appear in Trips and Today.
- **Lists are filters, not destinations:** Flights, Hotels, Visas, Enquiries, Payments, Online, Refunds become filter chips/links inside Trips (`/trips?view=flights` etc.) pointing to the existing list pages, not separate menu areas.

## Owner's 8 needs (2026-11-04) and where each is covered

The engine already stores almost all of this; the problem is that it is hidden or scattered. Each need gets a clear, findable screen:

| # | Owner's need | What exists today | Task |
|---|---|---|---|
| 1 | Complete client master + document images kept forever | ~60 traveller/customer fields (`src/lib/master-fields.ts`), encrypted passport/Aadhaar, private document storage; files are never deleted except failed uploads; backups include uploads | Task 10 |
| 2 | Admin resolves / transfers tasks to staff, follow-ups | To-do owner change, reviewer, delegate permission (`src/lib/work-engine.ts`), `nextFollowUpAt` on Max ID | Task 11 |
| 3 | Supplier | Suppliers, payment terms, dues, settlements | Task 3 (menu) + Task 13 (payables report) |
| 4 | Profit / loss per Max ID, green / red | `caseFinance` + `CaseProfit` already colours green/red, but sits low on the page | Task 12 |
| 5 | Proper audit log per case | `ServiceCaseEvent` per Max ID + `AuditLog` for child records | Task 12 |
| 6 | Proper reporting | Report centre with many reports | Task 13 |
| 7 | Not confusing | — | Tasks 3–9 (Trip-centred screens) |
| 8 | Simple yet robust | Same tested engine, no schema change | Global constraints |

## Global Constraints

- No Prisma schema or migration changes. No change to any existing API route's request/response contract (new read-only routes allowed).
- Every new query uses `serviceCaseScope(user)` (src/lib/service-cases.ts) and child scopes exactly like `src/app/(app)/cases/[id]/page.tsx`; never widen what a role can see.
- Permission gates copied from the existing pages (`ticketing:view`, `visa:view`, `payment:view`, `task:view`, `customer:view`, `customer:create`).
- Term "Max ID" kept verbatim; dates in India time via `src/lib/dates.ts`; money via `src/lib/money.ts`.
- Work on branch `trip-revamp`; nothing merges to `main` (which the VPS deploys) until the owner approves a demo.
- Phone width 375px: no horizontal page scroll on any new page.
- Booking site / booking app untouched.

## Review Focus

1. **Staff with ASSIGNED access** opening `/trips` or `/trips/<id>` of a trip they don't own → must see only permitted trips; 404 for others (same as `/cases/<id>` today).
2. **Trip with no services yet** (just created) → stage `ENQUIRY`, page shows "What do they need?" buttons, no empty broken sections.
3. **Mixed trip:** a cancelled flight + a live visa → stage follows the live service (`BOOKED`), cancelled item shown struck-through, not hidden.
4. **Online booking trip** (`gdsSource: "TRIPJACK_API"`) → appears in Trips with "Online" badge and is read-only where the existing booking page is read-only.
5. **Old links** (`/cases/<id>`, `/dashboard`, bookmarks, notification links) → land on the new equivalent, never a 404.

---

### Task 1: Trip stage function

**Files:**
- Create: `src/lib/trip-stage.ts`
- Test: `tests/trip-stage.ts` (add `node --import tsx tests/trip-stage.ts` to the `test` script in `package.json`, after `customer-next-step.ts`)

**Interfaces:**
- Produces:
  - `export type TripStage = "ENQUIRY" | "QUOTED" | "BOOKED" | "TRAVELLING" | "DONE" | "CANCELLED"`
  - `export const TRIP_STAGES: TripStage[]` in bar order (without CANCELLED)
  - `export const TRIP_STAGE_LABEL: Record<TripStage,string>` = Enquiry, Quoted, Booked, Travelling, Done, Cancelled
  - `export type TripStageInput = { caseStatus: string; bookings: { status: string; travelDate: Date | null }[]; visas: { travelDate: Date | null; travelEndDate: Date | null }[]; leads: { stage: string; travelDate: Date | null; quoteStates: string[] }[]; today: Date }`
  - `export function tripStage(input: TripStageInput): TripStage`
  - `export function tripDates(input: TripStageInput): { start: Date | null; end: Date | null }`

Rules, in order (dead booking = status in `CANCELLED, VOID, REFUNDED`; live booking = any other status except `ENQUIRY`, `QUOTE_SENT`):
1. `caseStatus === "CANCELLED"` → CANCELLED. `caseStatus === "COMPLETED"` → DONE.
2. Has ≥1 booking, all dead, no visas, no lead stage other than `LOST` → CANCELLED.
3. `start..end` from live bookings' `travelDate`, visas' `travelDate`/`travelEndDate`, compared by India calendar day. If (live booking or visa exists) and `today` within `[start, end]` → TRAVELLING; if `end < today` → DONE.
4. Live booking or any visa → BOOKED.
5. Any booking `QUOTE_SENT`, any lead stage `QUOTED`, or any quote state other than `DRAFT`/`SUPERSEDED` → QUOTED.
6. Otherwise → ENQUIRY.

- [ ] **Step 1: Write the failing test** — `tests/trip-stage.ts` with `node:assert`, one assert per case: empty → ENQUIRY; lead QUOTED → QUOTED; quote `ACCEPTED` → QUOTED; booking `TICKETED` travel in 10 days → BOOKED; booking `TICKETED` travel today → TRAVELLING; visa travel 1–5 days ago → DONE (end in past); flight `CANCELLED` + visa future → BOOKED; only bookings `CANCELLED` → CANCELLED; caseStatus `COMPLETED` → DONE; booking `ENQUIRY` only → ENQUIRY; travel date 23:30 IST yesterday vs today → not TRAVELLING (IST day boundary). Print `Trip stage rules passed.`
- [ ] **Step 2:** Run `node --import tsx tests/trip-stage.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `src/lib/trip-stage.ts` (pure, no Prisma import; use the IST day helper already in `src/lib/dates.ts`, add `istDayKey(date): string` there if none exists).
- [ ] **Step 4:** Run the test → `Trip stage rules passed.`
- [ ] **Step 5:** Commit `feat: derive trip stage from case services`.

### Task 2: Trip read helpers and read-only API

**Files:**
- Create: `src/lib/trips-read.ts`
- Create: `src/app/api/trips/route.ts` (GET list), `src/app/api/trips/[id]/route.ts` (GET one)
- Test: `tests/trips-read.mts` (pattern: copy the disposable-SQLite setup used by `tests/customer-sales-history.mts`), add to `test` script

**Interfaces:**
- Consumes: Task 1 `tripStage`, `tripDates`; `serviceCaseScope`, `caseFor`, `childWorkScope` from `src/lib/service-cases.ts`.
- Produces:
  - `export type TripRow = { id: string; caseNo: string; title: string; customer: { id: string; name: string; code: string }; owner: string; stage: TripStage; start: string | null; end: string | null; services: { kind: "FLIGHT"|"HOTEL"|"VISA"|"OTHER"|"ENQUIRY"; label: string; status: string; href: string; dead: boolean }[]; online: boolean; balanceMinor: number | null; nextTodo: { title: string; dueAt: string | null; overdue: boolean } | null }`
  - `export async function readTrips(user: SessionUser, q: { stage?: TripStage | "ACTIVE"; search?: string; mine?: boolean; customerId?: string; page?: number }): Promise<{ rows: TripRow[]; total: number; counts: Record<TripStage, number> }>` — 50 per page, newest activity first; `"ACTIVE"` = not DONE/CANCELLED; `balanceMinor` only when user has `payment:view`, else null.
  - `export async function readTrip(user: SessionUser, id: string): Promise<TripDetail>` where `TripDetail = TripRow & { customer: { id; name; code; phone; email }; branchId: string; ownerId: string; quotes: { leadId: string; title: string; stage: string; latestQuote: { id: string; state: string; totalMinor: number } | null }[]; money: { invoicedMinor: number; receivedMinor: number; dueMinor: number } | null; documents: { id: string; docNo: string; docType: string; status: string }[]; caseStatus: string; canEdit: boolean }` — throws `ApiError(404)` exactly like `caseFor`.
- Stage filter is computed in memory after a scoped fetch capped at 500 open cases; stage counts come from the same set.

- [ ] **Step 1: Failing test** — seed: owner, staff (ASSIGNED), 3 customers; trip A (booking TICKETED, owned by staff), trip B (lead only, owned by owner), trip C (cancelled booking). Assert: owner `readTrips` → 3 rows, `counts.BOOKED===1, ENQUIRY===1, CANCELLED===1`; staff → only trip A; staff `readTrip(B)` rejects with status 404; `stage:"ACTIVE"` for owner → 2 rows; staff without `payment:view` → `balanceMinor===null`.
- [ ] **Step 2:** Run `node --import tsx tests/trips-read.mts` → FAIL.
- [ ] **Step 3:** Implement `readTrips`, `readTrip` (lift the per-section queries from `src/app/(app)/cases/[id]/page.tsx` into `readTrip`; that page keeps working), and the two GET routes (`requireSession([...CASE_READ])`, `jsonError` on failure, `Cache-Control: private, no-store`).
- [ ] **Step 4:** Run test → pass; `npx tsc --noEmit -p .` clean.
- [ ] **Step 5:** Commit `feat: trip read model with scoped list and detail`.

### Task 3: Five-item navigation

**Files:**
- Modify: `src/lib/workspace-sections.ts`, `src/components/Shell.tsx`, `src/lib/workspace-guide.ts`
- Test: `tests/workspace-sections-browser.mjs` (update expectations), new `tests/nav-sections.ts` (unit, add to `test` script)

**Interfaces:**
- Produces: sections `today` (/today), `trips` (/trips), `customers` (/masters), `suppliers` (/suppliers), `reports` (/reports). `sectionForPath(path)` maps: `/today,/dashboard,/work,/tasks,/notifications,/team-chat` → today; `/trips,/cases,/ticketing,/visa,/sales,/online-bookings,/payments,/refunds,/advances,/documents` → trips; `/masters,/customers,/customer-tools,/email` → customers; `/suppliers` → suppliers; `/reports` → reports; everything under Settings → none (account menu).
- Quick menu items: `New trip` (/trips/new), `New customer` (/masters?action=new), `New to-do` (/today?action=todo).

- [ ] **Step 1: Failing test** `tests/nav-sections.ts`: assert the five section ids/hrefs in order; assert each mapping above for one sample path each (`/cases/x`→trips, `/ticketing/new`→trips, `/dashboard`→today, `/masters/x`→customers).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Rewrite sections + Shell sidebar/quick menu. Section sub-tabs: Trips → `All trips · Enquiries · Flights & hotels · Visas · Online · Payments` (links to `/trips?view=…` and existing list pages); Today → `To-do · Alerts · Messages`.
- [ ] **Step 4:** Test passes; tsc clean.
- [ ] **Step 5:** Commit `feat: five-section navigation around trips`.

### Task 4: Trips list page

**Files:**
- Create: `src/app/(app)/trips/page.tsx` (server), `src/app/(app)/trips/TripsClient.tsx`
- Create: `src/components/TripStageBar.tsx` (shared with Task 5)

**Interfaces:**
- Consumes: `readTrips`, `TRIP_STAGES`, `TRIP_STAGE_LABEL`.
- Produces: `<TripStageBar stage={TripStage} compact?: boolean />` (completed stages filled, current highlighted, CANCELLED shown as a red pill instead of the bar).

Layout: header "Trips" + primary "New trip"; stage chips with counts (Active default, then each stage); search (customer, Max ID, destination, PNR); "Mine only" toggle; rows/cards show Max ID, customer, title/destination, dates, compact stage bar, service icons, Online badge, balance (if permitted), next to-do with overdue colour. `?view=flights|hotels|visas|enquiries|online` narrows to trips containing that service. Empty state: "No trips yet — start one for a customer" + New trip.

- [ ] **Step 1:** Build page; run demo (`NEXT_DIST_DIR=.next-implementation` build, `node tests/demo-server.mjs`) and verify at 1280px and 375px: chips filter, search narrows, row opens `/trips/<id>`, no horizontal scroll.
- [ ] **Step 2:** Commit `feat: trips list with stage filters`.

### Task 5: Trip page

**Files:**
- Create: `src/app/(app)/trips/[id]/page.tsx`, `src/app/(app)/trips/[id]/TripView.tsx`
- Modify: `src/app/(app)/cases/[id]/page.tsx` → `redirect('/trips/' + id + query)` keeping `tab`/`history` params

**Interfaces:**
- Consumes: `readTrip`, `TripStageBar`, existing `WorkDesk` (filtered to the case, as the case page does via `readWork`), existing `CaseProfit`, `CaseEditor`.

Sections, top to bottom: header (Max ID, title, customer link, phone, owner, Edit/assign via `CaseEditor`); stage bar; **"Add to this trip"** row: Quote (`/sales?action=new&case=`), Flight (`/ticketing/new?case=&product=FLIGHT`), Hotel (`…&product=HOTEL`), Visa (`/visa/new?case=`), Other service (`/ticketing/new?case=&product=OTHER` — use the wizard's existing other-product id), Payment (existing payments entry with booking/visa preselected), To-do (opens WorkDesk add modal with the case preselected); **Services** (each booking/visa/enquiry as a card: type icon, label, status, dates, open link; dead ones struck through); **Money** (invoiced/received/due + CaseProfit, finance only); **To-dos** (WorkDesk for this case); **Documents**; **History** (collapsed, existing events pager). Trip with no services: the "Add to this trip" row is the hero with the prompt "What does <customer> need?".

- [ ] **Step 1:** Build page + redirect; verify in demo: new empty trip, trip with flight+hotel, trip with visa, online booking trip, as owner and as a staff user (ASSIGNED) — staff gets 404 on others' trips; `/cases/<id>?tab=history` lands on the trip with history open.
- [ ] **Step 2:** Commit `feat: single trip page replacing case page`.

### Task 6: New trip flow

**Files:**
- Create: `src/app/(app)/trips/new/page.tsx`, `src/app/(app)/trips/new/NewTrip.tsx`

Two steps on one screen: (1) **Who** — search customers (`/api/cases?q=` like `NewCase.tsx`) or "New customer" inline (same fields as the New customer modal, POST `/api/customers`, handles `DUPLICATE_PHONE` with Open/Create anyway); `?customer=<id>` preselects. (2) **What do they need** — big buttons Enquiry/quote · Flight · Hotel · Visa · Other, plus optional "Trip name" (default "<destination or service> – <customer>"). Submit: POST `/api/cases` `{requestKey, customerId, service, title}` (service = `FLIGHT|HOTEL|VISA|…` per existing `services` list; Enquiry uses `FLIGHT`), then `router.push` to the matching wizard with `?case=<caseId>` (Enquiry → `/sales?action=new&case=`). Retry-safe with the same `requestKey` like `NewCase.tsx`.

- [ ] **Step 1:** Build; verify in demo: existing customer → Flight lands in booking wizard with the Max ID shown; new customer inline → Visa lands in visa wizard; duplicate phone shows Open/Create anyway; double-click Create makes one Max ID.
- [ ] **Step 2:** Point every "New booking / New visa case / Register client request" entry (Shell quick menu, customer page, empty states) at `/trips/new?customer=…` where a customer is known; keep the old wizard URLs working.
- [ ] **Step 3:** Commit `feat: new trip flow as the single way to start work`.

### Task 7: Today page

**Files:**
- Create: `src/app/(app)/today/page.tsx`, `src/app/(app)/today/TodayClient.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx` → `redirect('/today' + query)` preserving `?denied=1` banner behaviour (move the banner to Today)

Cards (each hidden when the user lacks the permission, each with "See all"): **My to-dos** (overdue + due today from `readWork` "mine"; inline Done uses existing work action), **Travelling in 7 days** (`readTrips` with stage BOOKED and start ≤ today+7), **Payments to collect** (existing pulse balance items), **Enquiries to follow up** (existing sales attention/follow-up source), **New online bookings** (last 48h platform bookings), **Alerts** (existing pulse alerts). `?action=todo` opens the add-to-do modal (internal or pick a trip).

- [ ] **Step 1:** Build; verify demo as owner and staff; empty agency shows a 3-step "Get started: add a customer → start a trip → add your suppliers" card.
- [ ] **Step 2:** Commit `feat: today page as the single home screen`.

### Task 8: Customer page around trips

**Files:**
- Modify: `src/components/CustomerMasterWorkspace.tsx`, `src/lib/customer-next-step.ts`, `tests/customer-next-step.ts`

Tabs become `Trips · Travellers & documents · Money · Activity` (map old tab params to these). Trips tab = `readTrips({customerId})` rows with stage bars + "New trip". Next-step rules keep their order but actions point to trips: "Start a trip" replaces "New booking"; "Issue ticket"/"Collect payment"/"Review documents"/"Continue visa" link to `/trips/<caseId>` when the booking/visa has one.

- [ ] **Step 1:** Update `tests/customer-next-step.ts` expectations (idle → label "Start a trip", href `/trips/new?customer=<id>`); run → FAIL.
- [ ] **Step 2:** Implement; run → pass.
- [ ] **Step 3:** Verify customer page in demo (desktop + 375px).
- [ ] **Step 4:** Commit `feat: customer page lists trips and starts trips`.

### Task 9: Links, wording and old-route sweep

**Files:** grep-driven across `src/` (no new files)

- Replace user-facing "case"/"journey"/"service request"/"Register client request" with "trip" (keep "Max ID"); "Add work" → "Add to-do"; "Work register" → "To-dos".
- Every internal link to `/cases/<id>` → `/trips/<id>`; `/dashboard` → `/today`; notification/activity link builders in `src/lib` (e.g. `case-events.ts`, `pulse.ts`, notification creators) emit the new URLs.
- `/cases` list → `redirect('/trips')`.

- [ ] **Step 1:** `grep -rn "/cases/\|\"/dashboard\"\|Register client request\|Add work" src` → zero hits outside redirects.
- [ ] **Step 2:** `npm test` (known pre-existing failure: `tests/smoke.mjs` first-run assertion — unchanged), `npx tsc --noEmit -p .` clean.
- [ ] **Step 3:** Commit `chore: trip wording and links everywhere`.

### Task 10: Complete traveller profile and document vault (need 1)

**Files:**
- Create: `src/lib/profile-completeness.ts`, `tests/profile-completeness.ts` (add to `npm test`)
- Modify: `src/components/CustomerMasterWorkspace.tsx` (Travellers & documents tab only)

**Interfaces:**
- Produces: `profileCompleteness(traveller: {fullName, dateOfBirth, gender, nationality, passportNumber|hasPassport, passportExpiry, phone, email, profile: Record<string,unknown>}): {filled: number, total: number, missing: string[]}` — counts the "travel-ready" set: full name, date of birth, gender, nationality, passport number, passport expiry, phone or email, emergency name, emergency phone, and one identity document uploaded. `missing` holds human labels in that order.

Each traveller is one card: name + relation, **"Profile 7/10 – missing: Passport expiry, Emergency contact"** bar, **Edit full profile** (one long form, grouped by the existing `master-fields.ts` section titles, all sections open, save via the existing master mutation API), and a **Documents** strip: image thumbnails (images) / PDF icon, type, expiry, verified badge; **Upload document** button with `accept="image/*,application/pdf"` and `capture="environment"` on phones, posting to the existing master upload route. Passport expiring within 6 months of today shows an amber "Expires soon" chip; expired shows red. Text under the strip: "Documents are stored privately and kept permanently. They are never deleted automatically."

- [ ] **Step 1:** Test: all ten present → `{filled:10,total:10,missing:[]}`; no passport + no emergency → missing `["Passport number","Passport expiry","Emergency contact name","Emergency contact phone","Identity document"]`; run → FAIL.
- [ ] **Step 2:** Implement; run → pass.
- [ ] **Step 3:** Build UI; verify in demo: upload a JPG passport from a 375px viewport, thumbnail appears, staff without `canViewSensitiveDocs` sees masked number, file survives server restart.
- [ ] **Step 4:** Commit `feat: traveller profile completeness and document vault`.

### Task 11: Transfer to-dos and team follow-ups (need 2)

**Files:**
- Modify: `src/components/WorkDesk.tsx`, `src/app/(app)/today/TodayClient.tsx`
- Create: `src/lib/team-load.ts` (read-only), `tests/team-load.mts`

**Interfaces:**
- Consumes: existing `POST /api/tasks/[id]` with `ownerId` + `note` (already supported), `canAssignWork(user)`.
- Produces: `teamLoad(user): Promise<{userId, name, open: number, overdue: number, dueToday: number}[]>` — only for users with `case:assign`; scoped by `scopeWhere`.

Every to-do row gets a **Transfer** button (shown only when `canAssignWork`): pick staff + a required reason ("Why are you transferring this?"), saved as the change note so it appears in history. Today page gets a **Team** card for admins: one row per staff member (open / overdue in red / due today); clicking filters the to-do list to that person. Trips with `nextFollowUpAt` ≤ today show under "Follow up today" on Today, with **Done** and **Snooze to…** using the existing case edit route.

- [ ] **Step 1:** Test `teamLoad`: two staff, one overdue task each in different branches; BRANCH admin sees only their branch; ASSIGNED user gets `[]`. Run → FAIL.
- [ ] **Step 2:** Implement; run → pass.
- [ ] **Step 3:** Verify in demo: owner transfers a to-do to staff with a reason → staff sees it on Today; history shows "Transferred from Owner to Staff: <reason>".
- [ ] **Step 4:** Commit `feat: transfer to-dos and team follow-up view`.

### Task 12: Profit/loss banner and full trip history (needs 4 and 5)

**Files:**
- Modify: `src/app/(app)/trips/[id]/TripView.tsx`, `src/app/(app)/trips/TripsList.tsx`
- Create: `src/lib/trip-history.ts`, `tests/trip-history.mts`

**Interfaces:**
- Consumes: `caseFinance(prisma,user,id)` (unchanged).
- Produces: `tripHistory(user, caseId, page): Promise<{rows:{at: Date, who: string, what: string, href?: string}[], more: boolean}>` — merges `ServiceCaseEvent` for the Max ID with `AuditLog` rows whose `entity`/`entityId` belong to the trip's bookings, visa cases, invoices, payments, tasks and documents; newest first, 50 per page; same visibility as the trip.

Directly under the stage bar, for users with `payment:view`: a full-width banner per currency — green background **"Profit ₹12,400"**, red background **"Loss ₹3,200"**, grey **"Cost needed for 2 items"** when any cost is unconfirmed — with Sale / Cost / Received / Customer due beneath. Trips list shows a coloured Profit column for the same users. The History section becomes a readable timeline: date + time (IST), who, what changed, link; old/new values from the audit detail when present.

- [ ] **Step 1:** Test `tripHistory`: a trip with one booking edit and one payment → both rows, newest first, staff with ASSIGNED access on another trip gets 404. Run → FAIL.
- [ ] **Step 2:** Implement; run → pass.
- [ ] **Step 3:** Verify in demo: sale 10,000 / cost 8,000 → green ₹2,000; raise cost to 11,000 → red ₹1,000 loss; history shows both edits with the user's name.
- [ ] **Step 4:** Commit `feat: profit/loss banner and trip history timeline`.

### Task 13: Simple report centre (needs 3 and 6)

**Files:**
- Modify: `src/app/(app)/reports/page.tsx`, `src/app/(app)/reports/ReportCentreClient.tsx`

Landing page shows six large cards, each with one headline number for the chosen period (This month default; Today / This week / This month / Custom) and an **Open** + **Excel** button, using the existing report sources: **Profit by trip** (green/red per Max ID, total at top), **Payments to collect**, **Supplier payables** (by supplier, overdue first), **Sales by staff**, **Staff to-dos** (open/overdue per person), **Travel this month**. All other existing reports stay under "More reports".

- [ ] **Step 1:** Verify in demo: totals on cards equal the existing detailed reports for the same period; Excel downloads open.
- [ ] **Step 2:** Commit `feat: simple report centre`.

### Task 14: End-to-end demo run and phone pass

- [ ] **Step 1:** Fresh demo; as owner: add customer with full profile + passport photo → New trip (Flight) → finish booking → add hotel and visa from the trip → record payment and supplier cost → see green/red banner → add to-do and transfer it to staff → check Today, Trips counts, Reports totals unchanged vs. same data before revamp.
- [ ] **Step 2:** As staff (ASSIGNED): sees only own trips; denied pages land on Today with the banner.
- [ ] **Step 3:** 375px pass over Today, Trips, Trip, New trip, Customer: no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`).
- [ ] **Step 4:** Fix findings, commit `fix: trip revamp demo findings`, then show the owner the demo before merging `trip-revamp` into `main`.
