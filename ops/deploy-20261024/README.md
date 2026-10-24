# MaxTravel — booking build only

**CRM is already verified. Reuse it; do not build or revalidate CRM again.**

- CRM stage: `/root/crm-build-c27b8e3-p3drk2`
- CRM source: `c27b8e352a9bdaf55f94df9fb3da1376f0f402d6`
- Verified CRM image: `sha256:b10e495f4f8fbaca93153552e6484800670c91fa7e778a759674829b28cc3e0a`

These are prepared candidate images, **not a completed production cutover**. Retain the verified CRM stage, current production releases, frozen environment files, and private rollback evidence.

## Next step — booking only, after coordinator clearance

Booking target: `40b4988136c9708ca29a7f9340af52c53da37cc1`  
Repository tree: `197826e00a7b1b092035c3352912de86a3a6d081`

The coordinator reports the actual isolated Docker gate, contract and native checks green. Final integration/browser/WebKit results and source promotion remain pending. **Do not run the booking build until the coordinator confirms the accepted booking commit is on main and the reviewed helper revision is published.**

Use the exact coordinator-supplied Git helper commit. Keep the helper files together and verify its manifest with `sha256sum -c SHA256SUMS`. After explicit clearance, from that reviewed `ops/deploy-20261024` directory on Apex, the only next build command is:

```bash
APPROVED_BUILD_ONLY='reviewed fresh preflight; build only' bash ./preserve-build.sh booking
```

**Do not run `preserve-build.sh crm` or `revalidate-built-crm.sh`.** Those historical helper files remain for audit/compatibility, not as the current next step.

The booking script verifies that remote main still equals the pinned target, preserves frozen configuration and rollback-image evidence, then builds in isolation and performs a disposable network-none, non-root file-read/dependency-resolution check. It does not start application/worker entrypoints or mount production data in that check. It writes `build-verified.json` only after all source, configuration, image and complete container-preservation validations pass.

The standard existing builder has no CPU/memory caps; it checks at least 9 GiB available RAM and 20 GiB staging/Docker free space. Latency can temporarily increase. Never overlap builds. On STOP/error/timeout, retain evidence and report the concise message; do not retry blindly, remove containers, weaken guards, or paste private logs/env files into chat.

## Safety and review

- Only booking commit/tree pins changed. Production code/Dockerfile/package/lockfiles did not change in the isolated-build fix.
- Mount comparisons ignore top-level listing order only; complete mount contents and duplicate counts remain checked.
- The precisely identified stopped historical upgrade-check remains preserved. Other unexpected services/containers still fail closed.
- Full effective environment, frozen-file hashes, source/tree/image pins, non-root readability and container lifecycle checks remain active.
- Both Python regression test files are unchanged; 32 offline checks pass. The proposed ops-branch-only workflow runs those tests and Bash syntax with read-only repository permission; it performs no Docker/VPS/provider action. This does not substitute for the separate application Docker gate or the user-run VPS build.

After booking builds successfully, return its concise summary. Final consistent database/upload backups, isolated restore verification and cutover remain separately gated. Later cutover must bring up the CRM receiver before booking. Do not enable previously disabled provider-facing workers or change credentials as part of this build.
