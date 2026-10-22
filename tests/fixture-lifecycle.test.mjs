import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { drainDiagnostics, observeDiagnostic, stopFixtureChild, withFixtureCleanup } from "./fixture-lifecycle.mjs";

test("never-settling observer is explicit and bounded; original assertion survives cleanup failure", { timeout: 1000 }, async () => {
  const primary = new Error("original product assertion");
  const reads = [observeDiagnostic("never-ending RSC", () => new Promise(() => {}))];
  let persistedBeforeDrain = false, report, secondary;
  await assert.rejects(withFixtureCleanup(async () => { throw primary; }, async failure => {
    assert.equal(failure.error, primary);
    persistedBeforeDrain = true;
    report = await drainDiagnostics(reads, 20);
    assert(persistedBeforeDrain);
    throw new Error("diagnostic drain timed out");
  }, error => { secondary = error; }), error => error === primary);
  assert.equal(report[0].state, "timed-out"); assert.match(report[0].error, /exceeded 20ms/);
  assert.match(secondary.message, /diagnostic drain timed out/);
});

test("observer rejections are recorded and completed observers remain completed", async () => {
  const reads = [observeDiagnostic("ok", async () => {}), observeDiagnostic("aborted", async () => { throw Error("browser closed"); })];
  const report = await drainDiagnostics(reads, 100);
  assert.deepEqual(report.map(read => read.state), ["completed", "failed"]);
  assert.match(report[1].error, /browser closed/);
});

test("cleanup failure still fails an otherwise successful harness", async () => {
  await assert.rejects(withFixtureCleanup(async () => "passed assertions", async () => { throw Error("cleanup timeout"); }, () => {}), /cleanup timeout/);
});

test("already signal-exited fixture never waits for a past exit event", { timeout: 1000 }, async () => {
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: "SIGTERM", kill() { throw Error("must not kill exited child"); } });
  await stopFixtureChild(child, 20, 20); assert.equal(child.listenerCount("exit"), 0);
});

test("unresponsive owned fixture gets bounded SIGTERM then SIGKILL", { timeout: 1000 }, async () => {
  const signals = [];
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, kill(signal) {
    signals.push(signal);
    if (signal === "SIGKILL") { this.signalCode = signal; this.emit("exit", null, signal); }
    return true;
  } });
  await stopFixtureChild(child, 20, 20); assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]); assert.equal(child.listenerCount("exit"), 0);
});
