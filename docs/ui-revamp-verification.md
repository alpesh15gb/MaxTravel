# Travel OS — sharp professional CRM redesign

Verified locally on October 10, 2026. No deployment, commit or push was performed. Tests use isolated SQLite databases and upload directories under `tests/.runtime`; existing agency data was not used.

## Second pass — 11 October 2026: tokens, type, density (P0) and two screens (P2)

The first pass measured contrast, focus, semantics and wording and never measured type size, density,
hierarchy or fill. It could be green and still feel wrong. This pass builds the token layer that the
first pass described but did not use, raises the type scale, makes density a mode, and adds the
missing half of the gate: `tests/ui-metrics.mjs`, which measures what a reader actually sees.

Plan and acceptance criteria: [ui-revamp-plan.md](ui-revamp-plan.md) (§2 AC1–AC7).

**The token layer.** `globals.css` now holds three named layers — primitives (`--brand-*`, `--ink-*`,
`--paper-*`, semantic ramps), semantics (`--text-*`, `--bg-*`, `--border-*`, `--accent`), and component
measurements (`--gutter`, `--header-height`, `--rail-width`, `--card-pad`, `--row-pad`, `--row-height`,
`--field-height`, `--btn-height`, `--panel-radius`, `--shadow-1/2`). `--gutter` and `--header-height`
were declared and never read before this pass; both are consumed now (`.workspace-page`,
`.app-header`, `.app-sidebar`). The three literal green-teal values are gone: text selection, the login
story panel's gradient and the focus ring all read from the brand ramp, and `tailwind.config.ts` keeps
`teal` only as a documented one-release alias for `brand`.

