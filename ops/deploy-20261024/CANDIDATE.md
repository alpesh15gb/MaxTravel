# Candidate only — booking repin; not published or approved to execute

Prepared separately from the currently published helper set. Complete feature-CI/root acceptance is pending; root reports Docker/contracts/native jobs green while integration/browser/WebKit checks remain pending. Root must accept final CI and promote the application source before publishing this helper pin. No current files or phase files are modified.

## Only executable changes

In `verify.py`, only `PINS["booking"]["commit"]` changes from `a0360fb0e8b533452bec5b3d7c3865e46d608f4e` to `40b4988136c9708ca29a7f9340af52c53da37cc1`, and `PINS["booking"]["tree"]` changes from `e1be83336ae1001ab02e2f5747549d2fd356ea51` to `197826e00a7b1b092035c3352912de86a3a6d081`. All other helper/script/test bytes are copied unchanged. This note records the updated booking target identity; internal historical review notes are intentionally not part of this Git export.

CRM stays `c27b8e352a9bdaf55f94df9fb3da1376f0f402d6`. Existing `/root/crm-build-c27b8e3-p3drk2` is already verified, image `sha256:b10e495f4f8fbaca93153552e6484800670c91fa7e778a759674829b28cc3e0a`. **Do not rebuild or rerun CRM revalidation.** Only the booking build is intended after root acceptance/promotion; no deployment/cutover instruction is added.

## Pinned GitHub comparison

Candidate is one commit ahead of previous booking target, parent exactly `a0360fb0e8b533452bec5b3d7c3865e46d608f4e`. GitHub Git commit metadata confirms the target tree above. Seven changed paths are workflow/tests/test fixtures/docs only. There is no production source, Dockerfile, package manifest, package lock, Compose, schema/migration, or operational script change from the previous tested target.

Relative to historical deployed `fe14634d50568a2fb905e90ed22040557347f162`, candidate is 13 commits ahead, zero behind, with deployed source as merge base. The only guarded operational changes remain the previously reviewed `booking-platform/scripts/crm-worker.mts` and `booking-platform/scripts/notification-worker.mts`; no additional operational-source allowance is needed. Full comparison JSON is retained locally for independent review, not published in this user-facing Git export.

All Mounts canonicalization, exact retained-helper eligibility, complete effective-env, lifecycle checks, image/source/tree and final-marker safeguards are unchanged. Phase compatibility decision is deferred to root; phase files were not edited.

## Local verification

32 offline tests pass; Bash syntax and Python compilation pass. All non-verify.py copied files remain byte-identical; reversing the two pin substitutions makes verify.py byte-identical too. No Docker build, VPS call, remote publish, service action, or provider call was performed here. Actual Docker CI remains an external gate; offline tests do not establish that result.

## Ops-only helper CI proposal

Publish `.github/workflows/deploy-helpers.yml` at the **repository root** of `alpesh15gb/MaxTravel`, and publish the unchanged copied `test_verify.py`/`test_revalidate.py` with helpers under `ops/deploy-20261024/`. The workflow triggers only pushes to branch `ops/deploy-20261024` touching that helper directory or the workflow itself. It has `contents: read`, uses an immutable verified checkout-v6 commit with `persist-credentials: false`, and runs only Bash syntax plus the 32 offline Python tests on a GitHub-hosted runner. No deployment scripts execute; no Docker/VPS/provider access, secrets or credential changes are requested. CRM main is untouched. This produces a visible CI check; branch-protection settings are not changed by this proposal.

GitHub's [workflow syntax documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) specifies combined branch/path filters. Checkout pin `d23441a48e516b6c34aea4fa41551a30e30af803` was verified against the official `actions/checkout` v6 Git reference. The workflow is published separately at repository-root `.github/workflows/deploy-helpers.yml`; the helper-directory `SHA256SUMS` covers only the files delivered beside it.
