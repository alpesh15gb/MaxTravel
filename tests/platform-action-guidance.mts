import assert from 'node:assert/strict';
import { platformCommandConfirmed, targetBlockReason, platformTargetLabel, platformActionGuidance } from '../src/lib/platform-action-guidance';
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
