# Accessibility audit (WCAG 2.2 AA)

Measured with `tests/a11y-audit.mjs` against the isolated review workspace
(`tests/visual-review-server.mjs`, seeded fixture, never live data), on 21 routes at 1440×900 and
390×844. Contrast is computed from the reported colour composited over the real ancestor
backgrounds; focus is tested with real `Tab` key presses, never programmatic `.focus()`.

```bash
# terminal A
REVIEW_PORT=3321 node tests/visual-review-server.mjs
# terminal B, after "VISUAL REVIEW READY"
node tests/a11y-audit.mjs                     # all rules; exit 1 while any finding remains
node tests/a11y-audit.mjs --rules=focus       # one rule group, for iteration
```

Reports: [summary](../test-artifacts/a11y/report.md) and [raw findings](../test-artifacts/a11y/report.json).

## Result

| Rule | Found | Remaining |
| --- | --- | --- |
| Contrast (4.5:1 normal / 3:1 large text) | 122 | 0 |
| Heading order (no skipped levels) | 16 | 0 |
| Accessible names | 46 | 0 |
| Target size (2.5.8, 24×24) | 36 | 0 |
| Named landmarks | 44 | 0 |
| Focus visibility (2.4.7) | 6 | 0 |
| Dialog focus (trap, Escape, restore) | 4 | 0 |
| Off-screen focus stops on a phone | 15 | 0 |

Final run: `totals {}`, exit 0 — [log](../test-artifacts/a11y-final.log). All other suite results are
in the [revamp verification table](ui-revamp-verification.md).

## The gate

`npm test` runs the smoke suite and then this gate; `npm run test:a11y` runs the gate alone. Both
want a current production build (`npm run build`). The gate owns the whole check: it starts the
isolated review workspace on its own free loopback port, runs the full audit against it, stops the
server again, and compares the result with `tests/a11y-budget.json`.

| Option | Effect |
| --- | --- |
| `--report=<path>` | compare an existing report instead of starting a workspace |
| `--budget=<path>` | compare against another budget file |
| `--update-budget` | rewrite the budget from this run, deliberately |

Four things fail it, all as failures rather than warnings:

1. A finding that is not in the budget.
2. A budget entry that no longer occurs, or occurs less often than budgeted — a budget nobody prunes
   becomes a file nobody reads.
3. A run that did not cover the whole audit: routes that failed to load, focus walks or dialogs that
   never ran, or a report produced with `--rules=` narrowed. A gate that stays green because it
   looked at nothing is worse than no gate.
4. A build older than `src/`. The audit judges a production build, so the gate asks for `npm run
   build` instead of failing you for code you have already fixed.

The budget holds nothing today, which is the point: every finding this audit began with (122 contrast,
46 accessible names, 36 target sizes, 16 heading order, then 44 unnamed landmarks, 6 focus rings and
4 dialog behaviours) would now block a build. The 78 indeterminate results are held as a ceiling
rather than a list, so a new *kind* of judgement call still fails while copy and fixture churn does
not. Shrinking the budget is deliberate: `npm run a11y:budget`.

Each run leaves `test-artifacts/a11y/gate.json` (verdict, reasons, what was accepted) beside the
report, and the workspace log at `test-artifacts/a11y-gate-server.log`. The gate clears both that
log and `tests/.runtime/visual-review-current.json` before starting, so a previous run's "ready"
line or fixture can never be mistaken for this one — it claims the fixture for its own port and
stops its server when it finishes, so the browser suites still need their own review server started
first, as described above.

## What the audit found, and what fixed it

**Contrast.** `text-slate-500` measures 4.76:1 on white but 4.43:1 on the page background
(`#f5f7fa`), 4.34:1 on `slate-100` and 4.20:1 on the board column (`#edf1f6`). The rule now reports
the measured ratio with the surface it was measured against, so the same shade is left alone on
white and darkened one step to `slate-600` (7.06:1) on a tinted surface.

