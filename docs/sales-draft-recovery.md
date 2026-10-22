# Temporary quotation recovery

## User workflow
Only an unsaved **quotation** is retained. Browser Back/Forward returns to a fresh permitted enquiry read and offers an explicit Restore quotation or Discard saved draft choice. Nothing is posted automatically. A changed enquiry/quote revision or any accepted quote makes the retained copy read-only; it is never silently rebased. Users can review the latest enquiry and copy their old text before explicitly discarding it.

The authenticated layout owns one React-memory copy, with up to 100 line items, existing field-length limits and 100,000 UTF-8 bytes. It expires 30 minutes after the last edit. It is not written to localStorage, sessionStorage, IndexedDB, cookies, history state, logs or telemetry. Full document replacement, closing the tab, pagehide, sign-out, identity/scope changes, successful save and explicit discard clear it. New-enquiry and stage/follow-up forms do not gain Back/Forward recovery in this increment.

An opaque equality-only context binds the copy to the current staff session, user, branch, access mode and permissions. It is not an authorization token. Returning or restoring performs a fresh scoped single-enquiry GET; the 200-row catalogue is not used as proof of record access. Unknown access after a network failure hides the copy until a successful explicit retry. Activity restoration clears prior form and one-time private-link state before paint. Private proposal bearer links are never part of recovery.

## Save safety and compatibility
Quote creation now requires `baseRevision`. The existing scoped transaction checks a fingerprint of lead identity/scope/state/update time and **all** historical quote IDs, versions, states, acceptance, expiry and booking linkage. Missing or stale tokens return 409 with `code: QUOTE_REVISION_CONFLICT` before creating a new quote. Old open tabs must keep/copy their local text, then refresh to obtain the updated client and latest enquiry. There is no unsafe tokenless compatibility bypass. Deployers should tell staff to save or copy open quotation work before refreshing after release.

The pending marker is written synchronously before fetch. An ambiguous response cannot turn the retained copy back into an editable/retryable quotation. Late acknowledgements must match the entry nonce and owning context. Expiry removes private text but does not resolve an unknown write. Explicit review/discard does not cancel a request that may still finish.

This is optimistic conflict protection, **not universal exactly-once delivery**. The sales API still lacks a durable command-key/result protocol; conversion's existing bookingId return is not generalized idempotency. A future command protocol needs transaction-bound deduplication, request-content binding and secure handling of one-time private links; it must not blindly replay financial/provider actions or store bearer links in plaintext.

Existing normal quote/publish lifecycle semantics remain unchanged apart from the base-revision precondition. An older accepted quote with a newer draft remains an existing lifecycle edge outside this change; recovery itself refuses editable restoration when any quote is accepted.

## Operations and verification
No schema/migration, dependency, credential, environment, storage-format or host change is required. This branch is separate from the accepted 6abe workspace deployment.

- `tests/sales-draft-memory.ts`: synchronous copy, size/count/TTL bounds, nonce acknowledgements, unknown-marker retention and isolation.
- `tests/sales-recovery-context.ts`: session/scope context and all-version fingerprint invalidation.
- `tests/staff-sales-flow.mts`: real isolated SQLite/HTTP scope, stale/missing revision and finance-permission checks.
- `tests/sales-draft-recovery-browser.mjs`: real Back/Forward, explicit recovery, fresh scope/session changes, conflicting writes, pending/unknown outcomes and mobile keyboard screenshots.
- Dedicated read-only CI workflow supplements, rather than replaces, normal CI/security/journey/accessibility gates.

Browser results must be reported from completed CI. Desktop/mobile emulation is not physical-device or exhaustive screen-reader certification.
