import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { chromium } from "./browser.mjs";

const out = path.resolve("test-artifacts/case-workflow");
mkdirSync(out, { recursive: true });
const port = await new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once("error", reject);
  s.listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["tests/visual-review-server.mjs"], {
  windowsHide: true,
  env: {
    ...process.env,
    REVIEW_PORT: String(port),
    REVIEW_DEV: "0",
    APP_ORIGIN: base,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "",
  browser,
  db,
  fixture,
  page;
const future = (days) =>
  new Date(Date.now() + days * 86400000 + 19800000).toISOString().slice(0, 16);
child.stdout.on("data", (c) => (logs += c));
child.stderr.on("data", (c) => (logs += c));
const report = { checks: [], screens: [], errors: [], passed: false };
const save = () => {
  writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(path.join(out, "server.log"), logs);
};
async function login(c, email) {
  const r = await c.request.post(base + "/api/auth/login", {
    data: { email, password: "Review-Visual-2026!" },
  });
  assert(r.ok(), `Login ${email}`);
}
async function shot(name) {
  await page.evaluate(() => document.fonts.ready);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    `${name}: viewport overflow`,
  );
  await page.screenshot({
    path: path.join(out, name + ".png"),
    fullPage: true,
    animations: "disabled",
  });
  report.screens.push(name);
  save();
}
async function action(p, label, note, extra) {
  const d = p.getByRole("dialog");
  await d.getByRole("button", { name: label, exact: true }).click();
  if (note) await d.locator('textarea[name="note"]').fill(note);
  if (extra) await extra(d);
  await d
    .getByRole("button", { name: `Save: ${label.toLowerCase()}`, exact: true })
    .click();
  await d.waitFor({ state: "hidden" });
}
try {
  for (let i = 0; i < 180 && !logs.includes("VISUAL REVIEW READY"); i++) {
    if (child.exitCode !== null) throw Error(logs);
    await new Promise((r) => setTimeout(r, 500));
  }
  assert(logs.includes("VISUAL REVIEW READY"), logs);
  fixture = JSON.parse(
    readFileSync("tests/.runtime/visual-review-current.json", "utf8"),
  );
  assert.equal(fixture.base, base);
  assert(fixture.runtime.startsWith(path.resolve("tests/.runtime") + path.sep));
  db = new PrismaClient({
    datasources: {
      db: {
        url:
          "file:" + path.join(fixture.runtime, "test.db").replaceAll("\\", "/"),
      },
    },
  });
  const owner = await db.user.findUniqueOrThrow({
      where: { email: "review@visual.test" },
    }),
    role = await db.role.findUniqueOrThrow({
      where: { key: "TICKETING_EXECUTIVE" },
    });
  const staff = await db.user.create({
    data: {
      name: "Workflow Staff",
      employeeCode: "WF-BROWSER",
      email: "workflow-staff@visual.test",
      phone: "",
      passwordHash: owner.passwordHash,
      roleId: role.id,
      branchId: null,
    },
  });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    timezoneId: "UTC",
  });
  await context.route("**/*", (r) =>
    new URL(r.request().url()).origin === base ? r.continue() : r.abort(),
  );
  await login(context, owner.email);
  page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.goto(base + "/cases", { waitUntil: "networkidle" });
  await page
    .getByRole("main")
    .getByRole("button", { name: "New Max ID", exact: true })
    .click();
  let d = page.getByRole("dialog");
  await d.getByLabel("Customer *").selectOption(fixture.customerId);
  await d.getByLabel("Requested service").selectOption("VISA");
  await d
    .getByLabel("Request title *")
    .fill("Family visa · workflow acceptance");
  await d.getByRole("button", { name: "Create Max ID", exact: true }).click();
  await page.waitForURL(/\/cases\/[^/?]+$/);
  const caseId = new URL(page.url()).pathname.split("/")[2],
    journey = await db.serviceCase.findUniqueOrThrow({ where: { id: caseId } }),
    work = await db.serviceWork.findUniqueOrThrow({
      where: { caseId_service: { caseId, service: "VISA" } },
    });
  const stage=await db.visaCase.findUniqueOrThrow({where:{id:fixture.visaCaseId},select:{stageId:true}});
  const source=await db.visaCase.create({data:{caseNo:"VC-WORKFLOW-SOURCE",customerId:fixture.customerId,ownerId:owner.id,branchId:owner.branchId,serviceCaseId:caseId,stageId:stage.stageId,visaType:"Visitor",destination:"UK"}});
  assert(journey.caseNo);
  report.checks.push(
    "First-contact registration assigns a permanent case ID and a planning owner",
  );
  await page.goto(`${base}/cases/${caseId}?tab=work`, {
    waitUntil: "networkidle",
  });
  await page
    .getByRole("main")
    .getByRole("button", { name: "Add work", exact: true })
    .click();
  d = page.getByRole("dialog");
  await d.getByLabel("Service work *").selectOption(work.id);
  await d.locator('select[name="visaCaseId"] option[value="'+source.id+'"]').waitFor({state:"attached"});
  await d.getByLabel("Linked service record").selectOption(source.id);
  await d.getByLabel("Next action *").fill("Prepare family visa review");
  await d
    .getByLabel("Instructions")
    .fill("Confirm requirements and record the next agreed action.");
  const candidate = d.locator(`select[name="ownerId"] option[value="${staff.id}"]`);
  await page.waitForFunction(id => document.querySelector(`dialog select[name="ownerId"] option[value="${id}"]`)?.disabled === true, staff.id);
  assert.equal(await candidate.evaluate(option => option.disabled), true);
  assert.match(await candidate.textContent(), /Visa access required/);
  const employeePage = await context.newPage();
  await employeePage.goto(base + "/employees", { waitUntil: "networkidle" });
  const staffRow = employeePage.getByRole("row").filter({ hasText: staff.email });
  await staffRow.getByRole("button", { name: "Edit", exact: true }).click();
  const profile = employeePage.getByRole("dialog");
  const combinedRole = await db.role.findUniqueOrThrow({ where: { key: "TRAVEL_EXECUTIVE" } });
  await profile.getByLabel("Role *").selectOption(combinedRole.id);
  await profile.getByRole("button", { name: "Save changes", exact: true }).click();
  assert(await profile.isVisible(), "A branch is required before saving operational staff");
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: staff.id } })).roleId, role.id);
  await profile.getByLabel("Branch *").selectOption(owner.branchId);
  await profile.getByRole("button", { name: "Save changes", exact: true }).click();
  await profile.waitFor({ state: "hidden" });
  await employeePage.close();
  assert.equal(await candidate.evaluate(option => option.disabled), true, "Open work form keeps its initial snapshot until refreshed");
  await d.getByRole("button", { name: "Refresh staff list", exact: true }).click();
  await d.getByRole("button", { name: "Refresh staff list", exact: true }).waitFor();
  await page.waitForFunction(id => document.querySelector(`dialog select[name="ownerId"] option[value="${id}"]`)?.disabled === false, staff.id);
  assert.equal(await candidate.evaluate(option => option.disabled), false);
  assert.match(await candidate.textContent(), /Visa & Ticketing Executive/);
  assert.equal(await d.getByLabel("Next action *").inputValue(), "Prepare family visa review");
  assert.equal(await d.getByLabel("Instructions").inputValue(), "Confirm requirements and record the next agreed action.");
  assert.equal(await d.getByLabel("Linked service record").inputValue(), source.id);
  report.checks.push("Staff setup explains visa eligibility, requires a branch, saves combined role and refreshes an open work form without losing its draft");
  await d.getByLabel("Assignee").selectOption(staff.id);
  const plannedDue=future(15);await d.getByLabel("Due time *").fill(plannedDue);
  await d.getByLabel("Require a separate review").check();
  await d.getByLabel("Reviewer *").selectOption(owner.id);
  const workRefreshUrl = url => url.pathname === "/api/work";
  const failRefresh = route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic staff refresh unavailable." }) });
  await page.route(workRefreshUrl, failRefresh);
  await d.getByRole("button", { name: "Refresh staff list", exact: true }).click();
  await d.getByRole("alert").filter({ hasText: "Your draft is kept." }).waitFor();
  assert.equal(await d.getByLabel("Assignee").inputValue(), staff.id);
  assert.equal(await d.getByLabel("Instructions").inputValue(), "Confirm requirements and record the next agreed action.");
  await page.unroute(workRefreshUrl, failRefresh);
  await db.user.update({ where: { id: staff.id }, data: { active: false } });
  await d.getByRole("button", { name: "Refresh staff list", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('dialog select[name="ownerId"]')?.validity.valid === false);
  await d.getByRole("button", { name: "Create work item", exact: true }).click();
  assert.equal(await db.task.count({ where: { title: "Prepare family visa review" } }), 0, "Unavailable selected staff must not silently create unassigned work");
  await db.user.update({ where: { id: staff.id }, data: { active: true } });
  await d.getByRole("button", { name: "Refresh staff list", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('dialog select[name="ownerId"]')?.validity.valid === true);
  assert.equal(await d.getByLabel("Assignee").inputValue(), staff.id);
  await d.getByLabel("Instructions").fill("Confirm requirements and record the next agreed action.");
  report.checks.push("Failed staff refresh retains the draft; deactivated selected staff blocks submission instead of silently unassigning; reactivation restores eligibility");
  await d
    .getByRole("button", { name: "Create work item", exact: true })
    .click();
  await d.waitFor({ state: "hidden" });
  const task = await db.task.findFirstOrThrow({
    where: { serviceCaseId: caseId, title: "Prepare family visa review" },
  });
  assert.equal(task.dueAt.toISOString(),new Date(plannedDue+"+05:30").toISOString(),"Work deadlines use India time even when the browser is abroad");
  assert.equal(task.ownerId, staff.id);
  assert.equal(task.requiresReview, true);
  const staffContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    timezoneId: "Asia/Kolkata",
  });
  await staffContext.route("**/*", (r) =>
    new URL(r.request().url()).origin === base ? r.continue() : r.abort(),
  );
  await login(staffContext, staff.email);
  const sourcePage=await staffContext.request.get(base+"/visa/"+source.id);assert.equal(sourcePage.status(),200,"Delegated source record is available within the staff role");
  const uploadLink=await staffContext.request.post(base+"/api/upload-links",{data:{customerId:fixture.customerId,visaCaseId:source.id,expiresInDays:1}});assert.equal(uploadLink.status(),200,"Delegated staff can request documents for this application");const privateLink=await uploadLink.json();assert((await staffContext.request.post(base+"/api/upload-links/revoke",{data:{linkId:privateLink.linkId}})).ok());
  const sp = await staffContext.newPage();
  sp.on("pageerror", (e) => report.errors.push(e.message));
  await sp.goto(base + "/dashboard", { waitUntil: "networkidle" });
  await sp
    .getByRole("heading", { name: "My day", level: 1, exact: true })
    .waitFor();
  await sp.goto(`${base}/work?task=${task.id}`, { waitUntil: "networkidle" });
  await action(sp, "Start work", "Requirements review started.");
  await sp.goto(`${base}/work?task=${task.id}`, { waitUntil: "networkidle" });
  await action(
    sp,
    "Waiting on something",
    "Waiting for the customer's preferred appointment date.",
    async (x) => {
      await x.getByLabel("Waiting on *").selectOption("CUSTOMER");
      await x.getByLabel("Next follow-up *").fill(future(1));
    },
  );
  let current = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(current.workState, "WAITING");
  assert(current.nextCheckAt);
  await sp.goto(`${base}/work?task=${task.id}`, { waitUntil: "networkidle" });
  await action(sp, "Resume work", "Customer confirmed the date.");
  await sp.goto(`${base}/work?task=${task.id}`, { waitUntil: "networkidle" });
  await action(
    sp,
    "Submit for review",
    "Requirements confirmed; application preparation can proceed.",
  );
  current = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(current.workState, "REVIEW");
  assert.equal(current.status, "IN_PROGRESS");
  const bypass = await staffContext.request.post(`${base}/api/tasks/status`, {
    data: { taskId: task.id, status: "DONE" },
  });
  assert.equal(bypass.status(), 409);
  const settingsDenied = await staffContext.request.post(
    `${base}/api/work/settings`,
    { data: { version: 1 } },
  );
  assert.equal(settingsDenied.status(), 403);
  await page.goto(`${base}/work?task=${task.id}`, { waitUntil: "networkidle" });
  await action(
    page,
    "Return with feedback",
    "Please record the agreed traveller count.",
  );
  await sp.goto(`${base}/work?task=${task.id}`, { waitUntil: "networkidle" });
  await action(
    sp,
    "Submit for review",
    "Four travellers confirmed; requirements and next appointment recorded.",
  );
  await page.goto(`${base}/work?task=${task.id}`, { waitUntil: "networkidle" });
  await action(
    page,
    "Approve result",
    "Reviewed the recorded requirements and traveller count.",
  );
  current = await db.task.findUniqueOrThrow({ where: { id: task.id } });
  assert.equal(current.workState, "DONE");
  assert.equal(current.status, "DONE");
  assert(current.reviewedAt);
  assert.equal(
    await db.workEvent.count({ where: { taskId: task.id, kind: "RETURN" } }),
    1,
  );
  report.checks.push(
    "Admin assignment → staff start → waiting with follow-up → resume → review → return → resubmit → separate approval; legacy completion and settings bypasses denied",
  );
  const rules = await (
    await context.request.get(base + "/api/work/settings")
  ).json();
  await page.goto(base + "/work/settings", { waitUntil: "networkidle" });
  await page
    .getByLabel("Action title *")
    .first()
    .fill("Confirm requirements with the family");
  await page
    .getByLabel("I reviewed the service steps and reminder calendar.")
    .check();
  await page
    .getByRole("button", { name: "Save new version", exact: true })
    .click();
  await page.getByRole("status").filter({ hasText: /saved/i }).waitFor();
  const changed = await (
    await context.request.get(base + "/api/work/settings")
  ).json();
  assert.equal(changed.version, rules.version + 1);
  const stale = await context.request.post(base + "/api/work/settings", {
    data: rules,
  });
  assert.equal(stale.status(), 409);
  assert.equal(
    (await db.task.findUniqueOrThrow({ where: { id: task.id } })).title,
    task.title,
  );
  const template = await (
    await context.request.get(
      `${base}/api/work/plan?case=${caseId}&service=FLIGHT`,
    )
  ).json();
  const planBody = {
    requestKey: randomUUID(),
    caseId,
    service: "FLIGHT",
    configVersion: template.version,
    steps: template.steps.map((s) => ({
      key: s.key,
      ownerId: null,
      reviewerId: null,
      dueAt: null,
    })),
  };
  const planned = await context.request.post(base + "/api/work/plan", {
    data: planBody,
  });
  assert(planned.ok(), await planned.text());
  const replay = await context.request.post(base + "/api/work/plan", {
    data: planBody,
  });
  assert(replay.ok());
  assert.equal(await db.serviceWork.count({ where: { caseId } }), 2);
  report.checks.push(
    "Versioned settings affect future plans; stale saves conflict; mixed-service template application is idempotent",
  );
  const dates = await (
    await context.request.get(base + "/api/work/reports")
  ).json();
  assert(
    dates.events.some(
      (e) =>
        e.taskId === task.id &&
        e.kind === "APPROVE" &&
        e.assignee === staff.name,
    ),
  );
  assert(dates.events.some((e) => e.taskId === task.id && e.kind === "RETURN"));
  const csv = await context.request.get(base + "/api/work/reports?format=csv");
  assert(csv.ok());
  assert((await csv.text()).includes("Assignee at event"));
  for (const width of [1440,1024,768,390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    for (const [route, title] of [
      ["/dashboard", "Agency overview"],
      ["/cases", "Max IDs"],
      ["/work", "Team work"],
      ["/reports/work", "Work & team reports"],
      ["/work/settings", "Work templates & rules"],
      ["/settings", "Agency settings"],
    ]) {
      await page.goto(base + route, { waitUntil: "networkidle" });
      await page
        .getByRole("main")
        .getByRole("heading", { level: 1, name: title, exact: true })
        .waitFor();
      assert.equal(await page.getByRole("main").locator("h1").count(), 1);
      await shot(`${width}-${route.replaceAll("/", "-")}`);
    }
    for (const tab of [
      "overview",
      "work",
      "documents",
      "conversation",
      "money",
      "history",
    ]) {
      await page.goto(`${base}/cases/${caseId}?tab=${tab}`, {
        waitUntil: "networkidle",
      });
      assert.equal(await page.getByRole("main").locator("h1").count(), 1);
      await shot(`${width}-case-${tab}`);
    }
  }
  await sp.setViewportSize({ width: 390, height: 844 });
  await sp.goto(base + "/work", { waitUntil: "networkidle" });
  assert.equal(
    await sp
      .getByRole("main")
      .getByRole("heading", { name: "My work", level: 1 })
      .count(),
    1,
  );
  assert.equal(
    await sp.getByRole("link", { name: "Finance", exact: true }).count(),
    0,
  );
  await sp
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await sp.keyboard.press("Escape");
  assert(
    await sp.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  );
  await staffContext.close();
  assert.deepEqual(report.errors, []);
  report.passed = true;
  report.checks.push(
    "48 desktop/tablet/phone views, all six case tabs, full reporting/export, staff navigation isolation and keyboard drawer close",
  );
  console.log(
    `PASS case workflow browser: ${report.checks.length} end-to-end groups, ${report.screens.length} screenshots.`,
  );
} catch (e) {
  if (page && !page.isClosed()) {
    await page
      .screenshot({ path: path.join(out, "failure.png"), fullPage: true })
      .catch(() => {});
    writeFileSync(
      path.join(out, "failure-dom.txt"),
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
  }
  report.errors.push(e.stack ?? String(e));
  console.error(e.stack ?? e);
  process.exitCode = 1;
} finally {
  save();
  if (browser) await browser.close();
  if (db) await db.$disconnect();
  if (fixture?.serverPid) {
    try {
      process.kill(fixture.serverPid);
    } catch {}
  }
  child.kill();
}
