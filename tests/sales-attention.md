# Today sales attention

Read-only derived queue, scoped exactly like Sales discovery:
- Requires customer:view; both lead and customer branch/assignment scope apply before the 50-row limit. Merged customers are excluded.
- Open stages NEW / QUALIFIED / QUOTED only. Recorded follow-ups before the next IST midnight appear; timestamps strictly before now are overdue.
- Accepted, not-yet-converted quotes appear without a manufactured deadline, including quotes whose expiry passed after acceptance. One row per enquiry even when its follow-up is also due.
- No prices, terms, share hashes or accepted customer signatures are selected. No task, booking or accounting mutations are performed by Today.
- A clear cap note appears only with more than 50 eligible enquiries. Oldest overdue work comes first, followed by accepted quotes, then today's remaining follow-ups.
- Links use `/sales?lead=<id>` and the existing scope-checked exact-record loader; inaccessible/missing IDs show an unavailable notice, never a guessed record. Existing recovery guards remain active.

Local database check (temporary migrated SQLite, never configured app DB):

    node --import tsx tests/sales-attention.mts

Included in `npm test`. Tests cover IST boundaries; overdue/due-now/today/tomorrow/no deadline; closed/converted states; accepted/unconverted including expired acceptance; deduplication; both scope gates; merged customer exclusion; permission denial; before-limit filtering; exactly-50/over-50 disclosure; refreshed resolution; no tasks/financial changes.

`node tests/sales-handoff-controller.mjs` extracts and exercises the actual client load, activation and reload functions with pure stubs (no browser/network/database). It covers interrupted first-page and off-page exact reads, retry target preservation, repeated reload locking, pending action-review precedence, later deliberate selection, unavailable-to-valid route notices, and late responses after a route change. An unresolved URL handoff remains pending after transport failure; successful scoped resolution clears it so it cannot override later user selection.

`tests/sales-today-browser.mjs` runs through the existing `tests/ui-metrics.mjs` CI gate, using only its disposable review fixture. It covers an interrupted off-first-page exact handoff and explicit retry, reschedule + Back/Refresh removal, accepted quote conversion/removal and unavailable deep links. Local browser execution was intentionally not attempted because of the existing protected-path browser-launch denial. Browser assertions are authored, not locally certified.

## CI 40044950542 follow-up

The UI diagnostic run passed its 21-route measurements and staff handoffs, then
failed the exact `Work area` lookup. The enclosing label also contained every
select option; the control now takes its accessible name from the visible label
span explicitly. The exact-label browser assertion is retained.

The earlier accessibility audit reached the seeded workspace but timed out
waiting for the post-login dashboard. Its artifact had no auth response, alert,
login screenshot or internal server log, so authentication rejection versus
pre-hydration submission cannot be distinguished retrospectively. The login
component did expose interactive SSR controls before React owned their values
and submit handler; those controls are now disabled until mount. The audit also
requires a successful actual login POST and saves redacted failure evidence.
This is a real early-interaction hazard fix, not a claim that the historical
login timeout has been conclusively explained. CI browser rerun remains required.

`node tests/login-readiness.mjs` renders the actual login component with hook
stubs and checks disabled-before-mount, ready and busy states without launching
a browser; it also guards the explicit Today visible-label binding.
