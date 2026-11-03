# Confirmation receiver reliability verification

The signed receiver stores current supplier PDFs privately for staff access. It
keeps exact-body retries deduplicated and ignores equal or older revisions.
A status-only revision is authoritative and sets `documentsCurrent=false`; a
previous PDF must not be shown as the current booking document.

`tests/platform-documents.mts` exercises the actual signed receiver, SQLite
transactions and private PDF store. It covers status-only delivery,
same-revision no-backfill, duplicates, invalid signatures, immutable payment
rollback, stale revision ordering and access to the current document.
Use a disposable migrated `integration-test.db` only.

PDF availability does not queue a customer message. Staff email remains a
separate, explicit workflow. A later revision may supply a new current PDF;
no current document is available while `documentsCurrent` is false.
