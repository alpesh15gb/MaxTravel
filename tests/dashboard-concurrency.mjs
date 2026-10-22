// Source-level concurrency regression, not a browser/render assertion.
// Execute the actual Dashboard load/act bodies with controlled transport promises;
// never duplicate the lock implementation or call a server/provider.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = ts.transpileModule(fs.readFileSync('src/app/(app)/dashboard/DashboardClient.tsx', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
}).outputText;
const ast = ts.createSourceFile('dashboard.js', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
const dashboard = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'Dashboard');
assert(dashboard, 'The production Dashboard function must exist');
const loads = [], acts = [];
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'load') {
    assert(ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === 'useCallback');
    loads.push(node.initializer.arguments[0].getText(ast));
  }
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'act') acts.push(node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(dashboard);
assert.equal(loads.length, 1); assert.equal(acts.length, 1);
const pending = [], calls = [], ui = {};
const context = {
  mutationLock: { current: false }, loadingLock: { current: false }, uncertainRef: { current: false },
  JSON, location: { assign() { throw Error('This probe must not navigate'); } },
  fetch(url, options) {
    calls.push({ url, method: options?.method ?? 'GET' });
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  },
};
for (const name of ['setError', 'setRefreshing', 'setData', 'setUncertain', 'setBusy', 'setNotice', 'setNoticeFailed']) {
  context[name] = value => { ui[name] = value; };
}
vm.createContext(context);
vm.runInContext(`const load=${loads[0]};${acts[0]};globalThis.probe={load,act}`, context, { timeout: 1000 });
const { load, act } = context.probe;
const item = { id: 'synthetic-item' }, action = { label: 'Synthetic action', api: '/synthetic-write' };
const ok = value => ({ ok: true, json: async () => value });
async function pendingRequest() {
  for (let i = 0; i < 20 && !pending.length; i++) await Promise.resolve();
  assert(pending.length, 'Expected production function to initiate the next request');
  return pending.shift();
}

// A read begun before a mutation cannot later unlock an uncertain write: the write is excluded.
const read = load();
assert(context.loadingLock.current);
await act(item, action);
assert.equal(calls.length, 1, 'Pending GET excludes a new POST');
(await pendingRequest()).resolve(ok({ items: [] })); await read;

const write = act(item, action);
assert(context.mutationLock.current);
await load(); await act(item, action);
assert.equal(calls.length, 2, 'Pending POST excludes manual GET and repeated POST synchronously');
(await pendingRequest()).reject(new Error('Synthetic lost response')); await write;
assert(context.uncertainRef.current);
assert.equal(ui.setUncertain, true);
await act(item, action);
assert.equal(calls.length, 2, 'Unknown outcome blocks another POST without waiting for a React render');

const failedRead = load();
(await pendingRequest()).resolve({ ok: false }); await failedRead;
assert(context.uncertainRef.current, 'Failed reconciliation must retain uncertainty');
const reconcile = load(); await act(item, action);
assert.equal(calls.length, 4, 'Reconciliation GET does not permit a concurrent POST');
(await pendingRequest()).resolve(ok({ items: [] })); await reconcile;
assert.equal(context.uncertainRef.current, false);

// Acknowledged writes may perform their own internal reload while retaining their write lock.
const successfulWrite = act(item, action);
(await pendingRequest()).resolve(ok({}));
const internalRead = await pendingRequest();
assert(context.mutationLock.current);
assert(context.loadingLock.current);
assert(context.uncertainRef.current);
await load(); await act(item, action);
assert.equal(calls.length, 6, 'Internal reload retains exclusive ownership until complete');
internalRead.resolve(ok({ items: [] })); await successfulWrite;
assert.equal(context.mutationLock.current, false);
assert.equal(context.loadingLock.current, false);
assert.equal(context.uncertainRef.current, false);
assert.equal(pending.length, 0);
console.log('Dashboard exact-source concurrency PASS: read/write exclusion, unknown-outcome lock, failed/successful reconciliation, internal post-success reload. Source-level only; no browser or network.');
