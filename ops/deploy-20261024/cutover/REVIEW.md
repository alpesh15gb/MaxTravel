# Scoped cutover candidate — booking 40b4988 — 24 October 2026

**Independently statically reviewed and accepted, including mount-order compatibility and the exact-byte source-evidence hash correction; 33 offline tests pass. Not live-tested. Execution awaits exact successful build outputs and the required backup/isolated-restore evidence at each phase gate.** No VPS, Docker, database, or provider command was executed during this preparation. This directory does not edit build-only scripts. The build-helper author separately added an evidence-bound retained-helper exception and a final build success marker during review; these phases require that revised shared verifier and marker.

## Candidate target compatibility — not publication or execution approval

These phase runtime/scripts/tests are byte-identical to corrected phase manifest `86b06477ce90232d7bc4d163da5678b1863da30b3d9acc6ecee84fb7a61b6a23`; only this document and the derived manifest differ. All 33 offline tests pass when importing this directory’s **candidate sibling** `../verify.py`, SHA256 `7a9397314a89f510009fbbbd915e68c3abc391320a26fce8ce16d5fd23164185`.

- Booking candidate commit: `40b4988136c9708ca29a7f9340af52c53da37cc1`.
- Booking candidate repository tree: `197826e00a7b1b092035c3352912de86a3a6d081`.
- Only the booking target commit/tree changed in the sibling verifier; CRM target, historical baselines, image/release pins and phase operational-source policy remain unchanged. The seven newly fixed app paths are tests/workflow/docs, not runtime/schema/dependency changes.
- Docker-image CI/non-root smoke have passed according to the coordinating task; full integration/browser/WebKit checks and main promotion are still pending. This is candidate compatibility evidence, not a completed release.
- Reuse CRM build `/root/crm-build-c27b8e3-p3drk2` only with its verified success-marker/runtime evidence. Booking’s earlier failed build does not qualify. No backup/cutover may begin before a successful corrected booking build and required phase checks. The build script still requires remote main to equal the accepted target; no bypass is introduced.
- Exact CRM evidence fixtures needed by offline tests were copied byte-for-byte into the candidate sibling `evidence/` directory; no evidence was normalized or overwritten.

## Required evidence / sequence

The accepted build script records `source-commit.txt`, `source-tree-id.txt`, `candidate-image-id.txt`, `candidate-image.private.json`, `non-root-readability.private.json`, `after.private.json`, final atomic `build-verified.json`, original Compose paths and full-path preserved dependencies. These scripts consume those records; they never guess the latest directory or tag.

Missing live facts: the two successful new build directory paths and immutable image IDs, backup/isolated-restore results, then each verified release path. Historical source/runtime pins remain in `../verify.py` and must match. Do not replace them with a newly observed value merely to bypass a failure.

1. `freeze-backup-verify-crm.sh`: set exact CRM `BUILD` and booking `PEER_BUILD`; requires both completed builds. Freezes existing CRM worker then app, backs up SQLite/uploads/package media using unchanged pinned tools, restores into private isolated storage. Rejects live upload/media symlinks and special files and independently compares full attachment/media file hashes and directory coverage across live, backup and restored trees; seals all backup payload files for recheck. Separately audits every SQLite table, complete schema, sequence state, migration ledger/checksums, integrity and foreign keys across live frozen data, backup and isolated restored data. Other containers are checked against build evidence.
2. `cutover-crm-app-only.sh`: same build variables plus exact emitted `SNAPSHOT_STAGE`. Checks final backup markers, stopped original identities, preserved dependencies and immutable candidate; starts only existing CRM app service. Keeps worker stopped. Compares exhaustive DB audit and BUILD_ID, health/login/public-catalogue reads and full runtime environment/topology. Does not advance pointer.
3. `finish-crm-worker.sh`: same builds plus exact emitted `RELEASE`. Recreates only the already configured existing CRM worker workload (no added worker). Verifies existing command/user/entrypoint/environment, protects booking/PostgreSQL/unrelated containers, checks health and 60-second restart-free observation; atomically advances existing CRM pointer. Worker resumption can perform its previously enabled real work; no synthetic provider transactions are submitted.
4. `freeze-backup-verify-booking.sh`: swap `BUILD` to booking and `PEER_BUILD` to CRM; set completed `CRM_RELEASE`. Only after verified CRM receiver. Starts a network-disabled isolated PostgreSQL clone from the exact live PostgreSQL image, with dedicated scratch data and consistent `/tmp` sockets, **including `PGHOST=/tmp` for image initialization's internal clients**. Stops only existing booking app. Refuses unexpected database clients. Dumps custom archive plus globals without role passwords; isolated restore compares counts, schema, sequence values/called state and migration ledger. Original PostgreSQL never stopped/recreated.
5. `cutover-booking-app-only.sh`: same values plus exact emitted `BOOKING_BACKUP_STAGE`. Revalidates final data, schema, source/entrypoint, restricted runtime DB role and exact original environment. Starts app only with no dependencies/build/pull, no migrations or new workers; verifies image/build/health/public routes/protected identities before pointer advancement.

