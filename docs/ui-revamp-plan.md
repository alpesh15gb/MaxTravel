# UI revamp plan — 11 October 2026

A plan for the second revamp. The first one was real work and it stuck: contrast is measured
and documented in `globals.css`, focus rings survive the date-picker's four focus stops, the
off-canvas drawer no longer keeps 15 invisible controls in the tab order, touch targets have a
42 px floor on phones, and the copy is de-sloganed. All of that was verified by the accessibility
gate, which sits at **0 findings** today.

The reason it can be green and still feel wrong is narrower than it sounds: **that pass had no
visual acceptance criterion.** It measured contrast, focus, semantics and wording. It never
measured type size, density, hierarchy, fill or colour discipline — so nothing failed, and the
screens were never asked to be good, only to be correct.

Everything below was measured against the running app (the seeded review workspace, 1440×900 and
390×844), not read off the docs.

---

## 1. What is actually wrong, with the numbers

`tests/.runtime/ui-metrics.mjs` walks all 18 screens and measures type size, fill, nested
scrolling and action hierarchy. Baseline:

| measure | baseline | where it hurts |
|---|---|---|
| text nodes below 13 px | **567 of 719 — 79 %** | every screen; median font size is **12 px** on 15 of 18 |
| median text size | 12 px (11 px on Settings) | the whole product sits at 11–12 px while the viewport is 1440 px |
| type that scales with user font size | none (81 × `text-[11px]`, 2 × `text-[10px]` are px literals) | browser/OS enlargement does nothing |
| dead space below content | **30 % mean**, up to 65 % (checklists), 60 % (employees, notifications), 51 % (documents, payments) | the page stops two-thirds up and the rest is empty |
| nested scroll regions | 2 screens (`/visa`, visa detail) | board and detail scroll inside a fixed-height box |
| primary actions per screen | 0 on dashboard/documents/whatsapp/audit; 2 on refunds/suppliers/settings | there is no consistent "the one thing to do here" |

Six structural causes, in order of how much they cost:

**1.1 Type is a size too small everywhere.** `text-xs` (12 px) is the default UI size and
`text-[11px]` is used 81 times for meta, table headers, eyebrows, hints and status chips. On a
1440 px screen that reads as "internal admin tool", not "premium workspace". It is also immune to
the user's text-size setting, because the values are pixels.

**1.2 The token layer exists but is inert.** `:root` declares ten variables; components consume
`--accent` (focus ring) and `--panel-radius` and almost nothing else. `--workspace-gutter` and
`--header-height` are declared and **never read** — the page uses `px-4 md:px-6` and the rail
hardcodes `top-[56px]`. Spacing, type, radius and elevation are decided in **835 `className`
occurrences across 63 components**, so nothing can be changed in one place. This is why the app
can only be nudged screen by screen, and why it drifts.

**1.3 The brand hue's name lies, and three green relics survive.** `tailwind.config.ts` maps the
`teal` key onto the *blue* ramp (`teal-700` = `#1a63c4`) so that old utilities would follow the new
accent. That worked, but three literal green-teal values were left behind: `::selection`
(`#99f6e4`/`#0f3d3a`), `.auth-story`'s radial gradient (`#087f8c66`) and the `#087f8c`-family glow.
So text selection and the login screen are green while the workspace is blue, and no one reading
the config can tell what the brand colour is.

**1.4 One idea, three implementations — and a shared component that re-decides itself per caller.**
The "row of numbers" exists as `.stat-card` (a lone card), `.summary-strip .stat-card` (the band,
with different padding and a smaller value size) and `.customer-summary` — the last written as **raw
CSS outside Tailwind**, beside a legacy `.customer-*` block and a global `main table` rule. Worse,
`.summary-strip` is `grid-cols-2` in the stylesheet and then re-decided at **six call sites**:
`sm:grid-cols-3` on customers, payments and suppliers, `xl:grid-cols-4` on the dashboard,
`grid-cols-3` on tasks, `grid-cols-2` on refunds. One shared component therefore renders three
different layouts (2-up, 3-up, 4-up) depending on which screen opened it — and the dashboard's band
is 4-up only from
1280 px, collapsing to a 2×2 grid on a 1200 px laptop or a 125 %-zoomed 1440 px display, which is
the common case, not the edge case. `StatCard` also accepts `tone?: string` while only two tones
(`.amber`, `.rose`) exist. A system that cannot be enforced is not a system.

