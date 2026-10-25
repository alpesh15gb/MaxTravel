# Conditional new-main rollout candidate — 25 October 2026

**Local candidate, not published or executed.** The user reported successful historical CRM recovery and worker completion at 09:24 UTC. This revision replaces the unconditional hold with exact reviewed baseline identities and private evidence verification before either build. Root requested one full scoped helper review; existing new-image/build/fresh-backup/isolated-restore phase gates still prevent premature cutover. Independent code review accepted; real helper CI remains pending.

The historical `../deploy-20261024` directory remains byte-identical to ops commit `3c6512c6c87e630d402c12e4f234aa4c8b9b612c`; only that immutable package retains incident recovery/finish semantics. New-package incident recovery and build-revalidation copies refuse execution.

## Exact reviewed target/source delta

- CRM `0d0c72d24c320d56710f3c640a151b34697dc4e6`, tree `d2f370dffb7aec5b5627ff4f2ca6d112de336981`; prospective source baseline c27b8e352a9bdaf55f94df9fb3da1376f0f402d6.
- Booking `06615409f45c5ac9ef3b01b2538b26838ac0c69f`, tree `c044af7ce510f0d3f23214459ad1ccdec78ff0ac`; deployed baseline remains fe14634d50568a2fb905e90ed22040557347f162.
- CRM c27→0d contains no schema, migration, Docker, Compose, entrypoint, environment or runtime dependency change. Package changes are test commands only; existing semantic guard remains.
- Booking 40b→066 likewise changes no schema, migration, Docker, Compose or entrypoint. Package/lock change is exactly Nodemailer 10.1.1→10.1.4, pinned exact. New account-mail origin guard reads existing BETTER_AUTH_URL; no new variables/provider credentials needed. Mail dispatch uses Next after and fixed privacy-safe status vocabulary.
- Booking source guard permits only exact target SHA256 bytes of package.json, package-lock.json, scripts/verify-seo-http.mjs and the two previously reviewed worker source files. All other operational/schema changes still reject. No blanket package/scripts exemption.

## User-confirmed baseline — freshly reverified before builds

The user reported both CRM app and existing worker successfully completed the historical recovery+finish procedure on immutable image sha256:b10e495f4f8fbaca93153552e6484800670c91fa7e778a759674829b28cc3e0a. Pointer must equal `/root/crm-build-c27b8e3-p3drk2/crm-release-c27b8e3-2S4iPz`.

The original config/interpolation base remains `/root/crm-build-2ecf810-ERht2Z/crm-release-2ecf810-IMh1AX`: compose.vps.yaml, compose.evolution.yaml, image-override.yaml, candidate-image.yaml, and private crm.env. Root confirms the historical operative sequence explicitly included this old candidate-image.yaml; it must not be dropped. The known c27 overlay candidate-image.yaml is appended at its exact absolute path. Pointer identity is separately represented as pointer_release, never mistaken for a directory containing original env/config. Runtime requires the exact original FOUR-file ordered sequence plus this c27 overlay (FIVE files total); no optional unknown override accepted. Subsequent new release appends one new image overlay. Existing complete frozen-file hashing also seals the prior overlay.

Booking image, original release, interpolation/runtime env paths and PostgreSQL preservation contract remain unchanged. Root confirms the booking original sequence explicitly included candidate-image.yaml: compose.production.yaml, image-override.yaml, candidate-image.yaml (THREE files total). It is required, not optional. Fresh evidence must corroborate both exact sequences; any mismatch stops rather than adding an optional allowance.

## Exact baseline identity and private proof

User-authored finish output confirms c27 source, immutable b10 image, app healthy, existing worker restart-free for 60 seconds, unchanged booking/PostgreSQL and advanced CRM pointer. Exact service IDs are pinned:

- CRM app `e7153d4b7464ca74d9583c4ad25b134eb5daff3e9c3d8e35c078ec531630675e`.
- CRM worker `61b5923a752281a51f252a6f981de4b41342b1e507cc34fc59febd7bcf18e251`.
- Booking app `5bb3f8f41d6f9d1c7925221106a26285d1a734a112d7291c9771732c76a115a8`.
- PostgreSQL `df9fd0fdf66d26b56736a7d2f411e432d172ab9814a8fdb08fac40d81d04e465`, exact image `sha256:d4bb0a8c1b7bb2e29f976d099e7bfb9a5d8858cffe9e46b35cd302cd1f1f8168`.

Each build checks historical app-verified/deployed-source/deployed-image markers, both current pointers, final CRM evidence and all-final inventory. Fresh current state must match complete protected identity/config/security/mount/network/lifecycle evidence and health/restarts; only the existing exact helper-label filter is used. All unrelated non-helper containers are preserved, including the exact retained upgrade check. Existing before/after build checks additionally preserve the full raw inventory including helpers. Any drift stops rather than inventing a new pin.

The exact source policy now runs before Docker build as well as before cutover. The new workflow `.github/workflows/deploy-helpers-candidate.yml` is scoped to branch `ops/candidate-20261025`, this helper directory and its own workflow file, with read-only contents permission and pinned checkout. It runs offline tests plus unchanged owned-never-started real Docker snapshot and Compose replacement smokes. No deployment script or production credentials execute in CI.

## Sequence once separately approved

1. Historical incident completion is now user-confirmed. Do not repeat it. Never recreate an unknown state or restore over new writes.
2. Complete independent helper acceptance, publish the exact revision and require actual CI; builds reverify the private baseline automatically.
3. Build pinned CRM and booking sequentially; all resource checks, private rollback image/config preservation, source/tree/image verification, non-root isolated readability and final success markers remain.
4. Freeze CRM writers and create a FRESH backup after any resumed writes; verify isolated restore, complete DB schema/ledger/count/sequence/integrity/foreign-key audit and uploaded/media file hashes.
5. Replace CRM app only, migration skip retained; health/runtime/DB/public contract verification, then existing worker with stable observation and pointer advancement.
6. Freeze booking app only, verify PostgreSQL dump plus isolated restore with original PostgreSQL untouched, replace booking app only, verify before pointer advancement.

All protected-service guards, full effective env/config checks, network-disabled backup validation, one-attempt containment behavior and no-blind-restore rules remain. No new workers, credential changes, provider test transactions, database migrations, cleanup or unrelated service changes are authorized by this candidate.

## Verification

103 distinct offline tests pass (32 original helper, 42 original phase, 29 candidate/incident regressions), including exact pin/path/hash rejection, missing/wrong completion evidence, identity/restart drift, unrelated-container preservation and build/source gate ordering. Actual pinned CRM and booking Git source policy invocations passed locally. Bash syntax passes. SHA manifests are regenerated for each final revision. Historical helper directory remains unchanged. Independent review accepted the enabled code subject to final manifests and green real CI. Actual CI remains pending; local tests do not establish it.

No new-target Docker builds, real Docker smoke, VPS commands, live backups, deployments or provider actions ran here. The only live outcome is the user's reported historical CRM completion.

## Build-to-freeze raw inventory correction — 25 October, 10:55 UTC

Code inspection found that each build preserves raw before/after Docker inventories, including retained historical backup helpers, while phase snapshot_all writes a helper-filtered snapshot plus its untouched raw `.all.private.json` companion. The old first-freeze comparison mixed those representations and would reject a valid retained helper as missing, before service freeze. No live failure or freeze was observed here.

Both CRM and booking initial freeze checks now use a dedicated build-to-freeze comparator against the preserved raw current snapshot. It rejects duplicate raw IDs, applies the existing exact-string helper=true projection symmetrically for ordinary protected services, and additionally preserves **every pre-existing helper** by exact ID and full existing config/mount/network/lifecycle checks. Missing, modified or relabelled baseline helpers fail. No raw evidence is edited or removed.