Each phase requires `APPROVED_CUTOVER='reviewed backup and scoped cutover'`. This acknowledgement does **not** substitute for review, actual stage evidence, or authorization. No convenience command with invented stage values is supplied.

## Explicit operational delta

Both apps use the immutable newly built image. CRM app additionally sets **`RUN_MIGRATIONS=false`** in the appended override. The exact pinned CRM entrypoint supports this flag; SHA256s of the pinned entrypoint/backup/restore files fetched through the GitHub connector are checked against staged source. Full candidate effective environment is checked before replacement and full actual environment after replacement, permitting only this one extra app flag. Existing worker environment is unchanged. Thus the candidate app does not call `prisma migrate deploy`; no schema migration is performed. This flag persists in the new release override and should be reconsidered in a future, separately reviewed migration deployment.

Booking retains existing `node server.js` startup and image entrypoint; no migration/provision task runs. No credentials, keys, auth settings, provider settings, original env files or original Compose files are modified.

## Frozen dependency preservation

New release directories contain only appended image/CRM-skip overrides and evidence. Compose always uses its original absolute file sequence, original private interpolation env and unchanged project directory, under a clean shell environment. This preserves booking's potentially older absolute `runtime.env` dependency. Existing release directories remain required dependencies and must not be deleted. The new current pointer identifies the overlay release; future upgrades must inspect its operative file sequence rather than assume all configs live under that new path.

## Failure / rollback boundaries

- Every failure stops; scripts do not blindly retry or auto-restore. Candidate containment changes restart policy to `no` only on a failed attempted cutover, as an explicitly recorded safety delta; successful deployment preserves the original policy. Exact source/pointer/runtime drift requires reconciliation.
- Freeze emits a private `resume-old.sh` escape only for abandoning **before candidate recreation**. It verifies original identities and helper termination, takes a lock, marks the final backup invalid and starts old services. CRM old startup may recheck its already-applied migration ledger; the pre-freeze read-only audit proves no missing/mismatched committed migrations. Do not run it after any migration or candidate recreation.
- `cutover-attempted.txt` is written immediately before Compose recreation. From that point the old-container resume escape refuses execution, even if Compose failed partway. Any recovery needs state inspection and a separately reviewed image/config rollback. Do not restore an old DB over new writes.
- Post-start legitimate user/background writes can make exact counts/sequence comparison fail. This is deliberately fail-closed; a failure does not establish corruption and does not authorize destructive restoration. CRM worker stays stopped if app verification fails. Failure containment locates only the exact candidate image under the scoped app/service labels, records private evidence, disables its restart policy and stops it. After attempted CRM worker recreation, failure contains both candidate worker and app. It never restarts old containers or restores data. If Docker cannot stop/update a candidate, an explicit warning requires operator inspection.
- Original services are stopped only after backup prerequisites pass; verified final backup/restore must pass before recreation. If backup fails after freeze, the old app may remain stopped until the explicit pre-cutover escape is reviewed/run. Helpers and backup data are retained; no forced data cleanup is performed.
- `--no-deps` scopes Compose actions, but shell scripts cannot prevent independent external operators from changing state between checks. A shared flock coordinates these phase/build scripts only. Coordinate the maintenance window.

## Offline verification

`python3 test_phase_offline.py`: 27 tests; `python3 test_booking_offline.py`: 6 tests. Tests include Bash syntax, embedded Python parsing, actual expansion and Bash syntax of generated resume helpers, scoped protection and same-ID restart refusal, source schema drift refusal, full PostgreSQL socket consistency, schema-normalization behavior, app-only action, retained-helper preservation, symlink rejection, tree coverage and runtime security/hostname drift. Node syntax check of `audit-crm.cjs` and Python compilation also pass. No claim of real backup recovery, container startup, provider/email behavior or live deployment has been made. ShellCheck unavailable.

## Mount inspection order compatibility revision

