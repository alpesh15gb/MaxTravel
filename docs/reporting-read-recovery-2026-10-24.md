# Reporting read recovery and CI evidence preservation

## Confirmed incident evidence

- Commit `8a6b6ee`, Actions run `40047023066`, job `120730989323`: the dedicated reporting browser step failed at **00:59:43 UTC**, after the original 15-second wait for the ageing table following a held payment-terms save (`tests/reporting-browser.mjs:71`).
- Downloaded artifact `12541593060`: the preserved failure HTML/PNG show a **desktop** report, current India day `2026-10-24`, closed payment-terms modal, and **Generating / Loading report**. They do not show a hidden phone table or an API error.
- The same job subsequently invoked `tests/journey-suite.mjs`, which runs reporting again at line 26. This second invocation logged a full reporting **PASS at 01:00:45 UTC**. It overwrote the shared server log and ordinary screenshots, leaving a mixed artifact directory containing the first failure and the later success.
- The earlier feature run `40046374091` had also passed the same report scenario.

**The original 15-second stall's exact transport/lifecycle cause remains unproven.** The old fixture captured neither request completion timing nor the report application's own server log, and the second invocation overwrote much of its evidence. Same-code passes are not proof that the failure was harmless. No speculative accounting, schema, permission or payment-write change is made.

## Separate proven product weakness and bounded correction

Report-centre options, account reports and overview reads previously awaited fetch and JSON decoding without a deadline. A transport or body-read promise that never settled could leave the UI busy indefinitely.

`src/lib/report-read.ts` now bounds the entire read at **35 seconds**, allowing the existing server's 30-second report transaction window. It races both fetch and JSON completion against a deadline, then aborts its private transport controller. It does not cancel the caller's generation controller, so the existing guarded catch/finally paths can display a clear error and re-enable explicit retry. External cancellation still suppresses obsolete/unmounted generations. Even a transport that ignores abort cannot apply its late result.

No automatic retries, report totals, accounting rules or write behavior are changed. A failed read does not display zero totals or reuse stale exports. **This is not presented as a fix for an original test timeout at 15 seconds.** That ordinary success assertion and its timeout remain unchanged.

## Evidence improvements

Every browser invocation now writes its own timestamp/PID directory under `test-artifacts/reporting/`, preserving both dedicated and journey runs. Each includes:

- invocation/commit/run metadata;
- request, response, completion and failure timings for report endpoints, with only date/report/page/format criteria and the *presence* of identity filters;
- held payment-terms fetch/fulfilment phase markers and the real save status (a failed held write rejects the fixture gate rather than leaving it waiting);
- post-terms and failure client state (busy/alert counts, report type, viewport, table presence), without customer values;
- the owned synthetic fixture's application server log and failure HTML/PNG from the active test page.

Network diagnostics retain **no request/response bodies, cookies, headers, customer IDs, supplier IDs, staff IDs or status values**. Tests verify that exclusion. Diagnostic capture errors cannot replace the original test assertion failure.

## Verification

- 8 controlled-transport tests: timely success, never-settling transport, never-settling JSON, late completion, explicit retry, cancellation, already-cancelled request and malformed JSON.
- 2 diagnostic tests: privacy and distinct pending/finished/failed lifecycle states.
- Existing 7 workspace and 102 reporting/accounting checks retained and passing locally; typecheck/lint, production build and script syntax also pass.
- New authored CI scenario holds a real report JSON response, advances the browser clock through the 35-second deadline, verifies the error/no exports, explicitly retries, and releases a distinguishable stale body to prove suppression. **Not run locally**: local browser execution remains prohibited.
- The new diagnostic CI run is required to establish whether the original post-terms stall recurs and, if it does, where the request stops. Do not silently rerun it into a pass or claim a root cause before those timings exist.