**Type scale.** Five roles plus a KPI step, all in `rem`, so the whole product follows the reader's
font-size setting: `text-display` 2rem, `text-title` 1.25rem, `text-kpi` 1.5rem, `text-xs`/`text-sm`
0.875rem (14px — `text-xs` was the app's 12px default at 238 call sites and moves to the body step),
`text-small` 0.8125rem (13px, the floor), `text-micro` 0.75rem (12px, uppercase tracked labels only:
eyebrows and table headers).

**Density as a mode.** `<html data-density="comfortable|compact">` is the single switch: 44px rows and
16px card padding, or 36px and 12px. A boot script in `app/layout.tsx` applies the stored choice before
the first paint; the switch itself lives in the account menu (reachable from every screen, every width)
and in Settings → Appearance. It is remembered per browser — see the limits below.

**One band, one decision.** `.summary-strip` no longer re-decides itself at six call sites
(`sm:grid-cols-3`, `xl:grid-cols-4`, `grid-cols-3`, `grid-cols-2`). The stylesheet decides: two up on a
phone, then as many columns as fit at a 180px minimum. `StatCard`'s `tone` prop is typed to the three
tones that exist instead of accepting `string`.

**Dashboard (§4).** The "Needs attention" tile is gone — it repeated the count already on the attention
panel's own heading. Quick actions moved from a right-hand column that mostly emptied into the header
beside the title, and the attention list now uses the full width. The priority chips carry their counts
in parentheses and an empty bucket is not offered at all ("Urgent · 0" read as one broken label).

**Visa board (§4).** Four columns that fit the screen — the one-key "Closed" column joined "Decision &
delivery" — so the board no longer scrolls horizontally inside a fixed-height box. An empty column
collapses to its header strip instead of a full-height dashed slab, and the card's 16-option stage
select (the same taxonomy the columns already draw, in a second vocabulary) is replaced by one named
step forward; dragging still moves anywhere and the case page owns the full stage menu.

### Measured before and after

Before: `docs/ui-revamp-plan.md` §1, measured on the same seeded review workspace (1440×900). After:
`node tests/ui-metrics.mjs` on the current build — [report.json](../test-artifacts/ui/report.json),
screenshots in `test-artifacts/ui/` (20 routes × desktop 1440 + phone 390).

| measure | before | after | target |
| --- | --- | --- | --- |
| text nodes below 13px | 567 of 719 — 79% | 48 of 762 — and all 48 are the allowed 12px uppercase labels (0% otherwise) | ≤5% |
| median text size | 12px (11px on Settings) | 14px on 19 of 20 screens, 16px on Checklists | ≥14px |
| pixel type literals (`text-[11px]`, `text-[10px]`) | 83 | 0, and the gate greps for them | 0 |
| raw hex colours outside the token layer | 1 file | 0, and the gate greps for them | 0 |
| dead space below content | 30% mean, up to 65% | 24% mean, 8 screens still above 25% (recorded as ceilings in `tests/ui-budget.json`) | ≤25% on every screen |
| nested scroll regions at 1440 | 2 screens (`/visa`, visa detail) | 0 of 20 | 0 |
| primary actions per screen | 0 on dashboard/documents/whatsapp/audit; 2 on refunds/suppliers/settings | exactly 1 on all 20 | 1 |
| density | not implemented | one attribute: measured 69px → 61px rows on a two-line booking row; stored choice survives a reload | one attribute |

### Verification for this pass

| Check | Result | Evidence |
| --- | --- | --- |
| TypeScript (`npx tsc --noEmit`) | Passed, exit 0 | run in this pass |
| ESLint (`npx next lint`) | Passed, no warnings or errors | run in this pass |
| Production build | Passed | run in this pass |
| Smoke/API/security (`node tests/smoke.mjs`) | 138/138 passed | `npm test` chain |
| Accessibility gate | PASS — 0 findings, budget unchanged at 0 accepted | `npm test` chain |
| UI metrics gate (new) | PASS — 762 nodes, median 14px, mean dead space 24%, 0 nested scroll, 1 primary action per screen, density attribute verified | `npm test` chain, [ui-metrics.mjs](../tests/ui-metrics.mjs), [ui-budget.json](../tests/ui-budget.json) |
| `npm test` as a whole | exit 0 (smoke → a11y gate → ui metrics) | run in this pass |
| Visa-board browser acceptance | 8/8 passed, including the four-column fit, the collapsed empty column, the one-step stage control and the readiness gate | [visa-board-verify.mjs](../tests/visa-board-verify.mjs) |

`tests/client-audit.mjs` was updated for the new dashboard chips (counts in parentheses, empty buckets
hidden), but it **could not be run to a clean state**: it needs a server on `localhost:3212` while every
other harness uses `127.0.0.1`, and its first check (AUTH-01) got `403 "Setup must be completed from
this workspace."` from the same-origin guard, so the owner was never created and all 80 checks after it
cascaded. That harness is not part of `npm test`. The chip rule it asserts was verified in the running
workspace instead: on the seeded agency (2 items, urgent 0, medium 0) the dashboard renders exactly
`All (2)` and `High (2)` — the two empty buckets are not offered — and a fresh agency's single chip
follows the same code path to `All (0)`.

One real defect was found by that acceptance run and fixed: with the board as a grid whose row was
sized to its content, the columns grew past the board's fixed height and slid under the page footer,
which then swallowed clicks on the last action of a tall card. The row is `minmax(0,1fr)` now, so each
column body scrolls its own cards, and the test asserts a populated column is taller than a header
strip.

`tests/ui-budget.json` records the eight screens still above the 25% fill target, with the reason: on
the seeded workspace they list three customers, two bookings, one checklist and no suppliers or
refunds, so they are short of data rather than short of layout, and filling them is §4 content work for
those screens. A screen not in the file must already meet the target, a budgeted screen may not get
worse, and the two-point measurement slack is documented as noise tolerance rather than permission to
regress.

## Layout and hierarchy revision

The user selected a sharp professional CRM direction and identified layout/hierarchy as the main concern. This revision changes the information architecture, not just colours:

- White 56px top bar, 208px navigation rail and compact shared spacing, leaving more width for actual work.
- Dashboard uses a single compact summary strip, a dominant attention queue and a secondary new-work sidebar. Each exception exposes its main next step, with extra actions available under More actions.
- Customer directory defaults to the searchable table; Board remains available with the existing paging and column scrolling.
- Customer 360 exposes one primary Record payment action, Edit customer and a Customer actions disclosure. Secondary tools remain permission-gated, close after selection and support Escape. The menu fits 320px and 390px screens.
- Customer 360 overview leads with current bookings/visa work and tasks; profile details are secondary. Empty conversation/task areas no longer contain decorative nested empty-state cards.
- Visa detail uses a horizontally scrollable workflow row and collapsed stage history so document work is not displaced by all 16 stages.
- Finance, suppliers, ticketing, tasks and refunds use compact summary strips instead of tall, disconnected KPI cards.

Measured in the seeded review workspace: the desktop summary is 95.5px high and its queue begins at 263.5px; on a 390px phone the summary is 141px high and the queue begins at 353px. These are layout measurements, not performance or speedup claims.

## Preserved functionality

- Shared workspace styling across customer, visa, ticketing, document, finance, supplier, task, WhatsApp, team, checklist, audit, notification and settings modules.
- Customer board/list with incremental rendering and independently scrolling lifecycle columns.
- Visa board/list with column paging, filter resets and preserved workflow readiness gates.
- Customer 360, visa case and booking detail panels with consistent headers, statuses, forms and financial sections.
- Task queue grouped by urgency/date, refund queue with stage progress, and notification rows using shared status tones.
- Existing split-layout login/setup forms retained.
- Small-phone fixes: compact top-bar spacing and account control; Settings uses shrinkable grid columns and a stacked stage form.
- Notification read-marking now consumes the JSON response; this resolves the browser's unfinished-response/network-idle timeout without suppressing errors.

## Final verification

All application checks below were rerun after the final phone action-menu repair:

| Check | Result | Evidence |
| --- | --- | --- |
| TypeScript | Passed | [typecheck log](../test-artifacts/hierarchy-typecheck.log) |
| ESLint | Passed; no warnings/errors from source | [lint log](../test-artifacts/hierarchy-lint.log) |
| Production build | Passed | [build log](../test-artifacts/hierarchy-build.log) |
| Separate browser-test build | Passed | [test build log](../test-artifacts/hierarchy-test-build.log) |
| Smoke/API/security | 138/138 passed | [smoke log](../test-artifacts/a11y-smoke.log) |
| Accessibility audit (WCAG 2.2 AA, 21 routes × 2 viewports) | 0 findings | [report](../test-artifacts/a11y/report.md), [log](../test-artifacts/a11y-final.log), [method](accessibility-audit.md) |
| Accessibility gate (run by `npm test`, after smoke) | PASS, exit 0 | [chained run log](../test-artifacts/a11y-npm-test.log), [gate verdict](../test-artifacts/a11y/gate.json), [budget](../tests/a11y-budget.json) |
| Workflow browser acceptance | 12/12 passed | [workflow log](../test-artifacts/hierarchy-workflows.log) |
| Visa-board browser acceptance | 8/8 passed | [visa log](../test-artifacts/hierarchy-visa.log) |
| Responsive browser review | 97/97 passed | [review log](../test-artifacts/hierarchy-responsive.log), [JSON results](../test-artifacts/responsive-review/results.json) |

The responsive suite covers 21 module/detail/form routes at 1440×900, 768×1024, 390×844 and 320×740. It asserts visible headings, no page-level or uncontained horizontal overflow, no captured client errors, and no failed same-origin HTTP responses. Intentional horizontally scrolling boards and tables remain available. Additional interactions exercise complete sign-in/sign-out, customer search/list, visa list, task and actual-ticket dialogs, and mobile navigation. Six added checks verify compact desktop/phone queue positioning, list-first navigation with Board retained, one primary customer action with reachable secondary tools, task tab switching, collapsed/expandable visa stage history, and action-menu boundaries at 320px/390px.

Workflow tests cover cross-origin rejection, missing-document stage gating, expiry-required uploads, re-upload queues, resolved WhatsApp drafts, refund rejection, restricted-role financial masking, booking/customer/task corrections, supplier part/final settlement and printable invoices.

The redesigned dashboard was visually reviewed in the live desktop browser. Final Playwright screenshots were saved for every route and viewport in the [screenshot gallery](../test-artifacts/responsive-review/gallery.html). The Preview panel later failed screenshot capture with empty-frame/compositor errors, so a complete final visual inspection of every redesigned desktop/mobile screenshot could not be completed there. Automated layout and workflow verification still passed. Design acceptance remains the user's decision; passing tests is not a claim that the user is satisfied.

## Local preview

Start from the `travel-os` directory, using the existing installed dependencies:

```bash
REVIEW_PORT=3216 REVIEW_DEV=1 node tests/visual-review-server.mjs
```

The preview is a hot-reloading development app with newly seeded demo records, not the real agency database. Open `http://127.0.0.1:3216/login`.

Demo-only login:
- Email: `review@visual.test`
- Password: `Review-Visual-2026!`

The development build lives in `.next-review`; it is excluded from version control. Do not reuse the published demo password for real accounts.

To reproduce acceptance checks, rebuild both dist directories first:

```bash
npm run typecheck
npm run lint
npm run build
NEXT_DIST_DIR=.next-implementation npm run build
node tests/smoke.mjs
node tests/implementation-verify.mjs
node tests/visa-board-verify.mjs
```

For a production-mode responsive review, start the review server on a free port in a separate terminal, then run the suite:

```bash
REVIEW_PORT=3217 node tests/visual-review-server.mjs
# In another terminal, after VISUAL REVIEW READY:
node tests/responsive-review.mjs
```

The server writes the latest isolated fixture metadata; avoid starting another review fixture during a responsive test run. Ports 3212 and 3213 must be free for the existing acceptance suites.

## Limits / not claimed

- WhatsApp remains manual message logging/handoff. Delivery and inbound provider synchronization are not connected or verified.
- Ticketing records actual tickets entered by staff; it does not issue tickets or query live airline/GDS inventory.
- Payments and refunds record operations; no funds are transferred or charged by this app.
- Document review remains manual; OCR is not connected.
- Density is remembered per browser (localStorage), not per account: there is no per-user preferences column yet. The token layer already reads from one attribute, so adding `user.density` later would need no CSS change.
- The nested-scroll measurement runs at 1440px. At 390px a wide table still scrolls horizontally inside its panel by design, which is why `.panel.overflow-x-auto` remains on the table screens.
- Customer 360's summary ribbon still uses the legacy `.customer-summary` CSS rather than the shared `StatCard`/band primitives; that migration is P1/P2 work in the plan and was not part of this pass.
- Responsive acceptance was run in Chromium, not Safari/Firefox or physical devices. It is not a comprehensive accessibility audit or load benchmark.
- Next.js reports that `next lint` is deprecated; the existing command still passes.
- This checkout has no available Git metadata. Changes are saved locally and left uncommitted.
