/** UI guidance only. Booking-platform permissions, current state and provider checks remain authoritative. */
export type ActionTarget = { id: string; status: string; accepted_at?: string | null; offer_expires_at?: string | null; amount_minor?: string };
export function readablePlatformState(state: string) {
  return state.toLowerCase().replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
}
export function targetBlockReason(action: string, row: ActionTarget, now = Date.now()): string | null {
  if (['CANCELLATION_REVIEW', 'CANCELLATION_OFFER'].includes(action) && !['REQUESTED', 'UNDER_REVIEW', 'AWAITING_ACCEPTANCE'].includes(row.status)) return 'This request has progressed beyond review.';
  if (action === 'CANCELLATION_EXECUTE') {
    if (row.status === 'SUPPLIER_PENDING') return null; // Existing runner checks status without resubmitting.
    if (row.status !== 'AWAITING_ACCEPTANCE') return 'Cancellation is not ready for submission.';
    if (!row.accepted_at) return 'Customer acceptance is still required.';
    if (!row.offer_expires_at || !Number.isFinite(Date.parse(row.offer_expires_at)) || Date.parse(row.offer_expires_at) <= now) return 'A current customer-accepted offer is required. Review the terms again.';
  }
  if (action === 'REFUND_REQUEST' && row.status !== 'CAPTURED') return 'Only captured payments can be considered for a refund.';
  if (action === 'REFUND_APPROVE' && row.status !== 'REQUESTED') return 'This refund is not awaiting approval.';
  if (action === 'REFUND_EXECUTE' && !['APPROVED', 'PROCESSING'].includes(row.status)) return 'Refund approval is required before execution.';
  return null;
}
export function platformActionGuidance(action: string): string {
  if (action === 'STATUS') return 'Read current platform records before choosing a request. CRM snapshots may update separately.';
  if (action === 'CANCELLATION_REQUEST') return 'Starts a review only. Travel remains active until the supplier confirms cancellation; no refund is sent.';
  if (action === 'CANCELLATION_CHARGES') return 'Check the applicable supplier policy before offering terms. Supplier responses are not a guarantee of cancellation or refund eligibility.';
  if (action === 'CANCELLATION_OFFER') return 'Review the customer total and earlier confirmed offers. New terms replace prior acceptance and require fresh customer acceptance within 10 minutes.';
  if (action === 'CANCELLATION_EXECUTE') return 'Requires a current accepted offer. A supplier-pending request is checked without repeating submission. Refunds are a separate workflow.';
  if (action === 'REFUND_REQUEST') return 'Select a captured payment. The platform validates cancellation eligibility, remaining refundable value and existing refund reservations. This does not send money.';
  if (action === 'REFUND_APPROVE') return 'Approval is separate from execution. The platform enforces current limits and independent approval where required.';
  if (action === 'REFUND_EXECUTE') return 'Only approved refunds can be sent. Processing refunds reconcile the original refund using its persisted reference. Do not create a replacement if the outcome is uncertain.';
  if (action === 'RECONCILE') return 'Recheck an uncertain booking outcome before creating another operation.';
  return 'The platform verifies your mapped permission and current booking state before accepting this action.';
}
export function platformTargetLabel(row: ActionTarget, index: number) {
  const amount = row.amount_minor && /^\d+$/.test(row.amount_minor) && Number.isSafeInteger(Number(row.amount_minor)) ? ` · ₹${(Number(row.amount_minor) / 100).toFixed(2)}` : '';
  return `${index + 1}. ${readablePlatformState(row.status)}${amount} · Ref ${row.id}`;
}

export function platformCommandConfirmed(httpOk: boolean, result: { uncertain?: unknown; commandRecorded?: unknown }) {
  return httpOk && result.uncertain !== true && result.commandRecorded === true;
}
