# Candidate identity and release gates

See [ROLLOUT-REVIEW-20261026.md](ROLLOUT-REVIEW-20261026.md) for exact pins, source delta, confirmed baseline and scoped sequence. The 25 October review is historical.

This local revision updates the exact baseline and target pins, with fresh private proof required before each build. Review, Linux helper CI and Docker smokes remain outstanding. No new image, backup, deployment or publication has been performed. All build/backup/restore/health gates remain mandatory. Historical incident recovery remains exclusively in unchanged sibling commit 3c6512.
