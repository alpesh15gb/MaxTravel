// Sequential isolated fixtures: never uses a deployed database or provider.
import { spawnSync } from "node:child_process";
import path from "node:path";
const root = process.cwd();
function run(args, extra = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: root, env: { ...process.env, ...extra }, stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(["--import", "tsx", "tests/visa-checklist.ts"]);
run(["--import", "tsx", "tests/audit-visibility.ts"]);
run(["--import", "tsx", "tests/cancellation-accounting.ts"]);
run(["--import", "tsx", "tests/refund-picker-regressions.ts"]);
const ticketEnv = { DATABASE_URL: "file:./ticketing-journey-verification.db", TICKETING_BROWSER: "true" };
run([path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], ticketEnv);
run(["--import", "tsx", "tests/ticketing-journey.mts"], ticketEnv);
const cancellationEnv = { DATABASE_URL: "file:./cancellation-verification.db" };
run([path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], cancellationEnv);
run(["--import", "tsx", "tests/cancellation-journey.mts"], cancellationEnv);
run(["tests/visa-journey.mjs"]);
run(["tests/reporting-browser.mjs"]);
console.log("All isolated visa, ticketing, finance, audit and reporting journeys passed.");
