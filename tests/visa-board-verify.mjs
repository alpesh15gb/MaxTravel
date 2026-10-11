// Browser acceptance for the visa pipeline board. Isolated DB/server on its own port; no live data touched.
import assert from "node:assert/strict";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, createWriteStream } from "node:fs";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { PrismaClient } from "@prisma/client";
import { chromium } from "./browser.mjs";
const ROOT = process.cwd();
const runtime = path.join(ROOT, "tests", ".runtime", `visa-board-${Date.now()}`);
mkdirSync(runtime, { recursive: true });
const database = `file:${path.join(runtime, "test.db").replaceAll("\\", "/")}`;
const PORT = 3213;
await new Promise((resolve, reject) => { const s = net.createServer(); s.once("error", reject); s.listen(PORT, "127.0.0.1", () => s.close(resolve)); });
const BASE = `http://127.0.0.1:${PORT}`;
const password = `Board-${randomBytes(15).toString("hex")}!`;
const env = { ...process.env, DATABASE_URL: database, JWT_SECRET: randomBytes(32).toString("hex"), UPLOAD_ROOT: path.join(runtime, "uploads"), NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? ".next" };
const prisma = new PrismaClient({ datasources: { db: { url: database } } });
const log = createWriteStream(path.join(runtime, "server.log"));
execFileSync(process.execPath, [path.join(ROOT, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: ROOT, env, stdio: "pipe" });
const server = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "--port", String(PORT), "--hostname", "127.0.0.1"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.pipe(log); server.stderr.pipe(log);
for (let i = 0; i < 100; i++) { if (server.exitCode !== null) throw new Error(`Server exited ${server.exitCode}`); try { const r = await fetch(`${BASE}/setup`); if (r.ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }

const results = []; let passed = 0; let browser;
async function check(name, fn) {
  try { const note = await fn(); results.push({ name, status: "PASS", note: typeof note === "string" ? note : undefined }); passed++; console.log(`PASS ${name}`); }
  catch (e) { results.push({ name, status: "FAIL", error: e.message }); console.log(`FAIL ${name}: ${e.message.slice(0, 1500)}`); }
}
const post = (url, body, cookie = "") => fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
async function ok(url, body, cookie) { const r = await post(url, body, cookie); const d = await r.json(); assert(r.ok, `${url}: ${r.status} ${JSON.stringify(d)}`); return d; }

try {
  // Seed: owner, two customers with one applicant each, a checklist with a required passport, two visa cases.
  const setup = await post("/api/setup", { agencyName: "Board Verify Agency", city: "Pune", name: "Board Owner", email: "owner@board.test", password });
  assert.equal(setup.status, 201, await setup.text());
  const login = await post("/api/auth/login", { email: "owner@board.test", password });
  const owner = login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  const alpha = await ok("/api/customers", { name: "Board Alpha Customer", phone: "+919000000101", email: "alpha@board.test" }, owner);
  const beta = await ok("/api/customers", { name: "Board Beta Customer", phone: "+919000000102" }, owner);
  const alphaTraveller = await prisma.traveller.findFirstOrThrow({ where: { customerId: alpha.id } });
  const betaTraveller = await prisma.traveller.findFirstOrThrow({ where: { customerId: beta.id } });
  const checklist = await ok("/api/checklists", { country: "Boardland", visaType: "Tourist", applicantType: "STANDARD", items: [{ name: "Passport", required: true, fileTypes: "pdf", maxSizeMb: 1, needsVerification: true }] }, owner);
  const caseA = await ok("/api/visa/cases", { customerId: alpha.id, travellerIds: [alphaTraveller.id], destination: "Boardland", visaType: "Tourist", checklistId: checklist.checklist.id, visaFee: 80, serviceFee: 20 }, owner);
  const caseB = await ok("/api/visa/cases", { customerId: beta.id, travellerIds: [betaTraveller.id], destination: "Boardland", visaType: "Tourist", checklistId: checklist.checklist.id, visaFee: 80, serviceFee: 20 }, owner);
  const stageKeyOf = async caseId => (await prisma.visaCase.findUniqueOrThrow({ where: { id: caseId }, include: { stage: true } })).stage.key;
  const waitForStage = async (caseId, key) => { for (let i = 0; i < 40; i++) { if (await stageKeyOf(caseId) === key) return; await new Promise(r => setTimeout(r, 150)); } assert.equal(await stageKeyOf(caseId), key, "stage did not persist"); };

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const pageErrors = [];
  page.on("pageerror", e => pageErrors.push(e.message));
  const board = title => page.locator(`section[aria-label="${title}"]`);
  const cardFor = name => page.locator("article", { hasText: name });
  // The board steps one stage at a time, and the button sits at the bottom of a card inside a
  // scrollable column — so scroll it into view before clicking rather than relying on the click's
  // own auto-scroll to make the element visible in the same frame.
  const advance = async (name, stage) => {
    const button = cardFor(name).getByRole("button", { name: `Move to ${stage}`, exact: true });
    await button.scrollIntoViewIfNeeded();
    await button.click();
  };

  await page.goto(`${BASE}/login`);
  await page.getByLabel("Work email", { exact: true }).fill("owner@board.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in to workspace", exact: true }).click();
  await page.waitForURL("**/dashboard");

  // Four columns, not five: the closed stage joined the decision column, and the empty columns no
  // longer render a full-height slab. Both are asserted here because both were the reported defects.
  await check("Board renders four numbered groups with live counts and clear empty states", async () => {
    await page.goto(`${BASE}/visa`);
    for (const title of ["Enquiry & assessment", "Documents", "Appointment & submission", "Decision & delivery"]) await board(title).waitFor();
    assert.equal(await page.locator(".board-scroll > section").count(), 4, "the board draws four columns");
    assert.equal(await board("Enquiry & assessment").locator("article").count(), 2, "both new cases start at Enquiry");
    await board("Enquiry & assessment").getByLabel("2 cases").waitFor();
    // An empty column is its header strip only: no card, and no body to hold a dashed placeholder.
    const emptyColumn = board("Appointment & submission");
    assert.equal(await emptyColumn.getAttribute("data-empty"), "true", "a column with no cases is marked empty");
    assert.equal(await emptyColumn.locator("article").count(), 0);
    assert.equal(await emptyColumn.locator(".board-column-body").isVisible(), true, "an empty column explains the absence of matching work");
    await emptyColumn.getByText("No matching cases at this step.").waitFor();
    const emptyHeight = await emptyColumn.evaluate(el => Math.round(el.getBoundingClientRect().height));
    const busyHeight = await board("Enquiry & assessment").evaluate(el => Math.round(el.getBoundingClientRect().height));
    assert(emptyHeight < 250, `an empty column has a concise explanation, not a ${emptyHeight}px empty slab`);
    assert(busyHeight > 200, `a populated column carries its cards (${busyHeight}px)`);
    return "Four numbered groups; exact stage on cards; empty groups explain that no cases match.";
  });

  await check("List view shows the same cases and Board restores the columns", async () => {
    await page.getByRole("button", { name: "List", exact: true }).click();
    await page.locator("table").waitFor();
    assert.equal(await page.getByRole("link", {name:"Board Alpha Customer",exact:true}).getAttribute("href"), `/customers/${alpha.id}`);
    assert.equal(await page.locator("table tbody tr").count(), 2);
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await board("Enquiry & assessment").waitFor();
    return "Two table rows in List; Board returns.";
  });

  await check("Search narrows the pipeline and reports the count", async () => {
    await page.getByLabel("Search visa cases").fill("Beta");
    await page.getByText("Showing 1 of 2 cases", {exact:false}).waitFor();
    assert.equal(await page.locator("article").count(), 1);
    await page.getByLabel("Search visa cases").fill("");
    await page.getByText("Showing 2 of 2 cases").waitFor();
    return "Search by customer name filters to one card and clears back.";
  });

  await check("Stage control advances one step, persists, and the card follows its column", async () => {
    // The card used to carry a select listing all 16 stages, which duplicated the columns in a second
    // vocabulary. It now advances one named stage; dragging still moves anywhere, and the case page
    // owns the full stage menu.
    await advance("Board Alpha Customer", "Assessment");
    await page.getByText("moved to Assessment").waitFor();
    await waitForStage(caseA.caseId, "ASSESSMENT");
    await advance("Board Alpha Customer", "Payment awaited");
    await waitForStage(caseA.caseId, "PAYMENT_AWAITED");
    await advance("Board Alpha Customer", "Documents pending");
    await waitForStage(caseA.caseId, "DOCUMENTS_PENDING");
    await board("Documents").locator("article", { hasText: "Board Alpha Customer" }).waitFor();
    return "Alpha advanced Enquiry → Assessment → Payment awaited → Documents pending and the Documents column shows it.";
  });

  await check("Dragging a card onto a column moves it", async () => {
    await cardFor("Board Beta Customer").dragTo(board("Documents"));
    await waitForStage(caseB.caseId, "DOCUMENTS_PENDING");
    await board("Documents").locator("article", { hasText: "Board Beta Customer" }).waitFor();
    return "Beta dragged into Documents; stage persisted at its first stage.";
  });

  await check("Readiness gate refuses submission with missing documents and says why", async () => {
    await advance("Board Alpha Customer", "Document review");
    await waitForStage(caseA.caseId, "DOCUMENTS_VERIFICATION");
    const response = page.waitForResponse(r => r.url().includes(`/api/visa/cases/${caseA.caseId}/stage`));
    await advance("Board Alpha Customer", "Ready for submission");
    const r = await response;
    assert.equal(r.status(), 400);
    await page.getByText("Complete and verify required documents before submission").waitFor();
    assert.equal(await stageKeyOf(caseA.caseId), "DOCUMENTS_VERIFICATION", "the refused move was not applied");
    // The optimistic card state reverts, so the same button offers the same (refused) step again.
    await cardFor("Board Alpha Customer").getByRole("button", { name: "Move to Ready for submission", exact: true }).scrollIntoViewIfNeeded();
    return "400 from the stage gate; error shown; case stays at Documents verification and the card reverts.";
  });

  await check("Stage filter and empty state", async () => {
    await page.getByLabel("Filter by stage").selectOption("ENQUIRY");
    await page.getByText("No cases match this view").waitFor();
    await page.getByLabel("Filter by stage").selectOption("");
    await page.getByText("Showing 2 of 2 cases").waitFor();
    return "Filtering to an empty stage shows the empty state; clearing restores both cases.";
  });

  await check("Pipeline screenshot and clean client console", async () => {
    await page.getByLabel("Filter by stage").selectOption("");
    await board("Documents").locator("article").first().waitFor();
    await page.screenshot({ path: path.join(ROOT, "test-artifacts", "implementation", "visa-board.png") });
    assert.deepEqual(pageErrors, [], `client errors: ${pageErrors.join(" | ")}`);
    return "Board screenshot saved; no uncaught client errors.";
  });
  await check("Phone board stacks readable steps without horizontal or nested scrolling", async () => {
    await page.setViewportSize({width:390,height:844});
    await page.goto(`${BASE}/visa`);
    const lanes=page.locator(".workflow-board > section");
    assert.equal(await lanes.count(),4);
    const boxes=await lanes.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width};}));
    assert(boxes.every(b=>b.x>=0&&b.x+b.width<=391));
    assert(boxes[1].y>boxes[0].y);
    const overflow=await page.locator(".workflow-board").evaluate(el=>el.scrollWidth>el.clientWidth);
    assert.equal(overflow,false);
    await page.screenshot({path:path.join(ROOT,"test-artifacts","implementation","visa-board-phone.png"),fullPage:true});
  });
  await check("Customer board shows contact details, clear groups and working customer links", async () => {
    await page.goto(`${BASE}/customers`);
    await page.getByRole("button",{name:"Board",exact:true}).click();
    const customerBoard=page.getByLabel("Customers by status",{exact:true});
    assert.equal(await customerBoard.locator("section").count(),3);
    const card=customerBoard.locator("article",{hasText:"Board Alpha Customer"});
    assert.equal(await card.getByRole("link",{name:"Open customer",exact:true}).getAttribute("href"),`/customers/${alpha.id}`);
    await card.getByRole("link",{name:"+919000000101",exact:true}).waitFor();
    assert.equal(await customerBoard.evaluate(el=>el.scrollWidth>el.clientWidth),false);
    await page.screenshot({path:path.join(ROOT,"test-artifacts","implementation","customer-board-phone.png"),fullPage:true});
    await page.setViewportSize({width:1440,height:900});
    await page.goto(`${BASE}/customers`,{waitUntil:"networkidle"});
    await page.getByRole("button",{name:"Board",exact:true}).click();
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(ROOT,"test-artifacts","implementation","customer-board.png")});
  });
  await context.close();
} finally {
  if (browser) await browser.close();
  server.kill();
  await prisma.$disconnect();
  mkdirSync(path.join(ROOT, "test-artifacts", "implementation"), { recursive: true });
  writeFileSync(path.join(ROOT, "test-artifacts", "implementation", "visa-board-verify.json"), JSON.stringify(results, null, 2));
  console.log(`\n${passed}/${results.length} visa board checks passed`);
}
process.exit(results.some(r => r.status === "FAIL") || results.length === 0 ? 1 : 0);
