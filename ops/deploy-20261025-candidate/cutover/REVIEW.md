# New-main scoped cutover candidate

Read [the current complete review](../ROLLOUT-REVIEW-20261026.md).

User-reported completed 0d0c72d CRM and 0661540 booking releases establish the starting point. Build preparation must privately prove both completions against exact fresh IDs, images, completion artifacts, pointers and the latest booking protected inventory/config/lifecycle. All pre-existing helpers are preserved from its raw snapshot. Do not pass the old FAILED_BOOKING_STAGE to a new release. Phase-specific successful-new-build, frozen configuration, fresh backup, isolated restore, schema/data/media audit and health checks remain mandatory. No phase is executable merely because the baseline gate passes.

Release prefixes follow the exact target. Original env/config directories remain independent of current pointers; every historically confirmed Compose overlay is required in original order. Complete environment/security/mount/protected-container checks and failure containment remain. Incident recovery/revalidation copies explicitly refuse; use only their immutable historical package if that procedure is needed.

No new cutover, backup or Docker build has run from this package. Independent acceptance and actual CI must precede publication for execution. No broad runtime allowances, stale backup reuse after writes, blind restore or blind retries are permitted.