**1.5 Space is spent in the wrong places.** 30 % of the viewport is empty below the content on
average, while the text is 12 px: the app simultaneously wastes room and squeezes type. Inside the
containers it is the same story in miniature — the customers KPI band is a single full-width row
(measured at 1440 px: 1184 px wide, three equal 394 px cells) carrying three short facts,
`Customers · 3`, `Active relationships · 3`, `Corporate & partner · 0`, the last of which repeats a
number the table underneath already shows. Customer 360's right rail is a four-row panel beside a
long column, and its six-cell number strip is the same trick again.

**1.6 The board does not fit its own screen.** Five columns at `w-[264px]` plus four 12 px gaps is
1368 px inside ~1232 px of content width, so `/visa` scrolls horizontally inside a fixed-height
region (`h-[calc(100vh-19rem)]`) that also leaves a dead band. Four of the five columns were empty
in the seeded workspace, and each rendered a **full-height dashed "No cases" slab**.

And two that are information design, not styling:

**1.7 The screens answer the same question twice.** The dashboard shows a "Needs attention: 2" tile
and, directly beneath it, a panel headed "Needs your attention · 2". Customer 360 spends its most
prominent row on six equally-weighted numbers — three of them zero — then offers twelve
undifferentiated tabs (Visa Cases / Tickets / Trips / Documents / Payments / Refunds / WhatsApp /
Tasks / Notes / Activity Timeline), which on a 390 px phone is 1008 px of tabs in a 336 px strip.
The customers table says "Showing 3 of 3" above the table and "Showing 3 of 3 matching · 3 total"
below it. The same figure is **₹75,800** on the dashboard (`inrAmount`) and **₹75,800.00** on the
money page (`inrFixed`).

**1.8 The door is designed; the rooms are not.** The login screen has a
`clamp(3rem,4.8vw,5rem)` display headline, a dark gradient story panel and a pointed accent
(`text-teal-300`) on the brand word. Inside the workspace there is no display type, no imagery
(`public/` does not exist, `next/image` is used zero times), one radius (8 px), one accent and
eight randomly-assigned avatar hues — blue, violet, emerald, amber, rose, sky, indigo and "teal",
which is the loudest colour in the product and means nothing.

---

## 2. What "good" has to mean here (checkable acceptance criteria)

The product's own promise is *"Search anyone, know everything, see what is pending, take action."*
The revamp is judged against that, not against taste:

- **AC1 Legibility** — no UI text below 13 px; body copy 14 px; numbers 15–16 px with tabular
  figures; the whole scale in `rem`, so it follows the reader's settings. Target: **≥95 % of text
  nodes ≥13 px, median ≥14 px**.
- **AC2 Hierarchy** — exactly one primary action per screen, and the deciding number is at least
  twice the size of any secondary value on that screen. Target: `primary actions == 1` on every
  screen, asserted.
- **AC3 Density** — density is a chosen mode, not an accident: **44 px** rows comfortable, **36 px**
  compact, driven by one attribute. A 24-row list is readable without scrolling at 1440×900.
- **AC4 Fill** — **≤25 %** of the viewport empty below the last element on a seeded workspace, and
  no container with more than ~15 % unused inline space.
- **AC5 One accent** — a single interactive hue; every other colour is semantic and named
  (money due, overdue, blocked, success, info). Nothing decorative is coloured.
- **AC6 Enforcement** — changing the brand hue or the density is a one-file change, and
  `grep` for `text-[Npx]`, raw hex or palette hues **outside the token layer returns zero hits in
  components**.
- **AC7 No regression** — the accessibility gate stays at 0 findings; focus rings, measured
  contrast, touch floors and reduced-motion behaviour are preserved.

---

## 3. The system to build

**3.1 Three token layers** (CSS variables in `globals.css`, surfaced through `tailwind.config.ts`;
this is the layer that makes AC6 true):

- *primitive* — `--brand-50…900` (one ramp, honestly named `brand`, with `teal` kept as an alias
  for one release and deleted after), `--ink-900/700/500/400/300`, `--surface-0/1/2`,
  `--line-strong/default/subtle`, and semantic ramps `--ok-*`, `--warn-*`, `--danger-*`, `--info-*`.
- *semantic* — `--text-primary/secondary/muted/inverse`, `--bg-app/panel/raised/inset`,
  `--border-hairline`, `--accent`, `--accent-weak`, `--accent-contrast`, `--focus-ring`.
- *component* — `--rail-width`, `--header-height`, `--gutter`, `--card-pad`, `--row-height`,
  `--field-height`, `--btn-height`, `--radius-sm/md/lg`, `--shadow-1`, `--shadow-2`.

