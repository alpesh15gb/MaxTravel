# WhatsApp recipient-context regression

The reported defect was confirmed from source: quick replies interpolate a customer's
name on the server, but the old client applied an asynchronous reply to whichever
composer was currently open. No wrong-recipient outbound send or live incident was
reproduced.

## Fix boundary

- Recipient-keyed RAM-only drafts, capped at 20 and 30 minutes since the last edit.
  Existing authenticated session/user/branch/permission identity keys the provider.
  No localStorage/sessionStorage or cross-tab persistence is used.
- Conversation switches and same-workspace SPA Back preserve unsent text without
  carrying A's text or handoff into B. Replacing a nonempty draft with a quick reply
  and discarding a draft require explicit confirmation.
- Every preview is bound to recipient, view generation, and composer revision.
  Editing fields, switching recipients, leaving the inbox, expiry, or resetting the
  authenticated workspace makes late preview completion inapplicable.
- Pending sends/consent changes acquire synchronous recipient locks before fetch.
  Completion clears only the submitted revision and only that recipient's draft.
  Network failure, malformed acknowledgement, HTTP 5xx/408, and UNKNOWN status keep
  a recipient-bound unresolved-outcome barrier across SPA navigation. They never
  trigger automatic retry. Staff must refresh/check that customer's conversation
  and WhatsApp and explicitly confirm the manual check before another attempt.
- Identical reviewed retries retain their request ID. The server now honors valid
  supplied request IDs in manual LOGGED mode as well as configured mode, using its
  existing unique request-key column. A replay rechecks current actor/customer
  scope and exact customer/body/attachment/frozen-cloud-template/quick-template
  identity, then returns the existing message without another activity/audit row.
  A LOGGED replay keeps its original frozen recipient and manual provenance even
  when the customer's phone or provider configuration changes. An original missing
  phone remains a null handoff. No provider action is retried or promoted.
  Legacy manual callers that omit the ID remain non-idempotent for compatibility;
  invalid supplied IDs are rejected. Concurrency conflicts remain uncertain until
  the same ID is reconciled; an error is not evidence that nothing committed.
- Parameter, template, text, or attachment changes invalidate cloud wording review.
  Returning to a recipient requires fresh cloud/PDF review. Attachment generations
  also reject delayed uploads after discard/expiry; the old upload is aborted.
- Successful sign-out resets memory before routing. Scope/session provider changes
  reset it. pagehide synchronously redacts private composer DOM; a persisted
  BFCache entry retains only unresolved-action metadata, not text, attachment
  links, request fingerprints, or handoffs. Late completion cannot revive redacted
  private content. Reload/closing the document is warned about and is not recovery.

The send API changes only the supplied-ID replay behavior described above. No
permission rule, server consent/window check for new sends, attachment ownership
check, provider worker, credential, schema, or security setting is changed.

## Maintained checks

- `node --import tsx tests/whatsapp-composer-memory.ts` (also included in `npm test`)
  exercises the production memory logic: delayed A/B previews, A→B→A, edits while
  awaiting quick/cloud previews, repeated clicks, late send settlement, reviewed
  retry IDs, cloud/PDF consent, SPA unmount/Back, bounds, expiry/reset/BFCache privacy,
  and late uploads after discard/expiry.
- `npm run build && npm run test:whatsapp-browser` drives the **actual inbox client**
  with two synthetic customers and delayed/intercepted fetches. The transport
  deliberately ignores preview abort signals, so generation guards are exercised.
  All `/api/whatsapp/*` requests are intercepted and browser requests to external
  origins are blocked. It asserts zero message/attachment rows in the isolated DB.
  The fixture covers actual SPA navigation/Back, synchronous repeated events,
  changed drafts, cloud parameter changes, PDF re-consent, unknown outcomes, and
  synthetic pagehide/pageshow events. These events are not a full native BFCache
  engine acceptance test.
- `npm run test:whatsapp-idempotency` exercises the real manual send/log HTTP route
  in a throwaway SQLite database: duplicate and concurrent requests, mismatched
  payload/customer/template, actor isolation, fresh scope denial, frozen/null phone,
  legacy omitted-ID compatibility, and replay after provider configuration appears.
  It never calls a provider or processes the queue.
- The HTTP and browser checks are wired into CI after the build; diagnostics are uploaded from
  `test-artifacts/whatsapp-recipient-context/` and
  `test-artifacts/whatsapp-manual-idempotency/`.

## Local evidence and limits

The pure suite, repository TypeScript check, repository ESLint check, production
build, existing workflow regressions, WhatsApp formatting test, and existing Meta
Cloud/PDF policy suites, and real-HTTP manual idempotency fixture passed in the
isolated fix worktree. Both concurrent manual calls returned 200 and shared exactly
one committed message/activity/audit; the fixture also permits safe contention
responses and proves subsequent same-ID reconciliation. The two policy suites
used a newly migrated throwaway SQLite DB and their existing fully mocked provider
transport; no real WhatsApp/provider action occurred.

The real-HTTP manual idempotency fixture is separate from the browser fixture; its
result is recorded under `test-artifacts/whatsapp-manual-idempotency/report.json`.
Both fixture servers load a fail-closed guard that blocks all external/provider
fetches, even if a regression accidentally attempts one.

The actual-client browser fixture was authored and typechecked, **not run locally**.
Browser launch had been denied earlier in the task; it was neither retried nor
bypassed. Permitted CI must establish its runtime result. The full `npm test` chain
was not run locally because it includes browser launches. No push or deployment was
performed as part of this local fix.

## First integrated CI browser run

Run `40043782410`, job `120720675843`, at integrated commit `5d7acc0` passed
the manual-idempotency fixture but stopped the browser fixture before its first
recipient switch. The exact `getByLabel` selector did not match the shared `Field`
wrapper, whose label text includes its select's options. The uploaded screenshot
shows Customer A's picker and draft present; the report has no page errors and no
completed race groups. This was fixture lookup failure, not evidence of a product
race. The fixture now matches the exact `.field-label` text and its unique control,
including the later cloud-template select. All race and no-provider assertions
remain intact. Local browser execution remains prohibited; a fresh CI run must
establish the corrected fixture's runtime result.
