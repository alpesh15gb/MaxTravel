/** Actual inbox UI + synthetic delayed transport. All WhatsApp writes/provider reads are intercepted.
 * Run only where launching Chromium is authorized: npm run test:whatsapp-browser (build first).
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, cp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import type { Browser, Page, Route } from "playwright";
import { chromium } from "./browser.mjs";
import { within, withFixtureCleanup, stopFixtureChild } from "./fixture-lifecycle.mjs";

const dir = await mkdtemp(join(tmpdir(), "whatsapp-recipient-fixture-"));
const database = `file:${join(dir, "fixture.db")}`, port = 3381, base = `http://127.0.0.1:${port}`;
const secret = randomBytes(48).toString("hex"), out = resolve("test-artifacts/whatsapp-recipient-context");
await mkdir(out, { recursive: true });
await writeFile(join(dir, "schema.prisma"), await readFile(new URL("../prisma/schema.prisma", import.meta.url)));
await cp(new URL("../prisma/migrations", import.meta.url), join(dir, "migrations"), { recursive: true });
const env = { ...process.env, DATABASE_URL: database, APP_ORIGIN: base, JWT_SECRET: secret, UPLOAD_ROOT: join(dir, "uploads"), NEXT_TELEMETRY_DISABLED: "1" };
for (const key of Object.keys(env)) if (/^(WA_|EVOLUTION_|CRM_REQUIRE_MFA$)/.test(key)) delete env[key as keyof typeof env];
// These dummy settings only expose the actual cloud composer UI. No server send/status endpoint is used.
Object.assign(env, { WA_PROVIDER: "meta", WA_CLOUD_ACCESS_TOKEN: "synthetic-never-a-real-provider-token", WA_CLOUD_PHONE_NUMBER_ID: "111", WA_CLOUD_WABA_ID: "222", WA_CLOUD_GRAPH_VERSION: "v99.0", WA_CLOUD_APP_SECRET: secret, WA_CLOUD_VERIFY_TOKEN: secret, WA_WORKER_SECRET: secret, WA_CLOUD_TEMPLATES: JSON.stringify({ RECEIPT: { name: "synthetic_receipt", language: "en", parameters: ["reference"] } }) });
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", join(dir, "schema.prisma")], { env, stdio: "pipe" });
const db = new PrismaClient({ datasources: { db: { url: database } } });
const server = spawn(process.execPath, ["--import", "./tests/whatsapp-no-provider.mjs", "node_modules/next/dist/bin/next", "start", "--port", String(port), "--hostname", "127.0.0.1"], { env, stdio: ["ignore", "pipe", "pipe"] });
let logs = "", spawnError = "", browser: Browser | undefined, page: Page | undefined;
server.stdout.on("data", value => logs += value); server.stderr.on("data", value => logs += value); server.on("error", error => spawnError = String(error));
const report = { passed: false, checks: [] as string[], pageErrors: [] as string[], failure: "", realWhatsAppRows: -1 };
type Payload = { preview?: boolean; customerId: string; template?: string; cloudTemplateKey?: string; cloudValues?: { reference?: string }; text?: string; requestId?: string; acceptedCloudBody?: string; attachmentId?: string; acceptedAttachmentId?: string };
const requests: Payload[] = [];
let hold: "preview" | "send" | null = null, failNext = false;
let held: { route: Route; payload: Payload; release: () => void; done: Promise<void> } | null = null;
function responseFor(payload: Payload) {
  const body = payload.cloudTemplateKey ? `Approved ${payload.customerId}: ${payload.cloudValues?.reference}` : payload.preview ? `Hello Customer ${payload.customerId.toUpperCase()}` : payload.text;
  return { ok: true, messageId: `synthetic-${requests.length}`, threadId: `synthetic-thread-${payload.customerId}`, body, status: payload.preview ? "DRAFT" : "QUEUED", whatsappUrl: null };
}
async function releaseHeld() { assert(held, "Expected held client request"); const request = held; held = null; request.release(); await request.done; }
async function waitHeld() { await within((async () => { while (!held) await new Promise(resolve => setTimeout(resolve, 10)); })(), 10000, "client request admission"); }
await withFixtureCleanup(async () => {
  try {
    await db.role.create({ data: { id: "fixture-owner", key: "OWNER", name: "Owner", desc: "Synthetic only" } });
    await db.branch.create({ data: { id: "fixture-branch", code: "FIX", name: "Synthetic branch", city: "Fixture" } });
    await db.user.create({ data: { id: "fixture-staff", employeeCode: "FIX-1", name: "Synthetic Staff", email: "fixture@example.test", phone: "", passwordHash: "not-a-real-password-hash", roleId: "fixture-owner", branchId: "fixture-branch" } });
    await db.staffSession.create({ data: { id: "fixture-session", userId: "fixture-staff", expiresAt: new Date(Date.now() + 3600000), agent: "Synthetic WhatsApp regression" } });
    for (const id of ["a", "b"]) await db.customer.create({ data: { id, code: `FIX-${id}`, name: `Customer ${id.toUpperCase()}`, phone: id === "a" ? "+15550000001" : "+15550000002", city: "Fixture", branchId: "fixture-branch", whatsappOptIn: true } });
    const cookie = await new SignJWT({ id: "fixture-staff", sessionId: "fixture-session", authVersion: createHash("sha256").update("not-a-real-password-hash").digest("hex") }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret));
    await within((async () => { while (true) {
      assert(!spawnError && server.exitCode === null && server.signalCode === null, `Owned fixture exited: ${spawnError}\n${logs}`);
      try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* owned startup only */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    } })(), 90000, "WhatsApp fixture startup");
    const ownedBrowser: Browser = await chromium.launch({ headless: true }); browser = ownedBrowser;
    const context = await ownedBrowser.newContext({ baseURL: base, viewport: { width: 1280, height: 900 } });
    await context.addCookies([{ name: "tos_session", value: cookie, url: base, httpOnly: true, sameSite: "Lax" }]);
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) { await route.abort(); return; }
      if (!url.pathname.startsWith("/api/whatsapp/")) { await route.continue(); return; }
      if (url.pathname === "/api/whatsapp/meta-templates") { await route.fulfill({ json: { configured: true, templates: [{ key: "RECEIPT", name: "synthetic_receipt", language: "en", parameters: ["reference"] }] } }); return; }
      if (url.pathname.startsWith("/api/whatsapp/attachments")) { await route.fulfill({ json: { id: "synthetic-pdf-a", filename: "fixture.pdf", url: "/api/whatsapp/attachments/synthetic-pdf-a" } }); return; }
      if (url.pathname !== "/api/whatsapp/send") { await route.fulfill({ json: { ok: true, configured: true, state: "open" } }); return; }
      const payload = route.request().postDataJSON() as Payload; requests.push(payload);
      if (!payload.preview && failNext) { failNext = false; await route.abort("failed"); return; }
      if (hold === (payload.preview ? "preview" : "send")) {
        hold = null; let release!: () => void, done!: () => void;
        const waiting = new Promise<void>(resolve => release = resolve), completed = new Promise<void>(resolve => done = resolve);
        held = { route, payload, release, done: completed }; await waiting;
        try { await route.fulfill({ json: responseFor(payload) }); } finally { done(); }
        return;
      }
      await route.fulfill({ json: responseFor(payload) });
    });
    // Deliberately ignore transport cancellation for previews, proving generation guards themselves.
    await context.addInitScript(() => {
      const original = window.fetch;
      window.fetch = (input, init) => {
        if (String(input) === "/api/whatsapp/send" && typeof init?.body === "string" && JSON.parse(init.body).preview) return original(input, { ...init, signal: undefined });
        return original(input, init);
      };
    });
    page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on("pageerror", error => report.pageErrors.push(error.message));
    page.on("dialog", dialog => void dialog.accept());
    await page.goto("/whatsapp?customer=a");
    // Match each visible label's sole control, and require the two selects to
    // expose that exact accessible name (without their option text or guidance).
    const field = (name: string) => page!.locator("label.field").filter({
      has: page!.locator(".field-label").filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }),
    }).locator("input, select, textarea");
    const picker = field("Start or open a conversation").and(page.getByRole("combobox", { name: "Start or open a conversation", exact: true }));
    const message = field("Message");
    const quick = page.getByRole("combobox", { name: "Insert quick reply" });
    const send = page.getByRole("button", { name: "Send WhatsApp message", exact: true });
    const quickKey = await quick.locator("option").nth(1).getAttribute("value"); assert(quickKey);
    await picker.waitFor(); assert.equal(await picker.count(), 1, "Conversation picker has exactly its visible label as its accessible name");
    const choose = async (id: string) => { await picker.selectOption(id); await page!.getByRole("heading", { name: `Customer ${id.toUpperCase()}`, exact: true }).waitFor(); };
    const waitValue = async (value: string) => { await within((async () => { while (await message.inputValue() !== value) await new Promise(resolve => setTimeout(resolve, 10)); })(), 10000, `composer value ${value}`); };
    const discard = async () => { const button = page!.getByRole("button", { name: "Discard draft", exact: true }); if (await button.isVisible()) await button.click(); };
    await message.fill("Private draft A"); await choose("b"); await waitValue(""); await message.fill("Private draft B"); await choose("a"); await waitValue("Private draft A"); await discard();
    hold = "preview"; await quick.selectOption(quickKey); await waitHeld(); await choose("b"); await releaseHeld(); await waitValue("Private draft B"); assert.equal(await page.getByText("Hello Customer A", { exact: true }).count(), 0);
    report.checks.push("Actual quick-reply A → B delayed completion cannot overwrite B; dirty drafts survive switches");
    await choose("a"); hold = "preview"; const beforePreview = requests.length;
    await quick.evaluate((element, value) => { const select = element as HTMLSelectElement; for (let i = 0; i < 2; i++) { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); } }, quickKey);
    await waitHeld(); assert.equal(requests.length - beforePreview, 1); await message.fill("Typed while preview pending"); await releaseHeld(); await waitValue("Typed while preview pending");
    report.checks.push("Repeated quick-reply events admit one request; manual edits win over a late preview");
    hold = "send"; const beforeSend = requests.filter(request => !request.preview).length;
    await send.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
    await waitHeld(); assert.equal(requests.filter(request => !request.preview).length - beforeSend, 1);
    await message.fill("Newer A draft"); await choose("b"); await releaseHeld(); await waitValue("Private draft B");
    assert.equal(await page.getByText("Your newer draft has been kept.", { exact: false }).count(), 0);
    await choose("a"); await waitValue("Newer A draft"); await page.getByText("Your newer draft has been kept.", { exact: false }).waitFor();
    report.checks.push("Repeated send clicks admit one request; A completion never clears B or a newer A draft");
    hold = "send"; await send.click(); await waitHeld();
    await page.getByRole("link", { name: "Customer workspace →", exact: true }).click(); await page.waitForURL("**/customers/a");
    await page.goBack(); await page.waitForURL("**/whatsapp?customer=a"); assert(await send.isDisabled());
    await releaseHeld(); await waitValue("");
    report.checks.push("Pending send stays locked across actual SPA navigation/Back; acknowledgement retires only its submitted draft");
    await message.fill("Unknown outcome A"); failNext = true; await send.click();
    const reviewed = page.getByRole("button", { name: "I checked the earlier message", exact: true }); await reviewed.waitFor(); assert(await send.isDisabled());
    const unknownRequest = requests.at(-1)!;
    await page.getByRole("link", { name: "Customer workspace →", exact: true }).click(); await page.waitForURL("**/customers/a"); await page.goBack(); await reviewed.waitFor(); assert(await send.isDisabled());
    await reviewed.click(); hold = "send"; await send.click(); await waitHeld(); assert.equal(held!.payload.requestId, unknownRequest.requestId); await releaseHeld(); await waitValue("");
    report.checks.push("Uncertain outcomes remain blocked after Back; explicit reviewed identical retry reuses its idempotency key");
    const cloud = field("Approved Meta utility template").and(page.getByRole("combobox", { name: "Approved Meta utility template", exact: true }));
    await cloud.waitFor(); assert.equal(await cloud.count(), 1, "Approved template picker has exactly its visible label as its accessible name");
    assert.equal(await cloud.evaluate(element => {
      const id = element.getAttribute("aria-describedby");
      return id ? document.getElementById(id)?.textContent : null;
    }), "Template name, approval and utility category are checked with Meta before sending. Enter the specific business fields; the approved wording is used.", "Cloud guidance is associated as a description, not part of the accessible name");
    report.checks.push("Conversation and approved-template selects expose exact visible accessible names; cloud guidance remains a description");
    await cloud.selectOption("RECEIPT");
    const reference = field("reference"), previewButton = page.getByRole("button", { name: "Preview approved message", exact: true });
    await reference.fill("A-1"); hold = "preview"; await previewButton.click(); await waitHeld(); await reference.fill("A-2"); await releaseHeld();
    assert.equal(await page.getByText("Approved a: A-1", { exact: true }).count(), 0); assert(await send.isDisabled());
    await previewButton.click(); await page.getByText("Approved a: A-2", { exact: true }).waitFor(); assert(await send.isEnabled());
    await page.locator('input[type="file"]').setInputFiles({ name: "fixture.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 synthetic fixture only") });
    const pdfConsent = page.getByRole("checkbox", { name: "I reviewed this PDF and confirmed it belongs to this customer.", exact: true }); await pdfConsent.waitFor(); assert(await send.isDisabled());
    await pdfConsent.check(); await previewButton.click(); await page.getByText("Approved a: A-2", { exact: true }).waitFor();
    await choose("b"); await choose("a"); assert.equal(await pdfConsent.isChecked(), false); assert(await send.isDisabled());
    await pdfConsent.check(); await previewButton.click(); await page.getByText("Approved a: A-2", { exact: true }).waitFor();
    hold = "send"; await send.click(); await waitHeld(); assert.equal(held!.payload.acceptedCloudBody, "Approved a: A-2"); assert.equal(held!.payload.attachmentId, held!.payload.acceptedAttachmentId); await releaseHeld();
    report.checks.push("Cloud parameter edits invalidate pending wording; PDFs and approved wording require fresh review after recipient switches");
    await message.waitFor(); await message.fill("Private BFCache draft");
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    await waitValue(""); await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await message.fill("Fresh after BFCache"); hold = "preview"; await quick.selectOption(quickKey); await waitHeld();
    await page.getByRole("link", { name: "Customer workspace →", exact: true }).click(); await page.waitForURL("**/customers/a"); await releaseHeld(); await page.goBack(); await waitValue("Fresh after BFCache");
    report.checks.push("Synthetic BFCache events redact private DOM; late preview after real unmount cannot populate the restored composer");
    assert.deepEqual(report.pageErrors, []); report.realWhatsAppRows = await db.whatsAppMessage.count(); assert.equal(report.realWhatsAppRows, 0, "No WhatsApp write reaches even the fixture server");
    assert.equal(await db.whatsAppAttachment.count(), 0, "PDF upload was transport-only synthetic");
    await page.screenshot({ path: join(out, "terminal-inbox.png"), fullPage: true }); assert(!logs.includes("WHATSAPP_FIXTURE_EXTERNAL_FETCH_BLOCKED"), "No server provider/external fetch may be attempted"); report.passed = true;
    console.log(`PASS actual WhatsApp inbox: ${report.checks.length} interrupted/repeated journey groups; zero server message/attachment writes.`);
  } catch (error) { report.failure = String(error); throw error; }
}, async () => {
  if (held) await releaseHeld().catch(() => {});
  await page?.screenshot({ path: join(out, "final-state.png"), fullPage: true }).catch(() => {});
  await browser?.close(); await stopFixtureChild(server); await db.$disconnect();
  await writeFile(join(out, "server.log"), logs); await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2)); await rm(dir, { recursive: true, force: true });
});
