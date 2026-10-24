import assert from 'node:assert/strict';
import { readablePlatformState, platformCommandConfirmed, targetBlockReason, platformTargetLabel, platformActionGuidance } from '../src/lib/platform-action-guidance';
const row = (status: string) => ({ id: 'synthetic-id', status });
for (const status of ['REQUESTED', 'UNDER_REVIEW', 'AWAITING_ACCEPTANCE']) assert.equal(targetBlockReason('CANCELLATION_OFFER', row(status)), null);
for (const status of ['CONFIRMED', 'REJECTED', 'SUPPLIER_PENDING', 'UNKNOWN']) assert(targetBlockReason('CANCELLATION_OFFER', row(status)));
assert(targetBlockReason('CANCELLATION_EXECUTE', row('AWAITING_ACCEPTANCE')));
assert(targetBlockReason('CANCELLATION_EXECUTE', { ...row('AWAITING_ACCEPTANCE'), accepted_at: 'yes', offer_expires_at: 'invalid' }));
assert(targetBlockReason('CANCELLATION_EXECUTE', { ...row('AWAITING_ACCEPTANCE'), accepted_at: 'yes', offer_expires_at: '2020-01-01' }));
assert.equal(targetBlockReason('CANCELLATION_EXECUTE', { ...row('AWAITING_ACCEPTANCE'), accepted_at: 'yes', offer_expires_at: '2030-01-01' }, Date.parse('2026-01-01')), null);
assert.equal(targetBlockReason('CANCELLATION_EXECUTE', row('SUPPLIER_PENDING')), null);
for (const [action, allowed] of [['REFUND_REQUEST', ['CAPTURED']], ['REFUND_APPROVE', ['REQUESTED']], ['REFUND_EXECUTE', ['APPROVED','PROCESSING']]] as const) {
 for (const status of ['CAPTURED','REQUESTED','APPROVED','PROCESSING','COMPLETED','FAILED','UNKNOWN']) assert.equal(targetBlockReason(action,row(status)) === null, (allowed as readonly string[]).includes(status));
}
assert.match(platformTargetLabel({ ...row('CAPTURED'), amount_minor: '12345' }, 0), /₹123.45/);
assert.match(platformActionGuidance('CANCELLATION_EXECUTE'), /separate workflow/);
console.log('PASS platform action state / consent / unknown decision matrix');

assert.equal(platformCommandConfirmed(true, { commandRecorded: true }), true);
for (const result of [{}, { uncertain: true }, { uncertain: true, commandRecorded: true }, { commandRecorded: false }]) assert.equal(platformCommandConfirmed(true, result), false);
assert.equal(platformCommandConfirmed(false, { commandRecorded: true }), false);

// Display must not claim acceptance is pending after it has been recorded.
const acceptedOffer = { ...row('AWAITING_ACCEPTANCE'), accepted_at: '2026-01-01T00:00:00Z', offer_expires_at: '2030-01-01T00:00:00Z' };
assert.equal(readablePlatformState(acceptedOffer.status), 'Offer available');
assert.match(platformTargetLabel(acceptedOffer, 0), /Offer available/);
assert.doesNotMatch(platformTargetLabel(acceptedOffer, 0), /Awaiting acceptance/);
assert.equal(targetBlockReason('CANCELLATION_EXECUTE', acceptedOffer, Date.parse('2026-01-02')), null);
assert(targetBlockReason('CANCELLATION_EXECUTE', { ...acceptedOffer, accepted_at: null }, Date.parse('2026-01-02')));
// QUOTED is not an executable state in this provider contract, even with current acceptance.
const unsupportedQuoted = { ...acceptedOffer, status: 'QUOTED' };
assert.match(platformTargetLabel(unsupportedQuoted, 0), /Quoted/);
assert(targetBlockReason('CANCELLATION_EXECUTE', unsupportedQuoted, Date.parse('2026-01-02')));
