import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { emptyPackage } from "../src/lib/travel-packages";
const { chromium } = await import("./browser.mjs");
const dir = mkdtempSync(path.join(tmpdir(), "crm-package-browser-"));
const databaseUrl = `file:${path.join(dir, "fixture.db")}`, origin = "http://127.0.0.1:3248";
const env = { ...process.env, DATABASE_URL: databaseUrl, APP_ORIGIN: origin, JWT_SECRET: randomBytes(48).toString("hex"), WA_PROVIDER: "manual" };
const migration = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, encoding: "utf8" }); assert.equal(migration.status, 0, migration.stderr);
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const password = randomBytes(24).toString("hex");
const role = await db.role.create({ data: { key: "OWNER", name: "Owner", desc: "Fixture" } });
await db.user.create({ data: { employeeCode: "PKG-OWNER", name: "Package fixture owner", email: "owner@example.test", phone: "", passwordHash: await bcrypt.hash(password, 10), roleId: role.id } });
const managerRole = await db.role.create({ data: { key: "BRANCH_MANAGER", name: "Branch manager", desc: "Fixture" } });
const branch = await db.branch.create({ data: { name: "Fixture branch", code: "PKG", city: "Test" } });
await db.user.create({ data: { employeeCode: "PKG-BRANCH", name: "Branch fixture", email: "branch@example.test", phone: "", passwordHash: await bcrypt.hash(password, 10), roleId: managerRole.id, branchId: branch.id } });
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3248", "-H", "127.0.0.1"], { env, stdio: ["ignore", "pipe", "pipe"] });
let logs = ""; server.stdout.on("data", s => logs += s); server.stderr.on("data", s => logs += s);
const output = path.resolve("test-artifacts/travel-packages"); mkdirSync(output, { recursive: true });
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
try {
  let ready = false; for (let i = 0; i < 80; i++) { try { if ((await fetch(origin + "/api/health")).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 500)); } assert(ready, logs);
  assert.equal((await fetch(origin + "/api/travel-packages")).status, 401);
  async function login(email: string) { const r = await fetch(origin + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ email, password }) }); assert.equal(r.status, 200); return r.headers.get("set-cookie")!.split(";")[0]; }
  const ownerCookie = await login("owner@example.test"), branchCookie = await login("branch@example.test");
  assert.equal((await fetch(origin + "/api/travel-packages", { headers: { Cookie: branchCookie } })).status, 403);
  assert.equal((await fetch(origin + "/api/travel-packages", { method: "POST", headers: { Cookie: branchCookie, "Content-Type": "application/json", Origin: origin }, body: "{}" })).status, 403);
  const apiDraft = { ...emptyPackage, title: "HTTP contract fixture", destination: "Test region", summary: "Synthetic package", description: "Only an isolated fixture.", itinerary: [{ day: 1, title: "Fixture day", description: "No real travel." }], inclusions: ["Fixture inclusion"], exclusions: ["Fixture exclusion"], terms: "Fixture terms", cancellationPolicy: "Fixture policy", availabilityNotes: "On request only", contactEmail: "fixture@example.test", internalNotes: "PRIVATE HTTP FIELD" };
  async function mutate(id: string | null, body: unknown, cookie = ownerCookie, requestOrigin = origin) {
    const response = await fetch(origin + "/api/travel-packages" + (id ? `/${id}` : ""), { method: id ? "PATCH" : "POST", headers: { Cookie: cookie, "Content-Type": "application/json", Origin: requestOrigin }, body: JSON.stringify(body) });
    return { response, body: await response.json() };
  }
  assert.equal((await mutate(null, { slug: "http-fixture", draft: apiDraft }, ownerCookie, "https://cross-site.example")).response.status, 403);
  let api = await mutate(null, { slug: "http-fixture", draft: apiDraft }); assert.equal(api.response.status, 201, JSON.stringify(api.body)); let apiItem = api.body.package;
  assert.equal((await fetch(origin + `/api/travel-packages/${apiItem.id}`, { headers: { Cookie: branchCookie } })).status, 403);
  const metadata = await (await fetch(origin + "/api/travel-packages", { headers: { Cookie: ownerCookie } })).json(); assert(!("draft" in metadata.packages[0]));
  api = await mutate(apiItem.id, { action: "PUBLISH", slug: apiItem.slug, draft: apiDraft, revision: apiItem.revision }); assert.equal(api.response.status, 200, JSON.stringify(api.body)); apiItem = api.body.package;
  let live = await (await fetch(origin + "/api/public/travel-packages/http-fixture")).json(); assert.equal(live.package.title, apiDraft.title); assert(!JSON.stringify(live).includes("PRIVATE"));
  const summary = await (await fetch(origin + "/api/public/travel-packages")).json(); assert(!("itinerary" in summary.packages[0])); assert(!("contactEmail" in summary.packages[0]));
  assert.equal((await mutate(apiItem.id, { action: "SAVE", slug: apiItem.slug, draft: apiDraft, revision: 1 })).response.status, 409);
  api = await mutate(apiItem.id, { slug: apiItem.slug, draft: { ...apiDraft, title: "HTTP changed private draft" }, revision: apiItem.revision }); assert.equal(api.response.status, 200); apiItem = api.body.package;
  live = await (await fetch(origin + "/api/public/travel-packages/http-fixture")).json(); assert.equal(live.package.title, apiDraft.title);
  for (const action of ["UNPUBLISH", "ARCHIVE", "RESTORE"]) { api = await mutate(apiItem.id, { action, revision: apiItem.revision }); assert.equal(api.response.status, 200); apiItem = api.body.package; assert.equal((await fetch(origin + "/api/public/travel-packages/http-fixture")).status, 404); }
  assert.equal(apiItem.status, "DRAFT"); await db.travelPackage.delete({ where: { id: apiItem.id } });
  console.log("Package HTTP: auth/branch/CSRF denial, draft create, metadata-only listing, publish, summary projection, stale409, draft isolation, unpublish404 and archive/restore passed.");
  if (!process.argv.includes("--http-only")) {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: "tos_session", value: ownerCookie.split("=")[1], url: origin }]);
  const page = await context.newPage(); const errors: string[] = []; page.on("pageerror", (e: Error) => errors.push(e.message));
  await page.goto(origin + "/travel-packages");
  await page.getByText("Your next great trip starts here").waitFor();
  await page.getByRole("button", { name: "+ Create package", exact: true }).click();
  await page.getByLabel("Package title", { exact: true }).fill("Kerala discovery");
  await page.getByLabel("Public URL slug", { exact: false }).fill("kerala-discovery");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByText("Draft saved. Any published version is unchanged.").waitFor();
  let row = await db.travelPackage.findUniqueOrThrow({ where: { slug: "kerala-discovery" } });
  assert.equal(row.status, "DRAFT"); assert.equal((await fetch(origin + "/api/public/travel-packages/kerala-discovery")).status, 404);
  const fullDraft = { ...emptyPackage, title: "Kerala discovery", destination: "Kerala", summary: "Slow days along the backwaters", description: "A locally planned journey with time to explore.", itinerary: [{ day: 1, title: "Arrive and unwind", description: "Local arrival transfer and time at leisure." }], inclusions: ["Arrival transfer"], exclusions: ["Flights"], terms: "Final quote must be accepted before payment.", cancellationPolicy: "Supplier cancellation terms apply to the confirmed quote.", availabilityNotes: "Dates and accommodation are subject to confirmation.", contactEmail: "travel@example.test", internalNotes: "PRIVATE never public" };
  const update = await fetch(origin + `/api/travel-packages/${row.id}`, { method: "PATCH", headers: { Cookie: ownerCookie, "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ slug: row.slug, draft: fullDraft, revision: row.revision }) }); assert.equal(update.status, 200);
  await page.reload(); await page.getByRole("button", { name: /Kerala discovery.*Kerala/ }).click();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByText("Required content is complete.", { exact: false }).waitFor();
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Publish to website", exact: true }).click();
  await page.getByText("Published version is available to the website. Open the customer page to verify it.").waitFor();
  const publicResponse = await fetch(origin + "/api/public/travel-packages/kerala-discovery"); assert.equal(publicResponse.status, 200); assert(!(await publicResponse.text()).includes("PRIVATE"));
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByLabel("Package title", { exact: true }).fill("Kerala new draft");
  page.once("dialog", dialog => dialog.dismiss()); await page.getByRole("button", { name: "Close editor", exact: true }).click();
  assert.equal(await page.getByLabel("Package title", { exact: true }).inputValue(), "Kerala new draft");
  page.once("dialog", dialog => dialog.dismiss()); await page.getByRole("link", { name: "Agency pulse", exact: true }).click(); assert(page.url().endsWith("/travel-packages"));
  await page.getByRole("button", { name: "Save draft", exact: true }).click(); await page.getByText("Draft saved. Any published version is unchanged.").waitFor();
  assert.equal((await (await fetch(origin + "/api/public/travel-packages/kerala-discovery")).json()).package.title, "Kerala discovery");
  const viewportEvidence: unknown[] = [];
  for (const [device, width, height] of [["desktop",1440,1000],["mobile",390,844]] as const) {
    await page.setViewportSize({width,height});
    const menu = page.getByRole("button", {name:"Open navigation",exact:true});
    if (await menu.isVisible() && await menu.getAttribute("aria-expanded") === "true") await page.getByRole("button",{name:"Close navigation",exact:true}).last().click();
    if (device === "mobile") assert.equal(await menu.getAttribute("aria-expanded"),"false","Mobile navigation must be closed for editor evidence");
    const editorHeading = page.locator('h2[tabindex="-1"]');
    await editorHeading.focus();
    await editorHeading.evaluate(node => node.scrollIntoView({block:"center",behavior:"instant"}));
    await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
    await page.waitForTimeout(300);
    const headingBox = await editorHeading.boundingBox();
    assert(headingBox && headingBox.y >= 0 && headingBox.y + headingBox.height <= height,"Editor heading must be in actual viewport");
    await page.screenshot({path:path.join(output,`editor-${device}.png`),fullPage:false,animations:"disabled"});
    const saveButton = page.getByRole("button",{name:"Save draft",exact:true});
    await saveButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const actionBox = await saveButton.boundingBox();
    assert(actionBox && actionBox.x >= 0 && actionBox.x + actionBox.width <= width && actionBox.y >= 0 && actionBox.y + actionBox.height <= height,"Save action must be inside the actual viewport");
    await page.screenshot({path:path.join(output,`editor-actions-${device}.png`),fullPage:false,animations:"disabled"});
    viewportEvidence.push({device,width,height,headingBox,actionBox,navigationClosed:device!=="mobile"||await menu.getAttribute("aria-expanded")==="false"});
  }
  writeFileSync(path.join(output,"editor-viewport-geometry.json"),JSON.stringify(viewportEvidence,null,2));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "No horizontal mobile overflow");
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Unpublish", exact: true }).click(); await page.getByText("No longer publicly available from the catalogue. Your draft is retained.").waitFor();
  assert.equal((await fetch(origin + "/api/public/travel-packages/kerala-discovery")).status, 404);
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Archive", exact: true }).click(); await page.getByRole("button", { name: "Restore as draft", exact: true }).waitFor();
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Restore as draft", exact: true }).click(); await page.getByText("Restored as a private draft.").waitFor();
  await page.getByRole("button", { name: "Close editor", exact: true }).click();
  await page.route("**/api/travel-packages", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Fixture catalogue failure" }) }));
  await page.reload(); await page.getByRole("heading", { name: "Catalogue unavailable", exact: true }).waitFor(); assert.equal(await page.getByText("Your next great trip starts here").count(), 0);
  await page.unroute("**/api/travel-packages"); await page.getByRole("button", { name: "Retry loading", exact: true }).click(); await page.getByRole("button", { name: /Kerala new draft/ }).waitFor();
  assert.deepEqual(errors, []); row = await db.travelPackage.findUniqueOrThrow({ where: { id: row.id } }); assert.equal(row.status, "DRAFT");
  console.log("Package browser: anonymous/branch denial, private create, publish, draft isolation, dirty cancel/navigation, mobile no-overflow, unpublish/archive/restore and honest load failure passed.");
  }
} finally {
  writeFileSync(path.join(output, "server.log"), logs); await browser?.close(); server.kill("SIGTERM"); await new Promise<void>(r => server.once("exit", () => r())); await db.$disconnect(); rmSync(dir, { recursive: true, force: true });
}
