import assert from "node:assert/strict";
import { createCustomerCreateMemory } from "../src/lib/customer-create-memory";

const memory = createCustomerCreateMemory("staff-A-session-and-scope");
assert(memory.begin("request-1"));
assert.equal(memory.getSnapshot()?.phase, "submitting");
assert.equal(memory.begin("request-2"), false, "Repeated/other-activation submissions cannot overlap");
assert.equal(memory.clear("request-1"), false, "Pending writes cannot be dismissed/unlocked");
// No component lifecycle is involved: completion while its owner is hidden still updates the barrier.
memory.settle("request-1", { kind: "created", id: "customer-1" });
assert.deepEqual(memory.getSnapshot(), { context: memory.context, nonce: "request-1", phase: "created", customerId: "customer-1" });
assert.equal(memory.begin("request-2"), false, "Acknowledged writes require read verification before another creation");
assert(memory.clear("request-1"));
assert(memory.begin("request-2"));
memory.settle("request-1", { kind: "uncertain" });
assert.equal(memory.getSnapshot()?.phase, "submitting", "Late older response cannot corrupt current request");
memory.settle("request-2", { kind: "uncertain" });
assert.equal(memory.clear("request-2"), false, "Unknown outcome is not silently made retryable");
assert.equal(memory.begin("request-3"), false);
memory.markReviewed("request-2");
assert(memory.clear("request-2"), "Explicit review completion is allowed only after a current scoped read");
assert(memory.begin("request-3")); memory.settle("request-3", { kind: "rejected" }); assert.equal(memory.getSnapshot(), null);
assert(memory.begin("request-4")); memory.settle("request-4", { kind: "access-changed" }); assert.equal(memory.getSnapshot(), null);
assert(memory.begin("request-5")); memory.reset(); memory.settle("request-5", { kind: "created", id: "stale-customer" });
assert.equal(memory.getSnapshot(), null, "Session-boundary reset cannot be undone by late completion");
const other = createCustomerCreateMemory("staff-B-session-and-scope"); assert.equal(other.getSnapshot(), null);
assert(!createCustomerCreateMemory("").begin("invalid-context"));
console.log("Customer creation memory passed: Activity-independent completion, pending/unknown barriers, scope isolation, no fields retained.");
