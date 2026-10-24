import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { acknowledgeEmployeeAttempt, createEmployeeOperationGuard, employeeMatches, employeeOutcome, employeeRetryAllowed, isEmployeeRecord, type EmployeeRecord } from "../src/lib/employee-recovery";
import { employeeReadScope, employeeRecoveryContext, employeeRevision } from "../src/lib/employee-recovery-server";
const context = "a".repeat(64);
const record: EmployeeRecord = { id: "staff-one", employeeCode: "EMP-1", name: "Synthetic One", email: "one@example.test", phone: "9000000000", roleId: "reader", role: "Read-only", branchId: "branch-one", branch: "Fixture", active: true, salary: null, bankAccount: null, hrVisible: false, revision: "b".repeat(64) };
assert(isEmployeeRecord(record));
for (const malformed of [null, {}, { ...record, revision: "" }, { ...record, salary: "123" }, { ...record, salary: 123 }, { ...record, bankAccount: "PRIVATE" }, { ...record, active: "false" }]) assert(!isEmployeeRecord(malformed));
assert.equal(employeeOutcome(200, { ok: true, employeeId: record.id, recoveryContext: context }, context, record.id), "acknowledged");
assert.equal(employeeOutcome(200, { ok: true, employeeId: "another", recoveryContext: context }, context, record.id), "uncertain");
assert.equal(employeeOutcome(200, { ok: true, employeeId: record.id, recoveryContext: "other-actor" }, context), "uncertain");
for (const status of [200, 204, 400, 403, 408, 409, 429, 500, 502, 503]) {
  for (const body of [null, "<html>gateway</html>", {}, { error: "Retry" }, { ok: true }]) assert.equal(employeeOutcome(status, body, context), "uncertain");
}
for (const status of [400, 401, 403, 404, 409]) assert.equal(employeeOutcome(status, { error: "Application rejection", employeeWrite: "rejected" }, context), "rejected");
assert.equal(employeeOutcome(500, { error: "Unknown", employeeWrite: "rejected" }, context), "uncertain");
const attempt = { id: record.id, name: record.name, passwordIncluded: false, desired: { active: true, name: record.name } };
assert(employeeMatches(attempt, record)); assert(!employeeMatches(attempt, { ...record, id: "other" })); assert(!employeeMatches(attempt, null)); assert(!employeeMatches(attempt, { ...record, active: false }));
assert(employeeMatches({ name: record.name, email: record.email, passwordIncluded: true, desired: { email: record.email } }, record), "Profile comparison does not claim a password was verified");
const guard = createEmployeeOperationGuard();
const first = guard.begin()!; assert.notEqual(first, null); assert.equal(guard.begin(), null, "Same-turn double click cannot acquire a second write"); assert(guard.current(first));
guard.invalidate(); assert(!guard.current(first)); const replacement = guard.begin()!; assert.notEqual(first, replacement); assert(!guard.finish(first)); assert(guard.current(replacement), "Late old employee/session response cannot unlock or overwrite replacement operation");
assert(guard.finish(replacement)); assert(!guard.current(replacement)); assert.notEqual(guard.begin(), null);
const user = { id: "actor", sessionId: "session-one", branchId: "branch-one", accessMode: "ALL" as const, role: "OWNER" as const, permissions: ["employee:manage", "employee:view"] as ("employee:manage" | "employee:view")[], mfaEnabled: false };
const original = employeeRecoveryContext(user);
assert.equal(employeeRecoveryContext({ ...user, permissions: [...user.permissions].reverse() }), original);
for (const changed of [{ id: "other" }, { sessionId: "new-session" }, { branchId: "other" }, { accessMode: "BRANCH" as const }, { role: "HR" as const }, { permissions: ["employee:view"] as ("employee:view")[] }, { mfaEnabled: true }]) assert.notEqual(employeeRecoveryContext({ ...user, ...changed }), original);
assert.throws(() => employeeRecoveryContext({ ...user, sessionId: undefined }));
assert.deepEqual(employeeReadScope(user), {}); assert.deepEqual(employeeReadScope({ ...user, accessMode: "BRANCH" }), { branchId: "branch-one" }); assert.deepEqual(employeeReadScope({ ...user, accessMode: "ASSIGNED" }), { id: "actor" });
const revisionSource = { ...record, passwordHash: "synthetic-hash" };
const revision = employeeRevision(revisionSource);
for (const changed of [{ id: "other" }, { name: "Updated" }, { email: "other@example.test" }, { phone: "123" }, { roleId: "hr" }, { branchId: null }, { active: false }, { salary: 100 }, { bankAccount: "PRIVATE" }, { passwordHash: "new-synthetic-hash" }]) assert.notEqual(employeeRevision({ ...revisionSource, ...changed }), revision);
assert.equal(employeeRevision({ ...revisionSource }), revision);
console.log("PASS employee recovery: strict acknowledgements/rejections, malformed/transport uncertainty, synchronous lock, stale generation, actor/session/access namespaces, scoped reads, complete staff revision.");


