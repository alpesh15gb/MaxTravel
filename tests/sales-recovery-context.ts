import assert from "node:assert/strict";
import { salesBaseRevision, salesRecoveryContext } from "../src/lib/sales-recovery-context";

const actor = { sessionId: "opaque-fixture-session", id: "fixture-staff", branchId: "fixture-branch", accessMode: "BRANCH" as const,
  permissions: ["customer:view", "payment:view"] as const };
const user = { ...actor, permissions: [...actor.permissions] };
const context = salesRecoveryContext(user);
assert.match(context, /^[a-f0-9]{64}$/);
assert.equal(context, salesRecoveryContext({ ...user, permissions: [...user.permissions].reverse() }));
for (const change of [{ sessionId: "another-session" }, { id: "another-staff" }, { branchId: "another-branch" }, { accessMode: "ALL" as const }, { permissions: ["customer:view"] as typeof user.permissions }]) {
  assert.notEqual(context, salesRecoveryContext({ ...user, ...change }));
}
assert.throws(() => salesRecoveryContext({ ...user, sessionId: undefined }));
assert(!context.includes(user.id));
const lead = { id: "lead", customerId: "customer", branchId: "branch", ownerId: "staff", stage: "NEW", updatedAt: new Date("2026-10-22T10:00:00Z") };
const older = { id: "old", version: 1, state: "PUBLISHED", bookingId: null, acceptedAt: null, expiresAt: new Date("2099-01-01") };
const newer = { ...older, id: "new", version: 2, state: "DRAFT" };
const revision = salesBaseRevision(lead, [older, newer]);
assert.equal(revision, salesBaseRevision(lead, [newer, older]), "Database row order must not affect the revision");
for (const change of [{ customerId: "changed" }, { branchId: "changed" }, { ownerId: "changed" }, { stage: "LOST" }, { updatedAt: new Date("2026-10-22T10:00:01Z") }]) {
  assert.notEqual(revision, salesBaseRevision({ ...lead, ...change }, [older, newer]));
}
for (const change of [{ id: "changed" }, { version: 3 }, { state: "ACCEPTED" }, { bookingId: "linked" }, { acceptedAt: new Date("2026-10-22") }, { expiresAt: new Date("2098-01-01") }]) {
  assert.notEqual(revision, salesBaseRevision(lead, [{ ...older, ...change }, newer]), "An older quote change must invalidate the base even when latest draft is unchanged");
}
assert.notEqual(revision, salesBaseRevision(lead, [newer]));
console.log("Sales recovery fingerprints passed: session/scope isolation and every historical quote revision input.");
