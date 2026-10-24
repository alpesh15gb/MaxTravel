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

// Keep the shared modal's ordinary trap unchanged while respecting fieldset-inherited disability.
function verifyModalFocusStops() {
  const source = readFileSync("src/components/Modal.tsx", "utf8");
  const start = source.indexOf("const FOCUSABLE ="), end = source.indexOf("export default function Modal", start);
  assert(start >= 0 && end > start);
  const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const stopsIn = new Function("getComputedStyle", compiled + "; return stopsIn;")((node: { visibility: string }) => ({ visibility: node.visibility }));
  const ast = ts.createSourceFile("Modal.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let keydown = "";
  const visit = (node: ts.Node) => { if (ts.isJsxAttribute(node) && node.name.getText(ast) === "onKeyDown" && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) keydown = node.initializer.expression.getText(ast); ts.forEachChild(node, visit); };
  visit(ast); assert(keydown);
  type Control = { name: string; disabled: boolean; visibility: string; matches: (selector: string) => boolean; getClientRects: () => object[]; focus: () => void };
  let active: Control | null = null;
  const make = (name: string, disabled = false, visibility = "visible"): Control => {
    const control = { name, disabled, visibility, matches: (selector: string) => { assert.equal(selector, ":disabled"); return disabled; }, getClientRects: () => [{}], focus: () => { active = control; } };
    return control;
  };
  const first = make("ordinary first field"), last = make("ordinary last button"), disabledDescendant = make("fieldset-disabled input", true), hidden = make("hidden", false, "hidden"), status = make("programmatically focused status");
  let nodes = [first, last];
  // A tabindex=-1 status is inside the dialog, but intentionally absent from the Tab stops.
  const scope = { querySelectorAll: () => nodes, contains: (node: Control) => node === status || nodes.includes(node) };
  const handlerCode = ts.transpileModule(`const handler = ${keydown};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const handler = new Function("dialog", "document", "stopsIn", handlerCode + "; return handler;")({ current: scope }, { get activeElement() { return active; } }, stopsIn);
  const tab = (shiftKey = false) => { let prevented = 0; handler({ key: "Tab", shiftKey, preventDefault() { prevented += 1; } }); return prevented; };
  assert.deepEqual(stopsIn(scope), [first, last]); active = last; assert.equal(tab(), 1); assert.equal(active, first);
  assert.equal(tab(true), 1); assert.equal(active, last); active = first; assert.equal(tab(), 0, "Ordinary native forward movement remains untouched");
  active = last; assert.equal(tab(true), 0, "Ordinary native reverse movement remains untouched");
  active = make("outside dialog"); assert.equal(tab(), 1); assert.equal(active, first, "Outside forward focus re-enters the first control");
  active = make("outside dialog"); assert.equal(tab(true), 1); assert.equal(active, last, "Outside reverse focus re-enters the last control");
  nodes = [disabledDescendant, first, hidden, last]; assert.deepEqual(stopsIn(scope), [first, last]);
  active = last; assert.equal(tab(), 1); assert.equal(active, first, "Forward wrap skips fieldset-disabled descendants");
  assert.equal(tab(true), 1); assert.equal(active, last, "Reverse wrap preserves reachable enabled controls");
  active = status; assert.equal(tab(true), 1, "Immediate Shift+Tab from a focused non-stop must be trapped"); assert.equal(active, last, "Immediate reverse traversal enters the last enabled control, not the page/browser chrome");
  active = status; assert.equal(tab(), 1); assert.equal(active, first, "Forward traversal from a focused non-stop enters the first enabled control");
  nodes = [disabledDescendant]; active = status; assert.equal(tab(), 1); assert.equal(active, status, "A fully disabled pending form retains status focus");
  assert.equal(tab(true), 1); assert.equal(active, status, "A fully disabled pending form retains reverse Tab focus too");
  console.log("PASS shared modal focus: ordinary enabled-control trap unchanged; fieldset-disabled/hidden descendants excluded; immediate status Tab/Shift+Tab trapped; pending status retains focus.");
}
verifyModalFocusStops();


function verifyEmployeeFeedbackIsolation() {
  const source = readFileSync("src/app/(app)/employees/EmployeesClient.tsx", "utf8");
  const start = source.indexOf("function focusEmployeeFeedback("), end = source.indexOf("function StaffRecovery(", start);
  assert(start >= 0 && end > start);
  const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  class FakeDialog { open = true; scrollTop = 125; }
  let otherDialog: FakeDialog | null = null;
  const focusFeedback = new Function("HTMLDialogElement", "document", compiled + "; return focusEmployeeFeedback;")(FakeDialog, { querySelector: () => otherDialog });
  const dialog = new FakeDialog(), calls: unknown[] = [];
  focusFeedback({ closest: () => dialog, focus: (options: unknown) => calls.push(options) });
  assert.equal(JSON.stringify(calls), JSON.stringify([{ preventScroll: true }])); assert.equal(dialog.scrollTop, 0, "Only the inner dialog scroll is changed");
  calls.length = 0; otherDialog = new FakeDialog();
  const banner = { closest: () => null, focus: (options: unknown) => calls.push(options) };
  focusFeedback(banner); assert.equal(calls.length, 0, "Never focus the background banner while another dialog is open");
  otherDialog = null; focusFeedback(banner); assert.equal(calls.length, 1, "Dismissed unknown action can focus its visible recovery banner");
  console.log("PASS employee feedback focus: inner-dialog scroll only; unknown dismissal banner focus; no background focus behind another modal.");
}
verifyEmployeeFeedbackIsolation();
