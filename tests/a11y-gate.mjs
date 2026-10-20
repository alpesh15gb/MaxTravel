// Pre-deploy accessibility gate.
//
//   npm run build && npm run test:a11y           # start the workspace, audit, compare the budget
//   node tests/a11y-gate.mjs --report=<path>     # compare an existing report, start nothing
//   node tests/a11y-gate.mjs --budget=<path>     # compare against another budget file
//   node tests/a11y-gate.mjs --update-budget     # rewrite the budget from this run, deliberately
//
// This owns the whole check: it starts the isolated review workspace on a free loopback port, runs
// tests/a11y-audit.mjs against it, stops the server again, and compares what the audit found with
// tests/a11y-budget.json. Exit 0 means the app may ship; exit 1 means it may not.
//
// Four things fail the gate, and they are failures rather than warnings on purpose:
//
//   1. A finding that is not in the budget. The budget holds nothing today, so any new contrast,
//      landmark, focus, target-size or dialog finding blocks the build.
//   2. A budget entry that no longer occurs, or occurs less often than budgeted. A budget nobody
//      prunes quietly becomes a place where nobody looks, so shrinking it is a deliberate act.
//   3. A report that did not cover the whole audit: routes that failed to load, focus walks or
//      dialogs that never ran, or a run narrowed with `--rules=`. A gate that stays green because it
//      looked at nothing is worse than no gate.
//   4. A build older than the source it claims to represent. The audit judges a production build, so
//      the gate asks for `npm run build` rather than failing you for the previous author's code.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

const ROOT = process.cwd();
const arg = (name, fallback = null) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const budgetPath = path.resolve(arg("budget", "tests/a11y-budget.json"));
const reportPath = path.resolve(arg("report", "test-artifacts/a11y/report.json"));
const updateBudget = process.argv.includes("--update-budget");
const distDir = process.env.NEXT_DIST_DIR ?? ".next";
const logPath = "test-artifacts/a11y-gate-server.log";
const fixturePath = path.resolve("tests/.runtime/visual-review-current.json");
// Coverage is read from the report rather than hardcoded, so adding routes to the audit does not
// need a matching edit here. These two have no routes-derived equivalent, and the rule list is the
// contract for a full run: a narrowed `--rules=` report may not green the gate.
const EXPECTED = { phoneWalks: 3, dialogs: 2, allRules: ["contrast", "names", "taps", "focus", "modal", "semantics"] };

const FAILURES = [];
const fail = message => FAILURES.push(message);
const indent = message => `  - ${message}`;

// ---------------------------------------------------------------- build freshness
function newestSourceMtime(dir) {
  let newest = 0;
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return newest;
}

