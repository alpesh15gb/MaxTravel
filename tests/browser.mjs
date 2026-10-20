// Shared Playwright loader for the browser harnesses.
//
// These suites used to `require("./.runtime/browser-tools/node_modules/playwright")` — a copy vendored
// by hand under tests/.runtime, which is git-ignored. On any machine but the one that vendored it, the
// repository's own dependencies were installed and Playwright was not, so every browser suite (and CI
// with it) died with MODULE_NOT_FOUND before running a single check.
//
// Resolution order:
//   1. the project's own dependency — what `npm ci` installs, and what CI uses;
//   2. the vendored copy under tests/.runtime, so local runs keep working unchanged;
//   3. a clear error naming the exact command that installs both the package and the browser.
//
// Both paths are derived from import.meta.url: nothing here depends on the machine or the platform.
import path from "node:path";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const vendored = path.join(here, ".runtime", "browser-tools", "node_modules", "playwright");

const HOW_TO_FIX = [
  "Playwright is not installed, so the browser suites cannot run.",
  "Install it with:  npm ci && npx playwright install --with-deps chromium",
].join("\n");

async function load() {
  try {
    return await import("playwright");
  } catch (e) {
    if (e?.code !== "ERR_MODULE_NOT_FOUND") throw e;
  }
  // The vendored copy is a CommonJS package with an exports map, so it is required rather than
  // imported: requiring the directory is exactly what the old call sites did, and a directory cannot
  // be the target of a dynamic import.
  if (existsSync(vendored)) {
    const require = createRequire(import.meta.url);
    return require(vendored);
  }
  throw new Error(HOW_TO_FIX);
}

const playwright = await load();
export const chromium = playwright.chromium ?? playwright.default?.chromium;
if (!chromium) throw new Error("Playwright loaded but exported no chromium browser.");
// Offline review hosts may supply a managed Chromium installation. CI keeps using
// Playwright's pinned browser unless this explicit override is provided.
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
  const launch = chromium.launch.bind(chromium);
  chromium.launch = options => launch({
    ...options,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
}
