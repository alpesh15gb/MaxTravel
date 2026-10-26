# Deployment-helper update for 26 October 2026

Local preparation and offline review only, based on helper commit `3702373dbd918501df7f7a59ecfdd2b098ad895f`. No VPS connection, application execution, production operation or publication is part of this work. This review supersedes the prior review's target and baseline identities; its operational protections remain.

## Source and deployed baseline

| App | New commit | New tree | Deployed baseline |
| --- | --- | --- | --- |
| CRM | f59810075a6935c28ea958a3b53e168284be687d | 90635d1db07dda36527999d737a637bddd11f4d1 | 0d0c72d24c320d56710f3c640a151b34697dc4e6 |
| Booking | cc57b4bac4fe3ef0abbede150aab38d91448951a | 7f2e2ee47a19955b9c870c73e4ed6851d4e3a0eb | 06615409f45c5ac9ef3b01b2538b26838ac0c69f |

Independent Git comparisons from those deployed baselines found no schema/migration, Dockerfile, Compose, lockfile, package.json, entrypoint or operational script changes. Changes are application code, tests, documentation and CI workflows. The existing strict source policy, CRM helper-byte hashes and exact booking operational allowlist remain intact. Both target trees were verified against Git objects locally.

CRM baseline image is `sha256:0cea593a8f8a2574be6e4f79d531b4e45079944f098ed110b8f1cf5541e812fd`; pointer/release is `/root/crm-build-0d0c72d-fDcYXw/crm-release-0d0c72d-r02ds6`. Booking baseline image is `sha256:31874edd42ae52985b99a29739d9b57d2f6cc8f5c4e6ac79f0796c5b7e7344d1`; pointer/release is `/root/booking-build-0661540-wvdGUN/booking-release-0661540-nTBepa`.

The user's 02:31 UTC preflight pins CRM app `d5e5f203357e113401ecadf7dcbc5d09e953925f61243b202e3c2f294af33007`, worker `4c7264ef92004967821c271a03693183b9826b816fc7a8ad62f4856adc664a43`, booking app `da49b4c8abd571a4238017c3ffc90babefd9d5bec6c1f6c31723c35a73052b06`, PostgreSQL `df9fd0fdf66d26b56736a7d2f411e432d172ab9814a8fdb08fac40d81d04e465`, and PostgreSQL image `sha256:d4bb0a8c1b7bb2e29f976d099e7bfb9a5d8858cffe9e46b35cd302cd1f1f8168`. All four must remain running, unpaused, non-restarting/non-dead/non-OOM, restart-free and `unless-stopped`; existing app/PostgreSQL health gates remain. Reported capacity was 123 GB free and 11 GiB available RAM; the existing fresh capacity checks still run before builds.

## Frozen configuration and completion evidence

CRM keeps the exact four files under `/root/crm-build-2ecf810-ERht2Z/crm-release-2ecf810-IMh1AX` in order: compose.vps.yaml, compose.evolution.yaml, image-override.yaml, candidate-image.yaml. It then appends `/root/crm-build-c27b8e3-p3drk2/crm-release-c27b8e3-2S4iPz/candidate-image.yaml`, then the deployed 0d0c72d release's candidate-image.yaml. Its original crm.env remains the interpolation source.

Booking keeps compose.production.yaml, image-override.yaml and candidate-image.yaml under `/root/booking-build-fe14634-qbbdjR/booking-release-fe14634-ZJBWG3`, then appends the deployed 0661540 release's candidate-image.yaml. Its original compose.env and referenced runtime.env remain frozen. Future cutover appends one new overlay to each complete inherited chain; no old files are replaced, copied into a new operative stack or made optional.

Both deployed-source.txt and deployed-image.txt must match each release. CRM additionally requires app-verified.txt. Both final-containers.private.json files must contain precisely their expected service IDs and match the latest booking all-after.private.json. CRM final rows must also match its own all-final.private.json. Only CRM rows are compared from that older snapshot, since its booking identity predates the booking cutover. No nonexistent booking all-final fallback is accepted.

Booking's raw all-after.private.json.all.private.json must agree with its filtered snapshot and preserve every current container's identity, configuration, mounts, networks and lifecycle. The historical failed helper is already part of this baseline, so it is preserved as pre-existing inventory without a new failed-helper admission. Do not set FAILED_BOOKING_STAGE for the next release. Existing protected_build, completed_peer_helpers, exact failed-attempt validation, tmpfs compatibility, environment/security/backup guards and containment code are unchanged.

## Validation and remaining gates

New regressions cover the latest booking snapshot with an older booking ID in CRM history, independent completion markers, exact target/tree/baseline IDs, full inherited Compose chains, rejected old IDs and configuration/environment/security/lifecycle drift, and exact preservation of pre-existing raw helpers. All existing offline suites were attempted locally. Windows-specific failures are recorded in the delivered validation report; a green Linux run and actual Docker smokes are still required. No safety test is skipped or weakened to accommodate Windows.

After independent acceptance and green helper CI, the existing sequence remains: sequential builds with all frozen-source/runtime/rollback checks; fresh writer-frozen CRM backup and isolated restore; CRM app-only replacement; existing worker verification and pointer advancement; fresh booking backup/isolated restore; booking app-only replacement. No migration, new worker, provider transaction, credential change, cleanup or blind retry/restore is included. Do not execute commands from the old target revision.