A real Docker inspect result reordered a stopped backup helper’s `Mounts` array without changing any complete mount dictionary or multiplicity. All phase preservation/runtime mount comparisons now ignore only this array ordering, using canonical JSON of each entire mount dictionary, with duplicate entries retained. Source, destination, type, RW, propagation, mode, driver, names, nested options/list order, unknown fields, added/removed entries and duplicates remain significant. Shared `verify.canonical_mounts` is required from the separately reviewed updated build helper; no existing Config/HostConfig or lifecycle comparison was loosened. Command/entrypoint arrays and protected-container environment ordering remain strict.

New regressions cover order-only acceptance in both full preservation and runtime gates, every mount field/category above, cardinality/duplicates and non-mount ordering. Earlier success-marker requirements are unchanged. An existing CRM stage without `build-verified.json` is **not** accepted merely because its image exists; the build author’s separately reviewed revalidation must establish success first. This phase preparation executes no VPS commands and changes no original evidence.

### Reviewed shared build-helper compatibility

The renewed phase review accepted code manifest `75ec074a47ade2352a17fc5be4c598e90a76503cb2954d5ea835e0dfd7480a42` with these exact shared dependencies (this paragraph and acceptance wording are documentation-only changes afterward):

- `../verify.py`: SHA256 `f13e9e466a908448f3ace9d5e3f446c3f4517f57fc92f69eabf1760c3fd4262b`; exports `canonical_mounts(list)` with complete-record, multiplicity-preserving semantics.
- `../preserve-build.sh`: SHA256 `2b2c29ccc7d1b9b13a15ac680aa5489c2458ea25e88fb107a5a3dbc7c058e2f6`.
- Final `build-verified.json` contract unchanged: `status=verified`, exact `stage`, `app`, `commit`, `tree`, immutable `image`, plus `verified_at`. Every phase still requires this final marker and independently checks the preserved before/after evidence.

The separate existing-stage revalidation helper is not invoked by these phases; its review and successful execution must establish the marker before an incomplete existing stage becomes eligible. Phase review does not establish that recovery ran or that any live build, backup, restore, or cutover succeeded.

## Exact source-evidence byte correction

The original local transfer of each CRM operational evidence file accidentally appended one extra LF. Before any phase publication/execution, the root task fetched raw files at target commit `c27b8e352a9bdaf55f94df9fb3da1376f0f402d6`, verified each raw Git blob identity against repository tree `3e5df6ecc245dbb40d02272cb257b203153ae123`, and replaced the evidence with exact bytes. Only the three corresponding expected SHA256 constants changed in runtime code; no normalization or ignored whitespace was added.

| Target file under `scripts/` | Bytes | Git blob SHA1 | Exact SHA256 |
|---|---:|---|---|
| `docker-entrypoint.sh` | 2306 | `204f8af43add5268ce4ca6faae9a3c2df8b5d8ef` | `cf34b79a8e7e23cbe376555c4bb4c5ec29a4ce2a08aea9a8fe468a9b35124f5a` |
| `backup.mjs` | 16554 | `dfdfd66a18cdd499abd9d70de7ddde0692fe154f` | `7586e52b3740116a435e75c69731dc66bb64a9a060d52d43276130586bdf86c5` |
| `restore.mjs` | 24706 | `5ee510e2afe9205798feade563b68376d6bd662d` | `34333d2e9dc2e300f9ef78f90fea662a39ff60437bcd907b32d12bdb1336956f` |

Focused tests verify raw byte lengths, Git blob framing (`blob <length>\0<bytes>`), SHA256s and source-validator acceptance, then confirm appending a single LF to **any** of the three exact staged files is rejected. Build/backup/live evidence gates and all runtime actions are unchanged; this correction does not establish a successful booking build or authorize cutover. Earlier phase packages containing the transfer-derived hashes are obsolete.

Focused independent reviewers accepted corrected code manifest `62215e64ea6bc299eeae42f9f31c8ffd6edc879c73c8b62b2dd6693786472642`. An archived Git comparison against unreferenced commit `2433d21920c79805f39ddfa5b284058e8a3bd797` confirms the only runtime changes are the three expected SHA256 literals; all shell/booking/audit files are byte-identical. This acceptance wording is a subsequent documentation-only change. Publication remains held: any new booking source pin resulting from its Docker-isolation fix must first be accepted/tested and these phase contracts reviewed against that pin.

## Portable private snapshot filtering — 24 October, 23:26 UTC

