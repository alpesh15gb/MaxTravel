import assert from "node:assert/strict";
import { createSalesActionMemory, isSalesActionAcknowledgement } from "../src/lib/sales-action-memory";

const memory = createSalesActionMemory("staff-A-session-scope");
assert(memory.begin("create-1", "create"));
assert.equal(memory.getSnapshot()?.phase, "submitting");
assert.equal(memory.begin("create-2", "create"), false);
assert.equal(memory.clearAfterReview("create-1"), false, "Pending outcome cannot be dismissed or retried");
// No component lifecycle is required: a hidden/replaced form still settles this provider-owned marker.
memory.settle("create-1", "uncertain");
assert.deepEqual(memory.getSnapshot(), { nonce: "create-1", context: memory.context, kind: "create", phase: "uncertain" });
assert.equal(memory.begin("create-2", "create"), false, "A remounted workspace cannot repeat an unknown write");
assert.equal(memory.clearAfterReview("wrong-nonce"), false);
assert.equal(memory.clearAfterReview("create-1"), false, "Unknown outcomes require an explicit review token");
assert(memory.clearAfterReview("create-1", memory.getReviewEpoch()), "Only explicit successful scoped reconciliation calls this transition");
assert(memory.begin("publish-2", "publish", "lead-2"));
memory.settle("publish-2", "acknowledged");
assert.equal(memory.begin("publish-3", "publish"), false, "Hidden acknowledged result still requires review");
assert.deepEqual(Object.keys(memory.getSnapshot()!).sort(), ["context", "kind", "leadId", "nonce", "phase"], "No proposal path, token, request body or PII is retained");
memory.settle("publish-2", "uncertain");
assert.equal(memory.getSnapshot()?.phase, "acknowledged", "Failed follow-up read cannot erase an acknowledged write");
assert(memory.clearAfterReview("publish-2"));
assert(memory.begin("stage-3", "stage", "lead-3"));
memory.settle("publish-2", "uncertain");
assert.equal(memory.getSnapshot()?.phase, "submitting", "Late older completion cannot corrupt a new request");
memory.settle("stage-3", "rejected"); assert.equal(memory.getSnapshot(), null);
assert(memory.begin("convert-4", "convert", "lead-4")); memory.reset(); memory.settle("convert-4", "acknowledged");
assert.equal(memory.getSnapshot(), null, "Session boundary is irreversible for a late response");
assert.equal(createSalesActionMemory("staff-B").getSnapshot(), null);
assert.equal(memory.begin("unknown", "quote"), false, "Quotation recovery owns quotation metadata separately");
assert.equal(createSalesActionMemory("").begin("invalid", "create"), false);
console.log("Sales action memory passed: pending/unknown/acknowledged barriers, nonce isolation, explicit reconciliation, no fields or tokens.");

for (const kind of ["create", "quote", "convert", "publish", "stage", "withdraw"]) {
  for (const malformed of [null, {}, { ok: false }, { ok: "true" }]) assert.equal(isSalesActionAcknowledgement(kind, malformed), false);
}
assert.equal(isSalesActionAcknowledgement("create", { ok: true }), false);
assert.equal(isSalesActionAcknowledgement("create", { ok: true, id: "" }), false);
assert.equal(isSalesActionAcknowledgement("create", { ok: true, id: "lead-1" }), true);
assert.equal(isSalesActionAcknowledgement("quote", { ok: true, quoteId: "quote-1" }), true);
assert.equal(isSalesActionAcknowledgement("convert", { ok: true }), false);
assert.equal(isSalesActionAcknowledgement("convert", { ok: true, bookingId: "booking-1" }), true);
assert.equal(isSalesActionAcknowledgement("publish", { ok: true, sharePath: "/proposal#bad" }), false);
assert.equal(isSalesActionAcknowledgement("publish", { ok: true, sharePath: `/proposal#${"a".repeat(64)}` }), true);
assert.equal(isSalesActionAcknowledgement("stage", { ok: true }), true);
assert.equal(isSalesActionAcknowledgement("withdraw", { ok: true }), true);
console.log("Sales acknowledgement validation passed: malformed 2xx remains unknown, required per-action identifiers verified.");

const cached = createSalesActionMemory("same-document-session");
assert(cached.begin("cached-create", "create")); cached.pageHide(true); cached.pageShow(true);
assert.equal(cached.getSnapshot()?.phase, "submitting");
cached.settle("cached-create", "acknowledged", "created-lead");
assert.equal(cached.getSnapshot()?.requiresReview, true);
assert.equal(cached.clearAfterReview("cached-create"), false, "A resumed callback cannot automatically clear a BFCache barrier");
assert.equal(cached.begin("duplicate", "create"), false);
assert(cached.clearAfterReview("cached-create", cached.getReviewEpoch()), "Explicit fresh scoped reconciliation may clear a restored outcome");
assert(cached.begin("unknown-cache", "withdraw", "lead")); cached.settle("unknown-cache", "uncertain"); cached.pageShow(true);
assert.equal(cached.clearAfterReview("unknown-cache"), false);
cached.pageHide(false); assert.equal(cached.getSnapshot(), null, "Real document exit ends memory-only recovery");
assert(cached.begin("session-reset", "stage")); cached.pageHide(true); cached.reset(); cached.settle("session-reset", "acknowledged");
assert.equal(cached.getSnapshot(), null, "Session/scope reset clears even cached outcome metadata");
console.log("Sales action page lifecycle handlers passed: persisted metadata stays locked, no auto-clear, real exit/session reset clears.");

assert(cached.begin("old-review", "create")); cached.settle("old-review", "uncertain");
const oldReviewEpoch = cached.getReviewEpoch(); cached.pageHide(true); cached.pageShow(true);
assert.equal(cached.clearAfterReview("old-review", oldReviewEpoch), false, "A GET begun before BFCache cannot clear the post-show review barrier");
assert(cached.clearAfterReview("old-review", cached.getReviewEpoch()), "A new post-show explicit scoped read can reconcile");
console.log("Sales action review epochs passed: stale pre-cache reads cannot clear new review requirements.");
