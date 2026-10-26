# Reviewed-baseline new-main rollout helpers

**Local helper update for review only; not published or executed.** Read [the current review](ROLLOUT-REVIEW-20261026.md). Linux CI and Docker smoke results for this revision remain outstanding.

Targets: CRM `f59810075a6935c28ea958a3b53e168284be687d`; booking `cc57b4bac4fe3ef0abbede150aab38d91448951a`.

The user supplied fresh runtime identities at 2026-10-26 02:31 UTC. Before either new build, helpers independently require both releases' exact completion markers, current pointers, final service evidence and latest booking all-after inventory matching fresh private state. CRM retains its original four Compose files, c27 overlay and deployed 0d0c72d overlay (six files); booking retains its original three files and deployed 0661540 overlay (four files). Original interpolation/runtime env paths remain separate from pointers. The full raw latest booking inventory also preserves all pre-existing helpers, including the historical failed attempt; do not carry FAILED_BOOKING_STAGE into a new release command.

This package does not replace incident recovery. Original `../deploy-20261024` remains byte-identical to `3c6512c6c87e630d402c12e4f234aa4c8b9b612c`. Candidate copies of incident recovery/revalidation refuse execution.

After accepted publication: sequential verified new builds precede all downtime. Existing phase checks require exact new image/build evidence, fresh writer-frozen backup, isolated restore and audits before scoped cutover. CRM app precedes existing worker, then booking app; PostgreSQL and other apps are preserved. No migrations, new workers, credential changes, provider test transactions or cleanup are included. Never skip a failed gate or blindly retry an attempted phase.

Offline checks:

```sh
python3 -m unittest test_verify test_revalidate test_candidate test_failed_booking_helper
(cd cutover && python3 -m unittest test_phase_offline test_booking_offline)
sha256sum -c SHA256SUMS
(cd cutover && sha256sum -c draft.sha256)
```

Offline tests do not establish real Docker CI, new image builds, backup recovery or deployment success.