The first real CRM freeze invocation encountered an unsupported Docker `ps` negated-label filter. This narrow compatibility patch replaces only that snapshot query with universally supported `docker ps -aq --no-trunc`, saves full unfiltered `docker inspect` output privately beside the filtered evidence, then excludes exactly records whose `Config.Labels["maxtravel.cutover.helper"]` is the string `"true"`. Missing/null/false/other labels and unrelated services remain; all original identity, mount, configuration and lifecycle validators are unchanged. No containers or evidence are removed.

The first snapshot call occurs immediately after creation of the private backup-stage directory and before pre-freeze SQL, helper creation, `FROZEN=1` or either CRM stop command. In that unchanged initial invocation, `set -e` exits on the unsupported query before any scripted service stop. This code-order proof does not establish unrelated/manual activity or replace live status evidence. The failed private stage must be retained; no image rebuild, DB restore or new backup was performed by this patch preparation.

All 65 prior offline cases plus four new regressions pass (32 helper + 37 phase = 69). Regressions cover exact missing/false/true label semantics, unrelated-container retention, empty filtered-inventory refusal, absence of negated Docker filters, raw-evidence preservation and first-snapshot-before-stop ordering. This supersedes earlier byte-identical-runtime wording only for the explicitly described snapshot portability fix; no source pin, credential, worker, migration or cutover behavior changed. Independent focused review is required before root publication.

The export workflow additionally defines a separate real Docker CLI smoke job on an ephemeral GitHub-hosted runner. `test_snapshot_docker.sh` creates three owned synthetic containers from official `docker.io/library/alpine:3.22` but never starts them; no ports, host mounts, secrets or application commands run. It sources common definitions without calling `init`, exercises actual `snapshot_all`, asserts full filtering semantics and never-started normal/true/false fixtures, then removes only captured, ownership-verified, nonrunning IDs with bounded non-forced cleanup. Raw inspect evidence stays private and is not printed/uploaded. **This smoke has not been run locally and must not be reported passed until actual CI completes.**

## Exact existing-candidate recovery after replacement metadata guard

Compose metadata is version-dependent: older official Compose v2.24.7 uses the replaced full container ID; v2.39.4 uses `container_name` when configured, otherwise `service-name` plus its container number. The VPS reported exact relative labels `app-1` / `worker-1`. The validator now additionally accepts only the default service-relative form when both old/new full canonical names, project, service and positive container-number agree. Arbitrary replacement text/custom-name variants are not accepted; unchanged-ID labels remain strictly equal. Official references: https://raw.githubusercontent.com/docker/compose/v2.24.7/pkg/compose/convergence.go and https://raw.githubusercontent.com/docker/compose/v2.39.4/pkg/compose/convergence.go .

`recover-crm-app-existing.sh` is incident-specific to existing app ID `e7153d4b7464ca74d9583c4ad25b134eb5daff3e9c3d8e35c078ec531630675e`, release `crm-release-c27b8e3-2S4iPz` and snapshot `final-backup-QC1WkM`. It checks frozen configuration, source/images, saved pre-containment and actual candidate identity, complete config/mount/security fields (only proven containment restart-policy delta normalized in memory), original stopped worker and all unrelated containers. It binds the recovery baseline to the sealed verified backup, then audits live SQLite read-only before any startup. Only afterward it records a persistent one-attempt marker, restores the recorded `unless-stopped` policy and starts the **same** container ID. No Compose recreation, DB restore, migration, worker start or pointer advancement occurs.

After startup it reruns complete runtime/config, DB/schema/ledger/counts/sequences, BUILD_ID, HTTP contract and protected-container checks. Original failure evidence is retained; new recovery evidence is private. The previously absent app-verification marker is written last. A failed attempted recovery contains the exact candidate again; its persistent attempt marker prohibits blind retries. Embedded recovery Python uses `-I` so inherited `PYTHONOPTIMIZE` cannot disable checks.

The initial app-only attempt had passed health/build/database/HTTP gates before failing on the replacement label; the error trap then disabled restart and stopped the candidate. The worker stayed stopped. The new CI job runs actual Compose create/force-recreate on one unique owned official-Alpine service, never starts it, and invokes the actual full runtime validator on observed before/after inspect records. It uses no ports/mounts/secrets, private evidence and bounded, ownership-checked, exact-recorded-ID cleanup. Existing snapshot CI is unchanged. **Actual new Compose smoke is pending, not locally claimed passed.**

Offline verification now passes 74 cases (32 helper + 36 phase + 6 booking), including strict modern/legacy replacement checks and same-ID one-attempt recovery/optimization-isolation regressions. Independent focused review and real CI must precede any operator recovery.
