/** Test-only lifecycle helpers. Diagnostic deadlines never retry or change application assertions. */
export class FixtureTimeout extends Error {
  constructor(label, milliseconds) { super(`${label} exceeded ${milliseconds}ms`); this.name = "FixtureTimeout"; }
}
export async function within(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new FixtureTimeout(label, milliseconds)), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

export function observeDiagnostic(label, read) {
  const result = { label, state: "pending", error: "", promise: Promise.resolve() };
  result.promise = Promise.resolve().then(read).then(() => {
    if (result.state === "pending") result.state = "completed";
  }, error => {
    if (result.state === "pending") { result.state = "failed"; result.error = String(error).slice(0, 1000); }
  });
  return result;
}

export async function drainDiagnostics(reads, milliseconds) {
  try { await within(Promise.allSettled(reads.map(read => read.promise)), milliseconds, "diagnostic response drain"); }
  catch (error) {
    if (!(error instanceof FixtureTimeout)) throw error;
    for (const read of reads) if (read.state === "pending") { read.state = "timed-out"; read.error = error.message; }
  }
  return reads.map(({ label, state, error }) => ({ label, state, error }));
}

/** Cleanup failure must never replace the original product assertion or navigation error. */
export async function withFixtureCleanup(work, cleanup, onCleanupError = error => console.error("Fixture cleanup failure:", error)) {
  let primary, failed = false, value;
  try { value = await work(); } catch (error) { primary = error; failed = true; }
  try { await cleanup(failed ? { error: primary } : undefined); }
  catch (error) {
    try { onCleanupError(error); } catch { /* Reporting cannot replace either failure. */ }
    if (!failed) throw error;
  }
  if (failed) throw primary;
  return value;
}

/** Only accepts the child handle this harness spawned; never discovers or kills another process. */
export async function stopFixtureChild(child, termMilliseconds = 3000, killMilliseconds = 2000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let onExit, onError;
  const exited = new Promise((resolve, reject) => {
    onExit = () => resolve(undefined); onError = error => reject(error);
    child.once("exit", onExit); child.once("error", onError);
  });
  try {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    try { await within(exited, termMilliseconds, "fixture SIGTERM exit"); }
    catch (error) {
      if (!(error instanceof FixtureTimeout)) throw error;
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGKILL");
      await within(exited, killMilliseconds, "fixture SIGKILL exit");
    }
  } finally { child.off("exit", onExit); child.off("error", onError); }
}
