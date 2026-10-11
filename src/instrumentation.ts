// Runs once when a Next.js server instance starts, before it accepts requests.
//
// Next compiles this file for two runtimes, and only the node server can read the filesystem. The
// runtime and phase checks therefore have to live in a single constant-condition block rather than
// as early returns: webpack replaces both variables with literals and only eliminates an import
// that sits inside a block it can prove is dead. With a bare `return`, the edge bundle still tries
// to resolve node:fs through src/lib/config.ts and the build fails.
//
// Validation exits the process rather than throwing. Next reports a throwing instrumentation hook
// as an unhandled rejection and keeps the process alive without listening, which is the worst
// outcome for a supervisor: the app looks running and serves nothing. Exiting is honest — the
// container restarts or the service reports failed, with the reason already in the log.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { configErrors, configSummary, configWarnings, formatConfigErrors } = await import("./lib/config");

    for (const warning of configWarnings()) {
      console.warn(`[config] ${warning.key}: ${warning.message}`);
    }

    const errors = configErrors();
    if (errors.length) {
      console.error(`\n${formatConfigErrors(errors)}\n`);
      process.exit(1);
    }

    console.log(`[startup] Max Travel CRM ready · ${configSummary()}`);
  }
}
