# Confirmation receiver reliability verification

Deploy and verify these receiver guards **before** the optional PDF producer
fallback. The old receiver must never receive the new producer fallback first.
Old frozen events remain schema-compatible and exact-body retries stay deduped.
No deployment has been performed.
A status-only revision is authoritative but has `documentsCurrent=false`.
The receiver transaction cancels older QUEUED/BLOCKED booking-document messages.
Already SENDING messages are not blindly reclassified: the dispatcher rechecks
exact current attachment identity after upload and before submission, cancelling
if superseded. Existing consent, recipient and booking-status checks remain.
Queueing also rejects non-current revision attachments. No schema changes.

`tests/platform-documents.mts` runs the actual signed receiver, SQLite transactions,
private PDF store and WhatsApp queue with all Graph calls intercepted locally.
It covers status-only delivery, same-revision no-backfill, duplicates, invalid
signatures, immutable payment rollback, stale revision ordering, old queue rows,
queue-time attachment matching and revision changes during upload (zero sends).
Use a disposable migrated `integration-test.db` only.

No guarantee of late PDF delivery: receiver ignores equal revisions and automation
keeps its existing per-booking dedupe key. A future revision can carry a current
staff PDF, but does not guarantee a replacement WhatsApp notification. No current
PDF exists when documentsCurrent is false. The final check cannot retract a
provider submission already in flight or observe a producer update not yet synced.
