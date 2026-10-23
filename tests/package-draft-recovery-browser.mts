// Called by the existing package browser suite against its disposable SQLite fixture.
// Back/Forward are real traversals; there are deliberately no history shims.
import assert from "node:assert/strict";
import type { Browser, Page, Route } from "playwright";
import type { PrismaClient } from "@prisma/client";
import { emptyPackage } from "../src/lib/travel-packages";

type Fixture = { browser: Browser; db: PrismaClient; origin: string; ownerCookie: string; login: (email: string) => Promise<string> };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
export async function packageDraftRecoveryBrowser({ browser, db, origin, ownerCookie, login }: Fixture) {
  async function start(name: string, width = 1440, unsavedNew = false) {
    const title = `Recovery fixture ${name}`, slug = `recovery-${name}`;
    const draft = { ...structuredClone(emptyPackage), title, destination: "Synthetic destination", summary: "Fixture summary", description: "Fixture description", itinerary: [{ day: 1, title: "Fixture day", description: "Fixture plan" }], inclusions: ["Fixture included"], exclusions: ["Fixture excluded"], terms: "Fixture terms", cancellationPolicy: "Fixture cancellation", availabilityNotes: "On request", contactEmail: "fixture@example.test" };
    const item = unsavedNew ? null : await db.travelPackage.create({ data: { slug, title, draftJson: JSON.stringify(draft) } });
    const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 1000 }, serviceWorkers: "block" });
    context.setDefaultTimeout(15000); context.setDefaultNavigationTimeout(30000);
    await context.addCookies([{ name: "tos_session", value: ownerCookie.split("=")[1], url: origin }]);
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"));
    const page = await context.newPage(), errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (/^\/api\/travel-packages(?:\/[^/]+)?$/.test(new URL(request.url()).pathname) && ["POST", "PATCH"].includes(request.method())) writes.push(request.method()); });
    await page.goto(origin + "/sales");
    const menu = page.getByRole("button", { name: "Open navigation", exact: true }); if (await menu.isVisible()) await menu.click();
    const group = page.getByRole("button", { name: "Catalogue", exact: true }); if (await group.getAttribute("aria-expanded") !== "true") await group.click();
    await page.locator("#workspace-navigation").getByRole("link", { name: "Travel packages", exact: true }).click();
    await page.waitForURL("**/travel-packages");
    if (unsavedNew) { await page.getByRole("button", { name: "+ Create package", exact: true }).click(); await page.getByLabel("Public URL slug", { exact: false }).fill(slug); }
    else await page.getByRole("button", { name: new RegExp(title + ".*Synthetic destination") }).click();
    const secret = `Unsaved ${name} last-keystroke-Z`;
    await page.getByLabel("Package title", { exact: true }).fill(secret.slice(0, -1)); await page.getByLabel("Package title", { exact: true }).press("End"); await page.keyboard.type("Z");
    return { page, context, item, secret, slug, errors, writes, async close() { assert.deepEqual(errors, []); await context.close(); } };
  }
  const state = (page: Page, kind: string) => page.locator(`section[aria-label="Retained package draft"][data-recovery-state="${kind}"]`).waitFor();
  async function back(page: Page) { await page.goBack({ waitUntil: "domcontentloaded" }); await page.waitForURL("**/sales"); }
  async function forward(page: Page) { await page.goForward({ waitUntil: "domcontentloaded" }); await page.waitForURL("**/travel-packages"); }
  const restore = (page: Page) => page.getByRole("button", { name: "Restore package edits", exact: true }).click();
  async function section(page: Page, name: string) { const select = page.getByLabel("Edit section", { exact: true }); if (await select.isVisible()) await select.selectOption(name); else await page.getByRole("button", { name, exact: true }).click(); }
  async function noText(page: Page, secret: string) { assert(await page.evaluate(value => !document.body.innerText.includes(value) && !Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea")).some(node => node.getClientRects().length && node.value.includes(value)), secret), "Unchecked/denied retained text must stay hidden"); }
  async function discard(page: Page) { page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "Discard retained package copy", exact: true }).click(); await page.getByRole("region", { name: "Retained package draft", exact: true }).waitFor({ state: "hidden" }); }

  for (const [name, width, isNew] of [["desktop", 1440, false], ["mobile-new", 390, true]] as const) {
    const s = await start(name, width, isNew);
    const otherTab = await s.context.newPage(); await otherTab.goto(origin + "/travel-packages"); await otherTab.getByRole("button", { name: "+ Create package", exact: true }).waitFor();
    assert.equal(await otherTab.getByRole("region", { name: "Retained package draft", exact: true }).count(), 0, "A second tab never inherits draft memory"); await otherTab.close();
    for (let i = 0; i < 2; i++) {
      await back(s.page); await forward(s.page); await state(s.page, "ready"); await noText(s.page, s.secret);
      assert.equal(await s.page.getByLabel("Package title", { exact: true }).count(), 0, "Activity editor is hidden until explicit Restore");
      await restore(s.page); assert.equal(await s.page.getByLabel("Package title", { exact: true }).inputValue(), s.secret);
      assert.equal(s.writes.length, 0, "Navigation and explicit restoration never save or publish");
    }
    const storage = await s.page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })); assert(!storage.includes(s.secret));
    s.page.once("dialog", dialog => dialog.accept()); await s.page.getByRole("button", { name: "Close editor", exact: true }).click();
    await back(s.page); await forward(s.page); await s.page.getByRole("button", { name: "+ Create package", exact: true }).waitFor();
    assert.equal(await s.page.getByRole("region", { name: "Retained package draft", exact: true }).count(), 0, "Explicit close clears recovery");
    assert.equal(s.writes.length, 0); await s.close();
  }
  {
    const s = await start("stale-and-deleted"); await back(s.page);
    await db.travelPackage.update({ where: { id: s.item!.id }, data: { revision: { increment: 1 }, status: "ARCHIVED" } });
    await forward(s.page); await state(s.page, "stale"); assert.equal(await s.page.getByRole("button", { name: "Restore package edits", exact: true }).count(), 0);
    await s.page.getByText("Read retained text without applying it", { exact: true }).click(); await s.page.getByText(s.secret, { exact: false }).last().waitFor();
    await s.page.route(`**/api/travel-packages/${s.item!.id}`, route => route.abort("failed"));
    await s.page.getByRole("button", { name: "Review latest package", exact: true }).click(); await state(s.page, "unavailable"); await noText(s.page, s.secret);
    await s.page.unroute(`**/api/travel-packages/${s.item!.id}`); await db.travelPackage.delete({ where: { id: s.item!.id } });
    await s.page.getByRole("button", { name: "Retry package recovery check", exact: true }).click();
    await s.page.getByText("The retained copy was cleared because this package is no longer available.", { exact: true }).waitFor(); await noText(s.page, s.secret); assert.equal(s.writes.length, 0); await s.close();
  }
  {
    const s = await start("restore-read-navigation"); await back(s.page); await forward(s.page); await state(s.page, "ready");
    const held = deferred(), release = deferred(); let once = true;
    await s.page.route(`**/api/travel-packages/${s.item!.id}`, async route => { if (!once || route.request().method() !== "GET") return route.fallback(); once = false; const response = await route.fetch(); held.resolve(); await release.promise; await route.fulfill({ response }); });
    await restore(s.page); await held.promise; await back(s.page); await forward(s.page); await state(s.page, "ready");
    release.resolve(); await restore(s.page); assert.equal(await s.page.getByLabel("Package title", { exact: true }).inputValue(), s.secret, "Back during Restore does not strand the read-only recoveryBusy lock");
    assert.equal(s.writes.length, 0); await s.close();
  }
  {
    const s = await start("pending-save"); const held = deferred(), release = deferred();
    await s.page.route(`**/api/travel-packages/${s.item!.id}`, async route => { if (route.request().method() !== "PATCH") return route.fallback(); const response = await route.fetch(); held.resolve(); await release.promise; await route.fulfill({ response }); });
    await s.page.getByRole("button", { name: "Save draft", exact: true }).click(); await held.promise;
    await back(s.page); await forward(s.page); await state(s.page, "pending");
    assert(await s.page.getByRole("button", { name: "Discard retained package copy", exact: true }).isDisabled()); assert.equal(s.writes.length, 1);
    release.resolve(); await s.page.getByRole("region", { name: "Retained package draft", exact: true }).waitFor({ state: "hidden" });
    await s.page.getByRole("button", { name: new RegExp(s.secret + ".*Synthetic destination") }).waitFor();
    assert.equal(await s.page.getByLabel("Package title", { exact: true }).count(), 0, "Late acknowledged save does not reopen hidden editor"); assert.equal(s.writes.length, 1); await s.close();
  }
  for (const action of ["Save draft", "Publish to website"]) {
    const s = await start(action === "Save draft" ? "malformed-save" : "malformed-publish");
    await s.page.route(`**/api/travel-packages/${s.item!.id}`, async route => { if (route.request().method() !== "PATCH") return route.fallback(); const response = await route.fetch(); const body = await response.json(); await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ recoveryContext: body.recoveryContext }) }); });
    if (action === "Publish to website") s.page.once("dialog", dialog => dialog.accept());
    await s.page.getByRole("button", { name: action, exact: true }).click(); await state(s.page, "unknown");
    assert.equal(await s.page.getByRole("button", { name: "Restore package edits", exact: true }).count(), 0, "Malformed committed 2xx stays read-only, including publication"); assert.equal(s.writes.length, 1);
    const saved = await db.travelPackage.findUniqueOrThrow({ where: { id: s.item!.id } }); assert.equal(saved.revision, s.item!.revision + 1);
    if (action === "Publish to website") assert.equal(saved.status, "PUBLISHED");
    await s.page.route("**/api/auth/logout", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Fixture logout failure" }) }));
    const logout = s.page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/logout"); await s.page.getByRole("button", { name: "Account menu", exact: true }).click(); await s.page.getByRole("menuitem", { name: "Sign out", exact: true }).click(); assert.equal((await logout).status(), 503); await state(s.page, "unknown");
    assert.equal(await s.page.getByRole("button", { name: "+ Create package", exact: true }).isEnabled(), false, "Failed logout cannot retire an unknown-action barrier");
    await discard(s.page); assert.equal(s.writes.length, 1); await s.close();
  }
  {
    const s = await start("unsafe-images"); await section(s.page, "Images"); await s.page.getByLabel("Cover image URL", { exact: true }).fill("https://private.example/preview?token=never-retain");
    await back(s.page); await forward(s.page); await state(s.page, "ready"); await restore(s.page);
    assert.equal(await s.page.getByLabel("Cover image URL", { exact: true }).inputValue(), "");
    await s.page.getByRole("button", { name: "Save draft", exact: true }).click(); assert.equal(s.writes.length, 0);
    await section(s.page, "Overview"); await s.page.getByLabel("Package title", { exact: true }).fill(s.secret + " edited");
    await back(s.page); await forward(s.page); await state(s.page, "ready"); await restore(s.page); await section(s.page, "Images");
    await s.page.getByRole("button", { name: "Publish to website", exact: true }).click(); assert.equal(s.writes.length, 0, "Unrelated edits/navigation cannot erase omitted-image review gate");
    await s.page.getByRole("button", { name: "I reviewed the image fields", exact: true }).click();
    await s.page.getByRole("button", { name: "Save draft", exact: true }).click(); await s.page.getByText("Draft saved. Any published version is unchanged.", { exact: true }).waitFor(); assert.equal(s.writes.length, 1);
    await back(s.page); await forward(s.page); await s.page.getByRole("button", { name: "+ Create package", exact: true }).waitFor(); assert.equal(await s.page.getByRole("region", { name: "Retained package draft", exact: true }).count(), 0, "Acknowledged save clears recovery"); await s.close();
  }
  for (const kind of ["held-ack", "held-read"] as const) {
    const s = await start(kind), held = deferred(), release = deferred(); let once = true;
    if (kind === "held-read") { await back(s.page); await forward(s.page); await state(s.page, "ready"); }
    await s.page.route(`**/api/travel-packages/${s.item!.id}`, async (route: Route) => { if (!once || route.request().method() !== (kind === "held-ack" ? "PATCH" : "GET")) return route.fallback(); once = false; const response = await route.fetch(); held.resolve(); await release.promise; await route.fulfill({ response }); });
    if (kind === "held-ack") await s.page.getByRole("button", { name: "Save draft", exact: true }).click(); else await restore(s.page);
    await held.promise;
    const newCookie = await login("owner@example.test"); await s.context.addCookies([{ name: "tos_session", value: newCookie.split("=")[1], url: origin }]);
    if (kind === "held-read") { await back(s.page); await forward(s.page); }
    release.resolve();
    await s.page.getByText(/Staff session or (package )?access changed\./).first().waitFor(); await noText(s.page, s.secret);
    assert.equal(await s.page.getByRole("button", { name: "Restore package edits", exact: true }).count(), 0);
    assert.equal(await s.page.getByLabel("Package title", { exact: true }).count(), 0, "Held old-session response cannot reopen old fields");
    assert.equal(s.writes.length, kind === "held-ack" ? 1 : 0); await s.close();
  }
  // Deterministic BFCache lifecycle regression: browsers may elect not to cache
  // a page in CI, so exercise the real persisted event handlers explicitly.
  for (const changedSession of [false, true]) {
    const s = await start(changedSession ? "bfcache-session" : "bfcache-revision");
    await s.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    await noText(s.page, s.secret);
    assert.equal(await s.page.getByLabel("Package title", { exact: true }).count(), 0, "Pagehide removes editor before a BFCache snapshot");
    await db.travelPackage.update({ where: { id: s.item!.id }, data: { revision: { increment: 1 } } });
    if (changedSession) {
      const cookie = await login("owner@example.test"); await s.context.addCookies([{ name: "tos_session", value: cookie.split("=")[1], url: origin }]);
    }
    const held = deferred(), release = deferred(); let once = true;
    await s.page.route("**/api/travel-packages", async route => { if (!once || route.request().method() !== "GET") return route.fallback(); once = false; const response = await route.fetch(); held.resolve(); await release.promise; await route.fulfill({ response }); });
    await s.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await held.promise; await noText(s.page, s.secret);
    assert(await s.page.getByRole("button", { name: "+ Create package", exact: true }).isDisabled(), "BFCache return stays locked until current access is read");
    release.resolve();
    if (changedSession) {
      await s.page.getByText("Staff session or package access changed. Reload this workspace before continuing.", { exact: true }).waitFor(); await noText(s.page, s.secret);
    } else {
      await s.page.getByRole("button", { name: new RegExp(s.item!.title + ".*Synthetic destination") }).click();
      assert.equal(await s.page.getByLabel("Package title", { exact: true }).inputValue(), s.item!.title, "Old unsaved editor cannot reappear from BFCache");
      await s.page.getByText(/Revision 2/).waitFor();
    }
    assert.equal(s.writes.length, 0); await s.close();
  }
  {
    const s = await start("bfcache-unknown");
    await s.page.route(`**/api/travel-packages/${s.item!.id}`, async route => { if (route.request().method() !== "PATCH") return route.fallback(); await route.fetch(); await route.fulfill({ status: 200, contentType: "application/json", body: "{}" }); });
    s.page.once("dialog", dialog => dialog.accept()); await s.page.getByRole("button", { name: "Publish to website", exact: true }).click(); await state(s.page, "unknown");
    await s.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    await noText(s.page, s.secret);
    await s.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await state(s.page, "unknown");
    assert.equal(await s.page.getByText("Read retained text without applying it", { exact: true }).count(), 0, "Cross-document return never retains old private text");
    assert.equal(await s.page.getByRole("button", { name: "Restore package edits", exact: true }).count(), 0);
    assert(await s.page.getByRole("button", { name: "+ Create package", exact: true }).isDisabled(), "Unknown publication remains blocked across BFCache");
    assert.equal(s.writes.length, 1); await discard(s.page); await s.close();
  }
  console.log("Package recovery browser: native Back/Forward, mobile/new/tab isolation, explicit restore/close, last-keystroke, stale/archive/deleted/read failures, held restore, pending/late save, malformed committed save/publication, failed logout, sticky image review, held-response session boundaries, and persisted BFCache fresh-access/unknown-write gates passed.");
}
