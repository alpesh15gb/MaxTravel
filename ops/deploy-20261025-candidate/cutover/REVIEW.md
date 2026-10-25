# New-main scoped cutover candidate

Read [the current complete review](../ROLLOUT-REVIEW-20261025.md).

User-reported completed c27 recovery/worker finish establishes the prospective starting point. Build preparation must privately prove it again against exact IDs, images, completion artifacts, pointer and full protected inventory/config/lifecycle. Phase-specific successful-new-build, frozen configuration, fresh backup, isolated restore, schema/data/media audit and health checks remain mandatory. No phase is executable merely because the baseline gate passes.

Release prefixes follow the exact target. Original env/config directories remain independent of current pointers; every historically confirmed Compose overlay is required in original order. Complete environment/security/mount/protected-container checks and failure containment remain. Incident recovery/revalidation copies explicitly refuse; use only their immutable historical package if that procedure is needed.

No new cutover, backup or Docker build has run from this package. Independent acceptance and actual CI must precede publication for execution. No broad runtime allowances, stale backup reuse after writes, blind restore or blind retries are permitted.