// Exercise the actual controller functions, not a second hand-written model of their flow.
// Transpilation only: all fetch/React/router inputs are stubs; no browser, network or database.
async function acknowledgedCreateSurvivesReadFailure() {
  const source = readFileSync("src/app/(app)/employees/EmployeesClient.tsx", "utf8");
  const start = source.indexOf("  async function readCurrent("), end = source.indexOf("  function closeForm()", start);
  assert(start > 0 && end > start, "Actual employee controller must remain under deterministic regression");
  const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const state: { current: { attempt: ReturnType<typeof acknowledgeEmployeeAttempt>; phase: string; current?: EmployeeRecord | null; message: string } | null } = { current: null };
  const reads: string[] = []; let writes = 0, failRead = true, visible = true;
  const saved = { ...record, id: "known-created-id", email: "original@example.test" };
  const helpers = {
    guard: createEmployeeOperationGuard(), actionRef: state, mounted: { current: true }, snapshot: { current: [] }, accessChanged: false,
    recoveryContext: context, employeeOutcome, employeeMatches, acknowledgeEmployeeAttempt, isEmployeeRecord,
    setOperation(next: typeof state.current) { state.current = next; },
    async fetch(input: string, init: RequestInit) {
      if (init.method === "POST") { writes += 1; return { status: 200, json: async () => ({ ok: true, employeeId: saved.id, recoveryContext: context }) }; }
      reads.push(input);
      if (failRead) { failRead = false; throw new Error("Synthetic read transport failure after acknowledged creation"); }
      const query = new URL(input, "http://fixture.invalid").searchParams;
      const matches = query.get("employeeId") === saved.id || query.get("email") === saved.email;
      return { ok: true, status: 200, json: async () => ({ recoveryContext: context, employee: visible && matches ? { ...saved } : null }) };
    },
    StaffContextChanged: class extends Error {}, applyCurrent() {}, show() {}, sessionChanged() { throw new Error("Unexpected context loss"); }, router: { refresh() {} },
  };
  const factory = new Function(...Object.keys(helpers), compiled + "; return { writeEmployee, checkCurrent };");
  const controller = factory(...Object.values(helpers));
  const create = { name: saved.name, email: saved.email, passwordIncluded: true, desired: { name: saved.name, email: saved.email } };
  await controller.writeEmployee({ name: saved.name, email: saved.email }, create);
  assert.equal(writes, 1); assert.equal(state.current?.attempt.id, saved.id); assert.equal(state.current?.attempt.acknowledgedId, saved.id);
  assert.equal(state.current?.phase, "unknown"); assert.match(state.current!.message, /Save was acknowledged/);
  // A legitimate competing edit changes the original lookup email before recovery.
  saved.email = "renamed@example.test";
  await controller.checkCurrent();
  assert.equal(state.current?.current?.id, saved.id); assert.equal(state.current?.current?.email, saved.email);
  assert(reads.every(url => new URL(url, "http://fixture.invalid").searchParams.get("employeeId") === saved.id), "Every post-ack check must use stable employee ID, never mutable email");
  assert.equal(employeeRetryAllowed(state.current!.attempt, state.current!.current, false), false);
  // Null after a known acknowledgement means not visible, never permission for another create.
  visible = false; await controller.checkCurrent();
  assert.equal(state.current?.current, null); assert.equal(state.current?.attempt.acknowledgedId, saved.id);
  assert.equal(employeeRetryAllowed(state.current!.attempt, null, false), false);
  await controller.writeEmployee({ name: saved.name, email: "original@example.test" }, create);
  assert.equal(writes, 1, "Reconciliation and attempted duplicate submission must not replay acknowledged creation");
  assert.equal(employeeRetryAllowed(create, null, false), false, "Even a never-acknowledged create cannot safely replay solely on a negative email search");
  // Lost acknowledgement: the record may already exist under a renamed email. An empty
  // email lookup must not authorize a second create without server-side idempotency.
  state.current = null; writes = 0; reads.length = 0; visible = true; failRead = false;
  const lostHelpers = { ...helpers, guard: createEmployeeOperationGuard(), async fetch(input: string, init: RequestInit) {
    if (init.method === "POST") { writes += 1; throw new Error("Synthetic lost create acknowledgement after commit"); }
    return helpers.fetch(input, init);
  } };
  const lostController = factory(...Object.values(lostHelpers));
  await lostController.writeEmployee({ name: saved.name, email: "original@example.test" }, create);
  await lostController.checkCurrent();
  const lostAction = state.current as typeof state.current | { attempt: ReturnType<typeof acknowledgeEmployeeAttempt>; phase: string; current?: EmployeeRecord | null; message: string };
  assert(lostAction); assert.equal(lostAction.current, null); assert.equal(lostAction.attempt.acknowledgedId, undefined);
  assert.equal(employeeRetryAllowed(lostAction.attempt, null, false), false, "A committed-but-renamed employee is not evidence that creation failed");
  await lostController.writeEmployee({ name: saved.name, email: "original@example.test" }, create);
  assert.equal(writes, 1, "A null email check after lost acknowledgement never replays creation");
  console.log("PASS acknowledged-create controller: real POST acknowledgement → GET failure → email rename → ID-only recovery; even scoped null or lost acknowledgement cannot enable duplicate creation.");
}
acknowledgedCreateSurvivesReadFailure().catch(error => { console.error(error); process.exitCode = 1; });
