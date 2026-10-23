# Two-app package HTTP proof

This test runs **both real built applications**, with a fresh temporary CRM SQLite database and synthetic owner/package. Booking's production package adapter and server-rendered detail page consume the real CRM public routes. No response JSON is mocked. The explicit test-only preload maps only the fixed public CRM package GET paths to the disposable loopback CRM; every other outbound fetch is rejected. No browser, provider or payment is exercised.

## Run

Use clean fixture checkouts with installed dependencies and production builds. The harness refuses `.env`, `.env.local`, `.env.production` and `.env.production.local` in either checkout. It never accepts a deployed URL, database URL or real account credentials. Dependencies and builds must match the two selected revisions.

From the CRM fixture checkout:

```sh
BOOKING_FIXTURE_ROOT=/absolute/path/to/booking-checkout/booking-platform npm run test:two-app-packages
```

`BOOKING_FIXTURE_ROOT` is a local source path, not a network endpoint. The harness chooses loopback ports, applies CRM migrations only to its own `mkdtemp` SQLite file, creates a synthetic staff account, starts both Next servers with allowlisted environment variables, and drives real CRM login/create/save/publish/unpublish HTTP. Child processes and the temporary database are cleaned up; evidence remains under `test-artifacts/two-app-packages/`.

The assertions cover:
- Draft hidden from booking catalogue API, detail API and detail HTML.
- Published title, amount and inclusions traverse the actual two-app HTTP boundary.
- Internal notes never appear in public API/HTML.
- Later unpublished draft edits do not change the public snapshot.
- Unpublish removes the previously warmed listing/detail/SSR immediately, including repeated reads.
- Booking responses retain no-store/noindex boundaries, every adapter fetch must already specify no-store (including Request/init overrides), and each observation reaches the CRM adapter (bridge log).

`proof.json` reports `status: passed` only after all assertions and child/database cleanup succeed; partial runs report `failed`. Before input/build preflight, the harness replaces any prior report with a failed preflight marker carrying a fresh `runId`; the final report retains that same ID. Run `node --test tests/two-app-package-fetch.test.mjs` for the bridge cache/Request semantics regressions.

Booking catalogue *visual rendering* and CRM editor interaction are separately exercised by their existing browser suites. This test proves the real HTTP/data handoff, not browser UI, production DNS/TLS, deployment configuration, providers, or payments. No cross-repo workflow/access setup is included.

For network-restricted builds only, Next's supported `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` can supply a temporary local CSS fixture outside source. When that build is used, run with `TWO_APP_FONT_FIXTURE=1` so evidence explicitly records that **production font/visual equivalence is not established**. Do not alter production font configuration or deploy the fixture preload.