**3.2 Type scale** — five steps, `rem` only, weights 400/500/600 (no 700 in body copy):

| token | size / line | used for |
|---|---|---|
| `text-display` | 2 rem / 1.2 | page titles (one per screen) |
| `text-title` | 1.25 rem / 1.3 | card and section titles |
| `text-body` | 0.875 rem / 1.5 | body copy, table cells, form values |
| `text-small` | 0.8125 rem / 1.45 | **the floor** — meta, hints, secondary lines |
| `text-micro` | 0.75 rem / 1.3, uppercase, tracking | eyebrows and table headers only |

KPI numbers get their own step (`1.5rem`, tabular, weight 600) and money gets `font-variant-numeric:
tabular-nums` everywhere it is compared down a column.

**3.3 Density as a mode** — `<html data-density="comfortable|compact">`; tables, lists, cards and
toolbars read `--row-height`/`--card-pad`. Default comfortable, remembered per user in
`Settings → Appearance`; a keyboard-reachable toggle in the list toolbars.

**3.4 Shape and elevation** — three radii (6/10/14 px), three surfaces (app `#f4f6f9`, panel white,
inset `#f8fafc`), and elevation reserved for things that truly float (popover, dialog, toast,
drag ghost). Cards keep a hairline but lose the four-sided border in favour of a top highlight, so
a screen with eight panels stops reading as grid paper.

**3.5 A real component inventory** (~18 primitives in `src/components/ui/`, everything in the app
migrated onto them): Button (primary/secondary/ghost/danger × sm/md), IconButton, Input / Select /
DateField / Textarea / Checkbox / Radio / Switch, Field, Tabs (with counts and an overflow menu),
SegmentedControl, Table (sticky header, column widths, row actions, single footer), DataToolbar
(search + filters + view switch as one bar), Card (with header slot), **StatTile + StatRow** (one
implementation, replacing three), EmptyState (inline and full), StatusChip, Avatar (neutral by
default; colour only where it distinguishes people), Drawer / Modal / ConfirmDialog, Toast,
Timeline, SectionNav, ProgressMeter.

---

## 4. Screen-by-screen information design

| screen | today | change | why |
|---|---|---|---|
| Dashboard | "Needs attention 2" tile above a "Needs your attention" panel | keep the panel, delete the tile — or keep the tile as a *number* and turn the panel into grouped sections | the same fact twice in the first 200 px |
| Dashboard | right third is a "Start new work" column that mostly empties (≈25 % of the content width) | move quick actions into the header area beside the title, let the attention list use the full width | gives a quarter of the canvas back to the list staff actually work from |
| Dashboard | filter chips render as `All · 2 / Urgent · 0 / High · 2` | real Tabs with counts; hide empty buckets behind "show all" | the dot separator reads as one broken label |
| Customers | a 3-cell strip spanning the full content width for three short facts; two "showing 3 of 3" lines; one primary button | strip shrinks to its content (or earns its width with facts the table does not show); one footer; `Export` demoted to a ghost action | fill, and one place to read the count |
| Customer 360 | 6 equal numbers (3 zeros), 12 tabs, short right rail | a summary ribbon leading with the deciding numbers (money due, next deadline) and **suppressing zeros**; 4 tab groups + overflow; right rail gains content or is removed | hierarchy: the reader should not weigh six numbers to find one |
| Visa board | 5 × 264 px columns, horizontal scroll, full-height empty slabs, stage select duplicating the column | 4 columns fit ≥1280 px, columns `minmax(240px,1fr)`, empty column collapses to a 40 px header strip, stage select removed from the card, deadline + money as the strongest row | fits the screen; removes duplicated controls |
| Money | `₹75,800.00` here, `₹75,800` on the dashboard; zero-weight "Overdue invoices 0" | one money format per context, decided once and asserted; zeros de-emphasised and subdued | two truths for one number |
| Visa detail | 19 controls, all similar weight; nested scroll | case header owns the stage move; sections collapse; a sticky case spine (case no, applicant, deadline) | the deciding facts must not scroll away |
| Documents, Tasks, Audit | long tables at 12 px with no density control | the Table primitive + density mode + expandable audit detail row (the deferred item from the last pass) | legibility, and one long-standing gap closed |
| Checklists, Employees, Notifications | 60–65 % dead space with 4–27 text nodes | inline empty states, real content density, and a "what to do next" action | a new agency sees these screens first |
| Login / Setup | designed, but green relics | keep the composition, move it onto the brand ramp | one brand, everywhere |
| All | 0 or 2 primary buttons | exactly one primary action | AC2 |