**Focus visibility.** The real cause was `focus:outline-none` on every form control and on the
header search, replaced only by `ring-teal-500/10` — a 10 %-alpha glow. Measured focused state:
`outline: 2px solid rgba(0, 0, 0, 0)`. Every control in the app was reachable and unmarked for a
keyboard user. The suppression is gone, so the single global
`:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px }` applies everywhere, with
the glow kept as decoration.

**Date fields.** A date input is four focus stops in one control: Chromium walks month, day, year and
then the calendar picker, and on that last segment the host input matches neither `:focus` nor
`:focus-visible`, so the ring vanished while focus was still inside the field (measured: one stop
with a 3px ring, the next with none, 850 pixels painted differently from blurred). `:focus-within`
keeps matching, so `.field:focus-within` now pins the ring to the control for as long as any part of
it has focus.

**Dialogs.** Two defects, both measured with real key presses on the New-task and ticket dialogs:

- Tab from the last control landed on `<body>` before the next Tab re-entered the dialog, so the ring
  disappeared mid-cycle. `Modal` now wraps the Tab cycle at both ends.
- React removes the `<dialog>` from the DOM when the parent clears its state, and a removed element
  cannot hand focus back, so closing dropped focus on `<body>` instead of returning it to the button
  that opened the modal. `Modal` captures the opener during the first render (an effect runs after
  React has already applied `autoFocus` inside the dialog) and focuses it on unmount.

**Landmarks.** The navigation rail was an unnamed `<aside>` on all 21 routes, and so was the
WhatsApp conversation list. Both are now labelled; the rail stays an `<aside>` because the CSS and
the responsive suite key off `aside.app-sidebar`.

**Phone focus order.** Off-canvas is not the same as out of reach. The rail is a drawer below `lg`,
and a transform alone left its 15 controls tabbable while parked at `x≈-196`: stops 5-19 of a phone
Tab walk were controls the user could not see. `[data-drawer="closed"]` now sets
`visibility: hidden` below `lg` (with the delayed visibility transition preserving the slide-out),
and the existing `lg` reset restores the rail. `tests/smoke.mjs` asserts the rule ships in the
built CSS, alongside the desktop rail reset it already asserted.

## Instrument corrections

Three rules in `tests/a11y-audit.mjs` were measuring the wrong thing and would have reported
confidently wrong results:

1. **Focus walk.** The walk ends when the cycle returns to its first stop, so the element focused at
   that moment never had a "styles after focus moved on" reading, and comparing its focused styles
   with themselves reported a textbook-perfect control as having no indicator. The element is now
   blurred before that final read.
2. **Indicator quality.** Any style change used to count, so a transparent outline plus a 10 %-alpha
   glow passed as a focus indicator. An indicator now has to be an opaque outline (≥90 % alpha) or a
   shadow painted at ≥25 % alpha; a bare border-colour change is reported as weak.
3. **Target spacing.** The 24 px circle test compared undersized controls only against each other, so
   a small control 4 px from a large one was never checked. Every target is now an obstacle.

## Limits

- 78 target-size results are listed as **indeterminate, manually judged**: inline links whose 24 px
  circle reaches no other target, which WCAG 2.5.8 exempts. They are reported rather than silently
  dropped.
- The audit measures computed style and real key presses. It cannot see inside a user-agent shadow
  tree, which is why the date-field case above needed a pixel comparison to settle.
- `tests/client-audit.mjs` was not run in this pass; its dialog lookup was updated to match the
  dialog's real accessible name (below) but the suite itself needs its own server and state file.
- Two stale dialog-name expectations were corrected, not weakened: `Record actual tickets` was the
  `aria-label` of the hand-rolled `role="dialog"` form that predates the shared `<Modal>`. The dialog
  is now labelled by its visible heading, `Record airline-issued tickets`, which is the better
  accessible name, and `responsive-review.mjs` / `client-audit.mjs` were updated to it (97/97).