function checkBuildIsCurrent() {
  const buildId = path.join(ROOT, distDir, "BUILD_ID");
  if (!fs.existsSync(buildId)) {
    fail(`No build in ${distDir}/ to audit — run "npm run build" first (or set NEXT_DIST_DIR)`);
    return false;
  }
  const built = fs.statSync(buildId).mtimeMs;
  const source = newestSourceMtime(path.join(ROOT, "src"));
  if (source > built) {
    const seconds = Math.round((source - built) / 1000);
    fail(`The build in ${distDir}/ is ${seconds}s older than src/ — run "npm run build" so the gate audits what you are shipping`);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- isolated workspace
async function freePort(start) {
  for (let port = start; port < start + 20; port++) {
    const open = await new Promise(resolve => {
      const probe = net.createServer();
      probe.once("error", () => resolve(false));
      probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
    });
    if (open) return port;
  }
  throw new Error(`No free loopback port near ${start}`);
}

function stopTree(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGTERM");
}

async function startWorkspace() {
  fs.mkdirSync(path.dirname(path.resolve(logPath)), { recursive: true });
  const port = await freePort(Number(process.env.REVIEW_PORT ?? 3325));
  // Both the log and the fixture metadata outlive a run, so clear them first. Polling a stale
  // "VISUAL REVIEW READY" line once made the gate audit a server that had not started listening
  // yet — the log says a *previous* workspace was ready, not this one.
  fs.rmSync(path.resolve(logPath), { force: true });
  fs.rmSync(fixturePath, { force: true });
  const log = createWriteStream(path.resolve(logPath));
  const server = spawn(process.execPath, [path.join(ROOT, "tests", "visual-review-server.mjs")], {
    cwd: ROOT,
    env: { ...process.env, REVIEW_PORT: String(port), NEXT_DIST_DIR: distDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.pipe(log); server.stderr.pipe(log);

  // The workspace writes its fixture only after seeding, so a fixture naming *this* port is proof
  // that the audit's preconditions hold: the server is listening and the seeded data is in place.
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (server.exitCode !== null) break;
    if (fs.existsSync(fixturePath)) {
      try {
        if (JSON.parse(fs.readFileSync(fixturePath, "utf8")).base === `http://127.0.0.1:${port}`) { ready = true; break; }
      } catch { /* the file is being written; try again */ }
    }
    await new Promise(r => setTimeout(r, 200));
  }
  if (!ready) {
    const tail = fs.existsSync(path.resolve(logPath)) ? fs.readFileSync(path.resolve(logPath), "utf8").trim().split("\n").slice(-4).join(" / ") : "(no output)";
    stopTree(server);
    throw new Error(`The review workspace never became ready on port ${port} — ${tail}`);
  }
  return { server, port };
}

function runAudit() {
  return new Promise((resolve, reject) => {
    // Inherit stdio so the per-route lines stay visible, but keep the exit status ours to read.
    const audit = spawn(process.execPath, [path.join(ROOT, "tests", "a11y-audit.mjs")], {
      cwd: ROOT,
      env: { ...process.env, NEXT_DIST_DIR: distDir },
      stdio: "inherit",
    });
    audit.on("exit", code => resolve(code ?? 1));
    audit.on("error", reject);
  });
}

// ---------------------------------------------------------------- budget
// One line per distinct finding, so a budget entry can be read and reviewed on its own.
const identity = (kind, item) => [
  kind, item.route, item.size, item.tag, item.type ?? "",
  item.label ?? item.text ?? "", item.cls ?? "", item.why ?? "", item.missing ?? "", item.ratio ?? "",
].map(part => String(part).replace(/\s+/g, " ").trim()).join(" | ");

const JUDGEMENT_NOTE = "Indeterminate results are the audit's honest 'a person must decide this' list (today: inline targets exempt under WCAG 2.5.8). Held as a ceiling rather than a list of lines, so a new kind of judgement call, or a collapse into blanket exemptions, still fails the gate.";

const findSubmissions = report => {
  const map = new Map();
  for (const [kind, list] of Object.entries(report.grouped ?? {})) {
    for (const item of list) {
      const key = identity(kind, item);
      map.set(key, (map.get(key) ?? 0) + (item.count ?? 1));
    }
  }
  return map;
};

const findJudgements = report => {
  const counts = {};
  for (const item of report.indeterminate ?? []) {
    const category = /exempt via 2\.5\.8 spacing/.test(item.why ?? "") ? "spacing-exempt-inline-target" : "other";
    counts[category] = (counts[category] ?? 0) + 1;
  }
  return counts;
};

const readBudget = () => JSON.parse(fs.readFileSync(budgetPath, "utf8"));

function writeBudget(report) {
  const findings = Object.fromEntries([...findSubmissions(report).entries()].sort(([a], [b]) => a.localeCompare(b)));
  const previous = fs.existsSync(budgetPath) ? readBudget() : {};
  const ceilings = { ...(previous.indeterminate?.ceilings ?? {}), ...findJudgements(report) };
  fs.writeFileSync(budgetPath, `${JSON.stringify({
    note: "Accepted accessibility findings, keyed one line per finding. Empty means the app may ship with none: a new finding fails the gate. Rewrite deliberately with `npm run a11y:budget` after reviewing what changed.",
    updatedAt: new Date().toISOString(),
    findings,
    indeterminate: { note: JUDGEMENT_NOTE, ceilings },
  }, null, 2)}\n`);
  console.log(`Budget rewritten from this run: ${Object.keys(findings).length} accepted finding(s), ceilings ${JSON.stringify(ceilings)}`);
}

function compare(report) {
  const budget = readBudget();
  const accepted = budget.findings ?? {};
  const current = findSubmissions(report);

  const unknown = [];
  for (const [key, count] of current) {
    const allowed = accepted[key] ?? 0;
    if (count > allowed) unknown.push({ key, count, allowed });
  }
  const stale = Object.entries(accepted).filter(([key]) => !current.has(key)).map(([key, count]) => ({ key, count }));
  const shrank = Object.entries(accepted)
    .filter(([key, count]) => current.has(key) && current.get(key) < count)
    .map(([key, count]) => ({ key, budgeted: count, now: current.get(key) }));

  for (const item of unknown) fail(`New finding (${item.count}, budgeted ${item.allowed}): ${item.key}`);
  for (const item of stale) fail(`Budget entry that no longer occurs — prune it with "npm run a11y:budget": ${item.key}`);
  for (const item of shrank) fail(`Fewer occurrences than budgeted (${item.now} < ${item.budgeted}) — prune it with "npm run a11y:budget": ${item.key}`);

  const judgements = findJudgements(report);
  const ceilings = budget.indeterminate?.ceilings ?? {};
  for (const [category, count] of Object.entries(judgements)) {
    const ceiling = ceilings[category];
    if (ceiling === undefined) fail(`Unbudgeted kind of indeterminate result "${category}" (${count}) — judge it, then record a ceiling`);
    else if (count > ceiling) fail(`Indeterminate "${category}" grew to ${count}, ceiling ${ceiling} — judge the new entries`);
  }

  return {
    findings: [...current.values()].reduce((total, count) => total + count, 0),
    acceptedEntries: Object.keys(accepted).length,
    judgements,
    unknown,
    stale,
    shrank,
  };
}

function checkCoverage(report) {
  const coverage = report.coverage;
  if (!coverage) {
    fail("This report predates coverage tracking and cannot green the gate — re-run the audit");
    return;
  }
  const missingRules = EXPECTED.allRules.filter(rule => !(coverage.rules ?? []).includes(rule));
  if (missingRules.length) {
    fail(`Report covered only rules=${(coverage.rules ?? []).join(",")}; missing ${missingRules.join(",")} — a narrowed run cannot green the gate`);
  }
  const expected = { routeVisits: (coverage.routes ?? 0) * 2, focusWalks: Math.min(12, coverage.routes ?? 0), ...EXPECTED };
  for (const [metric, want] of Object.entries(expected)) {
    if (metric === "allRules") continue;
    if ((coverage[metric] ?? 0) < want) fail(`Coverage shortfall: ${metric} ${coverage[metric] ?? 0} of ${want} — the audit did not look at everything it claims to`);
  }
  for (const route of report.failedRoutes ?? []) fail(`Route did not load: ${route.route} ${route.size} — ${route.error}`);
}

// ---------------------------------------------------------------- run
let workspace = null;
try {
  let report = null;
  if (arg("report")) {
    assert(fs.existsSync(reportPath), `No report at ${reportPath}`);
    report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    console.log(`Accessibility gate: comparing ${reportPath} (generated ${report.generatedAt})`);
  } else if (checkBuildIsCurrent()) {
    console.log(`Accessibility gate: auditing ${distDir}/ on an isolated workspace`);
    workspace = await startWorkspace();
    const auditExit = await runAudit();
    assert(fs.existsSync(reportPath), `The audit wrote no report at ${reportPath}`);
    report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    if (auditExit !== 0) console.log("The audit reported findings; comparing them with the budget anyway, so you see every reason at once.");
  }

  if (report) {
    checkCoverage(report);
    if (updateBudget) writeBudget(report);
    const summary = compare(report);
    fs.writeFileSync("test-artifacts/a11y/gate.json", JSON.stringify({
      generatedAt: new Date().toISOString(),
      report: report.generatedAt ?? null,
      passed: FAILURES.length === 0,
      failures: FAILURES,
      ...summary,
    }, null, 2));

    console.log("");
    console.log(`Findings    ${summary.findings} (${summary.acceptedEntries} accepted in the budget)`);
    console.log(`Judgements  ${JSON.stringify(summary.judgements)}`);
    if (summary.unknown.length) console.log(`New         ${summary.unknown.length}`);
    if (summary.stale.length + summary.shrank.length) console.log(`Stale       ${summary.stale.length + summary.shrank.length}`);
    console.log("");
    if (FAILURES.length) {
      console.log(`FAIL — ${FAILURES.length} reason${FAILURES.length === 1 ? "" : "s"} this build may not ship:`);
      for (const message of FAILURES) console.log(indent(message));
      console.log("");
      console.log("Report: test-artifacts/a11y/report.md · budget: tests/a11y-budget.json");
      process.exitCode = 1;
    } else {
      console.log("PASS — no accessibility findings outside the accepted budget.");
    }
  } else {
    console.log("");
    for (const message of FAILURES) console.log(indent(message));
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`\nAccessibility gate could not run: ${error.message}`);
  process.exitCode = 1;
} finally {
  stopTree(workspace?.server);
}