Booking legitimately follows CRM cutover, so its existing explicit CRM app/worker exception is retained. CRM freeze rejects every added helper ID. Booking admits only the TWO exact new helper names/IDs resolved from the completed CRM snapshot-stage, verified restore marker, helper-names and preserved raw final snapshot; backup and restore images must match the old CRM baseline and completed new CRM release respectively. Their full configuration/mount/network/lifecycle records must still match that completed snapshot. Those exact helper=true records must also be exited successfully, non-running/non-restarting/non-paused/non-dead/non-OOM, network-none, read-only, nonprivileged, cap-drop ALL, no-new-privileges and user 1000:1000 qualify. A helper cannot borrow the CRM service exception to evade those guards. Added ordinary containers fail. Subsequent phase-local filtered comparisons remain unchanged.

Eleven regression tests reproduce the original mismatch and cover old-helper disappearance/config/lifecycle/label drift, added nonhelpers, label types, duplicate raw IDs, stopped isolated new helpers, unsafe active/new helpers, preservation of unrelated services, legitimate booking CRM replacements, completed-peer helper name/image binding, full peer-helper image/mount drift rejection and comparison-before-freeze ordering. This correction requires no rebuild, source pin changes, database changes or old evidence alteration. Real helper CI on the corrected revision remains required before execution.

## Official PostgreSQL initialization socket correction — 25 October, 11:38 UTC

User-provided failed isolated-server logs confirm PostgreSQL 17.11 initialized its temporary server on /tmp while the official entrypoint's internal psql attempted /var/run/postgresql. Upstream docker_process_sql explicitly clears PGHOST, so supplying PGHOST=/tmp alone was insufficient. Booking freeze failed before any app stop; all four live services remained running.

The isolated server now listens on both existing tmpfs Unix socket directories `/tmp,/var/run/postgresql`; TCP remains disabled and network none, non-root, read-only, capability/resource/mount restrictions are unchanged. Readiness additionally requires PID 1 to be postgres, so the temporary initialization server cannot satisfy the final-ready gate. Existing explicit /tmp clients are unchanged.

New GitHub startup CI pulls ONLY the user-supplied official registry digest `docker.io/library/postgres@sha256:d4bb0a8c1b7bb2e29f976d099e7bfb9a5d8858cffe9e46b35cd302cd1f1f8168` and requires the reported local image ID. No tag fallback. A pull or identity mismatch is an explicit diagnostic blocker, not permission to substitute an image. The smoke extracts and runs the actual production startup command against empty owned scratch data, waits for the final postgres process, verifies SELECT 1 on both sockets, empty TCP listeners and restart-free state. Cleanup stops/removes only its exact ownership-verified CI container. After clean shutdown, CI additionally exercises the retained-helper validator using the actual Docker inspect/image metadata, changing only fixture name and old single-socket command and locally redirecting the test stage identity. State, security, mounts, environment and user representation remain actual Docker output. This is shape compatibility evidence, NOT reproduction of the old failure. Real CI has not yet run for this revision.

### One exact retained failed attempt; no generic failed-helper exemption

Retry requires explicit `FAILED_BOOKING_STAGE=/root/booking-build-0661540-wvdGUN/final-backup-sQr9dj`. The helper must match the immutable ID saved in that exact stage, exact name/image, old single-socket command, full original image environment/entrypoint, non-root user, sole expected scratch data bind, exact tmpfs configuration, no network, read-only/nonprivileged/cap-drop/no-new-privileges/resource/restart restrictions, and stopped/non-OOM state. Docker versions may list tmpfs in Mounts or only HostConfig.Tmpfs; the latter exact map is mandatory and no unexpected bind/destination is admitted.

The failed stage must have no app-stop, dump, audit, resume, successful-restore or cutover evidence. Its protected pre-failure inventory must still match current ordinary services. The full failed-helper record is captured privately in the NEW stage, not written over old evidence, and sealed into the new backup hash manifest. Every subsequent snapshot rechecks that same record, including final backup and both before/after booking app replacement. Existing two completed-CRM-helper admission remains exact; no arbitrary new failed helper is accepted. No cleanup, live restore, credential change, rebuild or old evidence overwrite is performed.
