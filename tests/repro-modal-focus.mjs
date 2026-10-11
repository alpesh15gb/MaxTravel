// Focus behaviour of the shared <Modal> primitive, measured with real key presses.
// Run after visual-review-server.mjs in a separate terminal:
//   node tests/repro-modal-focus.mjs
import fs from "node:fs";
import { chromium } from "./browser.mjs";

const fixture = JSON.parse(fs.readFileSync("tests/.runtime/visual-review-current.json", "utf8"));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ baseURL: fixture.base, viewport: { width: 1440, height: 900 } });

const describe = () => page.evaluate(() => {
  const el = document.activeElement;
  const modal = [...document.querySelectorAll("dialog")].find(d => d.matches(":modal")) ?? null;
  return {
    target: !el || el === document.body ? "<body>" : `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} ${(el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 34)}`,
    insideModal: Boolean(modal && el && modal.contains(el)),
    modalOpen: Boolean(modal),
    modalLabel: modal ? (modal.getAttribute("aria-label") || modal.getAttribute("aria-labelledby") || "(none)") : null,
    topLayer: document.querySelectorAll(":modal").length,
  };
});

await page.goto("/login", { waitUntil: "domcontentloaded" });
await page.getByLabel("Work email", { exact: true }).fill("review@visual.test");
await page.getByLabel("Password", { exact: true }).fill("Review-Visual-2026!");
await page.getByRole("button", { name: "Sign in to workspace", exact: true }).click();
await page.waitForURL("**/dashboard", { waitUntil: "domcontentloaded" });

await page.goto("/tasks", { waitUntil: "domcontentloaded" });
await page.locator("main").waitFor();
const trigger = page.getByRole("button", { name: "New task", exact: true });
await trigger.click();
await page.getByRole("dialog").waitFor();
console.log("on open        ", JSON.stringify(await describe()));

const forward = [];
for (let i = 0; i < 24; i++) {
  await page.keyboard.press("Tab");
  const state = await describe();
  forward.push(`${i + 1}: ${state.insideModal ? "in " : "OUT"} ${state.target}`);
  if (!state.insideModal) break;
}
console.log("tab forward    ", forward.join("\n                "));

const back = [];
for (let i = 0; i < 4; i++) {
  await page.keyboard.press("Shift+Tab");
  const state = await describe();
  back.push(`${state.insideModal ? "in " : "OUT"} ${state.target}`);
}
console.log("shift+tab      ", back.join(" | "));

await page.keyboard.press("Escape");
await page.waitForTimeout(250);
const afterEscape = await describe();
console.log("after escape   ", JSON.stringify(afterEscape));
console.log("focus restored ", afterEscape.target.startsWith("button") || /New task/.test(afterEscape.target) ? "YES" : "NO — " + afterEscape.target);

// The same dialog must also be operable after re-opening, and a second modal must not stack.
await trigger.click();
await page.getByRole("dialog").waitFor();
console.log("re-open        ", JSON.stringify(await describe()));
await page.getByRole("button", { name: "Cancel", exact: true }).click();
await page.waitForTimeout(200);
console.log("after cancel   ", JSON.stringify(await describe()));

await browser.close();
