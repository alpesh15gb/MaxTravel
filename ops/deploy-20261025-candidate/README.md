# Reviewed-baseline new-main rollout helpers

**Local candidate independently reviewed; awaiting publication and actual CI. Nothing here has built or deployed the new targets.** Read [the current review](ROLLOUT-REVIEW-20261025.md).

Targets: CRM `0d0c72d24c320d56710f3c640a151b34697dc4e6`; booking `06615409f45c5ac9ef3b01b2538b26838ac0c69f`.

User-reported historical c27 app recovery and worker completion supplies the new baseline. Before either new build, helpers independently require exact four service identities, images, current pointers, historical completion markers and full protected final configuration/lifecycle matching fresh private evidence. CRM requires its original four Compose files plus the exact c27 overlay; booking requires its original three files. No optional-file fallback. Original env/config paths remain separate from pointers.

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