---

## 5. Phases (each independently shippable, each with its own exit)

**P0 — Foundations (1–2 days).** Tokens (all three layers), the type scale, `data-density`, radius
and elevation, delete the legacy `.customer-*` and `main table` CSS by re-expressing them with
primitives, rename `teal` → `brand` with the alias kept, purge the three green literals. Nothing
moves; screens are only re-typed. **Exit:** zero `text-[Npx]`, zero raw hex in components, metrics
harness re-run shows median ≥14 px, a11y gate still 0.

**P1 — Primitives (2–3 days).** Build the inventory, then migrate one reference screen per module
(dashboard, customers list, Customer 360, visa board, money). **Exit:** each reference screen uses
only primitives; controls per screen stop varying by 5×.

**P2 — Information design (2–3 days).** The §4 changes, including the money-format decision, the
tab restructure, the board fit, and the single-primary-action rule. **Exit:** AC2/AC4 met on every
screen.

**P3 — Signature (1–2 days, optional but this is what makes it feel designed).** One display face
(or a tuned Geist pairing — the app self-hosts `GeistVF.woff`; a second face means one more
licensed asset), a product mark that is more than a compass in a rounded square, a low-contrast
motif for headers and empty states, module accents as wayfinding (or explicitly none), and
impeccable empty/loading/error states. **Exit:** before/after screenshots for all 18 routes.

---

## 6. How this gets proven (what the last pass lacked)

The review workspace (`tests/visual-review-server.mjs`) already seeds realistic data and serves it
on an isolated port. The revamp extends that into a **UI metrics gate**, so visual quality is
measured the way accessibility is:

- promote `tests/.runtime/ui-metrics.mjs` to **`tests/ui-metrics.mjs`** and add it to `npm test`
  after the accessibility gate, with thresholds from §2: ≥95 % of text nodes ≥13 px, median ≥14 px,
  dead space ≤25 %, no nested horizontal scroll, exactly one primary action, no `text-[Npx]`, no raw
  hex outside `globals.css`.
- extend it to capture a **screenshot matrix** (18 routes × desktop 1440 / compact 1100 / phone 390)
  into `test-artifacts/ui/`, and a before/after pair per route into `docs/ui-revamp/`.
- keep the accessibility gate as the floor: a revamp that improves the look and regresses the gate
  is not shippable.
- add smoke assertions for money-format consistency and for the density attribute actually changing
  row heights.
- one human read-through per phase: the screenshots plus the metric table, not a claim.

---

## 7. Decisions that are yours, not mine

| # | decision | options | cost / consequence |
|---|---|---|---|
| D1 | visual direction | **(a) Quiet ledger** — light, tighter density, numbers as the hero, near-zero colour; **(b) Operations cockpit** — darker rail, assertive semantic colour, high-contrast data surfaces; **(c) Warm agency** — soft surfaces, editorial type, generous spacing, photography | (a) is the smallest change from today and lowest risk; (b) is more distinctive and needs contrast care; (c) is the nicest to look at and the riskiest for dense data (it also needs image assets — there are none today) |
| D2 | default density | comfortable (44 px) or compact (36 px) | staff who live in tables usually choose compact; comfortable is the better first impression |
| D3 | scope & order | all 18 screens, or the four staff live in (dashboard, customers, visa, ticketing) first | the four are most of the daily value; the rest can follow without blocking |
| D4 | typeface | keep self-hosted Geist (zero risk, and it is already the app's only face) or add one licensed display face | a second face buys identity and costs an asset, a licence and a loading budget |
| D5 | the visa board | fix the fit (4 columns + overflow, collapsing empties) or make the list the primary view and the board secondary | the board suits 4 stages; the case flow has 5+ |

My recommendation if you want the shortest path to "this looks designed": **D1(a) + D2(comfortable)
+ D3(four screens first) + D4(keep Geist) + D5(fix the fit)**. It closes AC1–AC6 on the screens that
matter without touching behaviour, and it is reversible screen by screen.

---

## 8. Not in scope

- No behavioural rewrite. Permissions, record scope, money semantics, audit trail and copy rules
  stay exactly as they are — the suite pins money and access, and this plan must not move them.
- No new runtime dependency unless D4 chooses a font (one asset, self-hosted like today's).
- No accessibility regression: the measurements, focus behaviour, touch floors and
  reduced-motion rules in `globals.css` are the floor this plan builds on, not a thing to redo.
- No dark mode in P0–P2. The token layers in §3.1 make it a later one-file change if you want it.
