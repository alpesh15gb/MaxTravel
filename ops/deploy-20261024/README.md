# MaxTravel — build-only preparation, 24 October 2026

**BUILD-ONLY CORRECTION: use only after fresh VPS preflight review and explicit build-only clearance.** The prior user-run attempt stopped before building on a retained upgrade-check container; the narrowly identified successful stopped check is now excluded only from service eligibility, not from preservation. This is not cutover approval.

## Exact tested source targets

- CRM (`alpesh15gb/MaxTravel`): `c27b8e352a9bdaf55f94df9fb3da1376f0f402d6`
- Booking (`alpesh15gb/MaxTripJack`, `booking-platform`): `a0360fb0e8b533452bec5b3d7c3865e46d608f4e`

Scripts are pinned to these source commits and historical runtime identities. Their Bash/Python checks and 22 synthetic validator tests passed locally. No VPS build or live runtime validation is claimed. If remote `main`, runtime identity, or frozen configuration has changed, stop and review; do not bypass a guard.

## Transfer and verify

Use the exact reviewed ops-branch commit supplied by the deployment coordinator via Git. Keep both scripts and this checksum manifest together; run `sha256sum -c SHA256SUMS` before execution. This verifies file integrity, not execution approval. Do not use an earlier checkout or blindly retry a failed stage.

## Before any build

Fresh review must confirm intended root host `Apex`, local default Docker context, current containers/images/health/restarts, PostgreSQL identity and volume, operative Compose paths, frozen environment dependencies, and resource headroom. Scripts require at least 9 GiB available RAM and 20 GiB free space on staging/Docker filesystems. The standard builder has no CPU/memory caps and can affect production latency. Use existing approved Git authentication only; do not put tokens in commands or this package.

## After explicit fresh-preflight clearance only

From the extracted directory, as root on the reviewed VPS:

```bash
APPROVED_BUILD_ONLY='reviewed fresh preflight; build only' bash ./preserve-build.sh crm
```

Wait for `BUILD COMPLETE — NOT DEPLOYED`, review the outcome, and only then run:

```bash
APPROVED_BUILD_ONLY='reviewed fresh preflight; build only' bash ./preserve-build.sh booking
```

Never run the builds concurrently. On any STOP, error, or timeout, stop and review the private stage/logs and builder activity; do not automatically retry or weaken guards. Do not paste private logs, environment files, or credentials into chat.

## What this does — and does not do

Creates private rollback-image/config evidence, fetches pinned source into an isolated directory, builds candidate images, and runs a disposable network-isolated non-root file/dependency check. No live credentials are included in this ZIP; runtime evidence produced on the VPS is private and may contain secrets.

It does not restart production, start application/worker entrypoints, migrate databases, call providers, change live checkouts/Compose pointers, or cut over. A rollback-image archive is not a database backup. Preserve prior releases and frozen dependency files. Both builds must pass before any separately reviewed backup/restore, write-freeze, or cutover plan; later cutover is CRM receiver first, then booking. This package supplies no cutover commands.

A final `build-verified.json` is created only after all validations pass. It binds the stage, app, source commit/tree and candidate image. Partial/failed build directories without this marker must never be selected for cutover.
