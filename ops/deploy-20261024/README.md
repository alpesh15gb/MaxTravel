# MaxTravel — build-only preparation, 24 October 2026

**BUILD-ONLY CORRECTION: use only after fresh VPS preflight review and explicit build-only clearance.** The prior user-run attempt stopped before building on a retained upgrade-check container; the narrowly identified successful stopped check is now excluded only from service eligibility, not from preservation. This is not cutover approval.

## Exact tested source targets

- CRM (`alpesh15gb/MaxTravel`): `c27b8e352a9bdaf55f94df9fb3da1376f0f402d6`
- Booking (`alpesh15gb/MaxTripJack`, `booking-platform`): `a0360fb0e8b533452bec5b3d7c3865e46d608f4e`

Scripts are pinned to these source commits and historical runtime identities. Their Bash/Python checks and 32 offline validator/recovery tests passed locally. No VPS build or live runtime validation is claimed. If remote `main`, runtime identity, or frozen configuration has changed, stop and review; do not bypass a guard.

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

## Confirmed Mounts-order final-guard recovery

The reported existing CRM image stage `/root/crm-build-c27b8e3-p3drk2` reached its final preservation guard and failed solely because Docker returned an old backup helper's Mounts in a different order. The corrected validator compares complete mount records without discarding values or duplicates. Other configuration list ordering is not relaxed.

After coordinator review of this exact helper revision, `revalidate-built-crm.sh` can revalidate **only that stage**, without rebuilding. It requires `APPROVED_BUILD_REVALIDATION='reviewed mounts order only; no rebuild'`, reruns full source/archive/rollback/frozen/config/image/current-runtime/non-root-readability proofs, preserves original evidence, and writes the original stage's success marker only after all checks pass. New private evidence is stored in that stage's `revalidation-*` directory. A successful build marker is not permission to cut over; booking build and reviewed backup/restore remain required. This recovery has not been live-tested by the assistant.
