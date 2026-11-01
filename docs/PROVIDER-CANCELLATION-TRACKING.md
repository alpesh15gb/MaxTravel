# Booking cancellation tracking — 2026-11-01

Signed booking-platform cancellation updates now record supplier reconciliation progress in the existing CRM case history and customer activity. Open Online bookings, follow the permanent case ID, and review History for staff follow-up and the next supplier check in IST. The original customer and case remain linked.

The booking Operations workspace provides the actionable follow-up filter, latest supplier progress, last/next checks and exports. A pending cancellation does not mark the booking cancelled or confirm a refund. Supplier cancellation completion and customer refund settlement remain separate workflows.

The receiver validates the tracking envelope after authenticating the signed event. Replay/stale-revision protections preserve one receipt/invoice per transaction. Cancellation updates do not queue another booking-confirmation message or PDF. Existing booking senders without tracking metadata remain compatible. Case history keeps its existing staff/branch permissions and does not expose financial amounts through this summary.

No additional CRM schema migration is introduced by this change. The corresponding booking version needs additive migration `019-cancellation-reconciliation` before its new application/workers start. Existing unapplied CRM migrations still follow the normal deployment process.

Verification passed: clean production build, lint/type checking, the full main CRM suite, isolated agency journeys (ticketing/visa/finance/audit/reporting), signed receiver regressions and the real two-app local HTTP/worker proof. The cross-app proof includes permanent case IDs, receipt/invoice deduplication, desktop/mobile views, administrator assignment, staff submission, separate administrator review and staff finance-access denial. Provider payment/supplier responses were synthetic; live gateway acceptance remains pending. PayGlocal checkout remains disabled for merchant confirmation.
