# Candidate identity and release gates

See [ROLLOUT-REVIEW-20261025.md](ROLLOUT-REVIEW-20261025.md) for exact pins, source delta, confirmed baseline and scoped sequence.

The previous unconditional local hold is replaced by an exact reviewed baseline with fresh private proof required before each build. Independent code review accepted; publication and actual helper CI remain outstanding. This does not claim that new images exist or authorize bypassing any build/backup/restore/health gate. Historical incident recovery remains exclusively in unchanged sibling commit 3c6512.
