/** End-to-end owner fixes against disposable SQLite and a loopback production server. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, cp, rm, realpath, readdir, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";
import { initializeReferenceData } from "../src/lib/bootstrap";
import { journalEntity } from "../src/lib/financial-journal"; import { visaPhase } from "../src/lib/visa-phase";
import { enquiryNextStep, quoteExplanation, type SalesLead } from "../src/app/(app)/sales/sales-workspace";
import { stopFixtureChild, within } from "./fixture-lifecycle.mjs";

const parent = await realpath(tmpdir()), directory = await mkdtemp(path.join(parent, "crm-owner-review-"));
const database = `file:${path.join(directory, "fixture.db").replaceAll("\\", "/")}`;
const secret = randomBytes(48).toString("hex"), passwordHash = "synthetic-not-a-real-password";
const db = new PrismaClient({ datasources: { db: { url: database } } });
let server: ReturnType<typeof spawn> | undefined, logs = "", checks = 0;
function check(label: string, condition: unknown) { assert(condition, label); checks++; console.log(`PASS ${label}`); }
const listener = createServer();
await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
const port = (listener.address() as { port: number }).port;
await new Promise<void>(resolve => listener.close(() => resolve()));
const origin = `http://127.0.0.1:${port}`;
async function actor(id: string) {
  const session = await db.staffSession.create({ data: { id: randomBytes(16).toString("hex"), userId: id, expiresAt: new Date(Date.now() + 3600000), agent: "Isolated owner review" } });
  const token = await new SignJWT({ id, sessionId: session.id, authVersion: createHash("sha256").update(passwordHash).digest("hex") }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret));
  return `tos_session=${token}`;
}
async function request(cookie: string | null, route: string, body?: FormData) {
  const response = await fetch(origin + route, { method: body ? "POST" : "GET", headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body, redirect: "manual", signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  return { response, text, json: JSON.parse(text) };
}
const upload = (version = 1, expiry = "2035-01-01") => {
  const form = new FormData();
  form.set("requestKey", randomUUID()); form.set("version", String(version)); form.set("expiryDate", expiry);
  form.set("file", new File(["%PDF-1.4\nSynthetic requirement\n%%EOF"], "passport.pdf", { type: "application/pdf" }));
  return form;
};
try {
  await writeFile(path.join(directory, "fixture.db"), "");
  await writeFile(path.join(directory, "schema.prisma"), await readFile("prisma/schema.prisma"));
  await cp("prisma/migrations", path.join(directory, "migrations"), { recursive: true });
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", path.join(directory, "schema.prisma")], { env: { ...process.env, DATABASE_URL: database }, stdio: "pipe" });
  await db.$transaction(initializeReferenceData);
  const roles = new Map((await db.role.findMany()).map(r => [r.key, r.id]));
  await db.branch.create({ data: { id: "branch", code: "OWNER-FIXTURE", name: "Synthetic branch", city: "Synthetic" } });
  for (const [id, role] of [["owner", "OWNER"], ["staff", "VISA_EXECUTIVE"], ["reader", "READ_ONLY"]]) await db.user.create({ data: { id, employeeCode: id, name: `Synthetic ${id}`, email: `${id}@example.test`, phone: "", passwordHash, roleId: roles.get(role)!, branchId: "branch" } });
  await db.customer.create({ data: { id: "customer", code: "C-OWNER", name: "Synthetic Customer", phone: "9000000001", city: "Synthetic", assignedToId: "owner", branchId: "branch" } });
  await db.traveller.create({ data: { id: "traveller", customerId: "customer", fullName: "Synthetic Traveller" } });
  await db.serviceCase.create({ data: { id: "trip", caseNo: "MAX-OWNER", title: "Synthetic holiday", customerId: "customer", branchId: "branch", ownerId: "owner", service: "FLIGHT" } });
  await db.booking.create({ data: { id: "cancelled", bookingNo: "BK-CANCELLED", customerId: "customer", serviceCaseId: "trip", ownerId: "owner", branchId: "branch", product: "FLIGHT", status: "CANCELLED", sector: "BOM-DEL", sellingPrice: 60000, cancellationSupplierCharge: 5000, cancellationAgencyFee: 1000 } });
  await db.payment.create({ data: { receiptNo: "RC-OWNER", customerId: "customer", bookingId: "cancelled", amount: 6000 } });
  await db.invoice.create({ data: { id: "invoice", invoiceNo: "INV-CANCELLED", customerId: "customer", bookingId: "cancelled", amount: 60000 } });
  await db.booking.create({data:{id:"open-booking",bookingNo:"BK-OUTSTANDING",customerId:"customer",ownerId:"owner",branchId:"branch",status:"CONFIRMED",sellingPrice:12000,supplierCost:9000,supplierCostConfirmed:true,sector:"DEL-BOM"}}); await db.ticket.create({ data: { bookingId: "cancelled", ticketNo: "1234567890123", passenger: "Synthetic Traveller" } });
  await db.serviceWork.create({ data: { id: "work", caseId: "trip", service: "FLIGHT", title: "Flight" } });
  await db.task.create({ data: { title: "Plan flight work", sourceKey: "plan:work", serviceWorkId: "work", ownerId: "owner", creatorId: "owner", serviceCaseId: "trip", branchId: "branch", workflowTracked: true, unassigned: true } });
  const lead = await db.salesLead.create({ data: { id: "lead", customerId: "customer", serviceCaseId: "trip", ownerId: "owner", branchId: "branch", title: "Synthetic enquiry", product: "FLIGHT", source: "Fixture", stage: "WON", quotes: { create: { version: 1, state: "ACCEPTED", bookingId: "cancelled", items: "[]", terms: "Synthetic terms", expiresAt: new Date("2030-01-01"), totalMinor: 6000000, costMinor: 5000000, createdBy: "owner" } } } });
  const stage = await db.visaStage.findUniqueOrThrow({ where: { key: "DOCUMENTS_PENDING" } });
  const checklist = await db.checklist.create({ data: { country: "Synthetic", visaType: "Tourist", applicantType: "SALARIED", items: { create: { id: "item", name: "Passport", fileTypes: "pdf", needsExpiry: true, maxSizeMb: 1 } } } });
  await db.visaCase.create({ data: { id: "visa", caseNo: "VC-OWNER", customerId: "customer", serviceCaseId: "trip", ownerId: "owner", branchId: "branch", destination: "Synthetic", visaType: "Tourist", stageId: stage.id, travellers: { create: { travellerId: "traveller" } }, checklistLinks: { create: { checklistId: checklist.id, travellerId: "traveller" } } } });
  for (const id of ["requirement", "http-requirement"]) await db.document.create({ data: { id, docNo: `DOC-${id}`, customerId: "customer", travellerId: "traveller", visaCaseId: "visa", checklistItemId: "item", docType: "Passport" } });
  await db.$transaction(tx=>journalEntity(tx,"Booking","open-booking","owner")); await db.settings.upsert({ where: { key: "financialJournal.cutover" }, create: { key: "financialJournal.cutover", value: new Date(Date.now() - 86400000).toISOString() }, update: {} });
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(port), "--hostname", "127.0.0.1"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? ".next", DATABASE_URL: database, JWT_SECRET: secret, APP_ORIGIN: origin, UPLOAD_ROOT: path.join(directory, "uploads"), PRIVATE_STORAGE: "local", CLAMAV_HOST: "", UPLOAD_SCAN_REQUIRED: "false", CRM_DATA_ENCRYPTION_KEY: randomBytes(32).toString("hex"), CRM_REQUIRE_MFA: "false", SMTP_HOST: "", SMTP_FROM: "", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" } });
  server.stdout!.on("data", chunk => logs += chunk); server.stderr!.on("data", chunk => logs += chunk);
  await within((async () => { while (true) { assert(server!.exitCode === null, logs); try { if ((await fetch(origin + "/api/health", { signal: AbortSignal.timeout(1000) })).ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 150)); } })(), 60000, "owner fixture startup");
  const owner = await actor("owner"), staff = await actor("staff"), reader = await actor("reader");
  const search = await request(owner, "/api/search?q=INV-CANCELLED");
  check("Cancelled invoice search uses settled balance", search.response.ok && search.json.exact.context.includes("Cancelled") && !search.json.exact.context.includes("60,000") && search.json.exact.context.includes("₹0"));
  const sales = await request(owner, `/api/sales?leadId=${lead.id}`);
  const salesLead = sales.json.lead as SalesLead;
  check("Sales gets scoped cancellation status and directs settlement review", salesLead.quotes[0].bookingStatus === "CANCELLED" && enquiryNextStep(salesLead).title === "Review the cancelled booking" && quoteExplanation(salesLead.quotes[0]).includes("settlement"));
  const trip = await request(owner, "/api/trips/trip");
  check("Cancelled flight planning prompt becomes a review without deleting work", trip.json.nextTodo.title.includes("Review work for cancelled flight") && await db.task.count() === 1);
  const customStages = [{ key: "DOCUMENTS_PENDING", seq: 4 }, { key: "CUSTOM_CHECK", seq: 5 }, { key: "SUBMITTED", seq: 9 }];
  check("Custom visa stage stays in its preceding workflow phase", visaPhase(customStages[1], customStages).id === "documents");
  check("Document upload requires authentication", (await request(null, "/api/documents/http-requirement/upload", upload())).response.status === 401);
  check("Read-only role cannot upload", (await request(reader, "/api/documents/http-requirement/upload", upload())).response.status === 403);
  check("Unassigned document denied to staff", (await request(staff, "/api/documents/http-requirement/upload", upload())).response.status === 404);
  check("Checklist expiry is enforced", (await request(owner, "/api/documents/http-requirement/upload", upload(1, ""))).response.status === 400);
  const wrongType = upload(); wrongType.set("file", new File([new Uint8Array([137,80,78,71,13,10,26,10])], "photo.png"));
  check("Checklist file types are enforced", (await request(owner, "/api/documents/http-requirement/upload", wrongType)).response.status === 400);
  const oversized = upload(); oversized.set("file", new File(["%PDF-", new Uint8Array(1024 * 1024)], "large.pdf"));
  check("Checklist size limit is enforced", (await request(owner, "/api/documents/http-requirement/upload", oversized)).response.status === 413);
  const form = upload();
  const receipt = await request(owner, "/api/documents/http-requirement/upload", form);
  const saved = await db.document.findUniqueOrThrow({ where: { id: "http-requirement" } });
  check("Upload fulfills the existing requirement and keeps its traveller/checklist", receipt.response.ok && receipt.json.documentId === saved.id && saved.status === "RECEIVED" && saved.verificationStatus === "PENDING" && saved.travellerId === "traveller" && saved.checklistItemId === "item" && await db.document.count() === 2);
  check("Lost-response retry returns the same receipt and file", (await request(owner, "/api/documents/http-requirement/upload", form)).json.replayed && (await readdir(path.join(directory, "uploads"))).length === 1);
  check("Fresh duplicate upload cannot replace a received file", (await request(owner, "/api/documents/http-requirement/upload", upload())).response.status === 409);
  await db.document.update({ where: { id: saved.id }, data: { status: "REUPLOAD_REQUESTED", verificationStatus: "REJECTED", rejectionReason: "Synthetic rejection" } });
  check("Replacement advances version and resets verification", (await request(owner, "/api/documents/http-requirement/upload", upload())).response.ok && (await db.document.findUniqueOrThrow({ where: { id: saved.id } })).version === 2);
  check("Stale replacement version is rejected", (await request(owner, "/api/documents/http-requirement/upload", upload())).response.status === 409);
  if (process.argv.includes("--browser")) {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    const artifacts = path.resolve(process.env.OWNER_AUDIT_ARTIFACTS ?? "tests/.runtime/owner-interface-artifacts");
    await mkdir(artifacts, { recursive: true });
    try {
      for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
        const context = await browser.newContext({ viewport });
        await context.addCookies([{ name: "tos_session", value: owner.slice("tos_session=".length), url: origin }]);
        const page = await context.newPage(), errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        try {
          await page.goto(origin + "/trips");
          await page.getByRole("link", { name: "MAX-OWNER" }).first().waitFor();
          check(`${viewport.width}: trip filters and results fit screen`, await page.getByLabel("Travel stage").isVisible() && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          await page.screenshot({ path: path.join(artifacts, `trips-${viewport.width}.png`), fullPage: true });
          await page.goto(origin + "/trips/trip"); await page.getByText("Work status: Open", { exact: true }).waitFor();
          check(`${viewport.width}: travel and work statuses are distinct`, await page.getByText("Travel stage", { exact: true }).isVisible() && await page.getByText("Work status: Open", { exact: true }).isVisible());
          await page.getByRole("button", { name: "Add to-do", exact: true }).click();
          const taskDialog = page.getByRole("dialog");
          check(`${viewport.width}: advanced task options start collapsed`, !await taskDialog.getByLabel("Instructions (optional)").isVisible());
          check(`${viewport.width}: create action stays visible`, await taskDialog.getByRole("button", { name: "Create to-do", exact: true }).isVisible() && await taskDialog.getByRole("button", { name: "Create to-do", exact: true }).evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
          await page.screenshot({ path: path.join(artifacts, `todo-${viewport.width}.png`) });
          if(viewport.width === 1366) { await taskDialog.getByLabel("Service work *", { exact: true }).selectOption("work"); await taskDialog.getByLabel("Next action *", { exact: true }).fill("Synthetic owner follow-up"); await taskDialog.getByRole("button", { name: "Create to-do", exact: true }).click(); await taskDialog.waitFor({state:"hidden"}); check("Simplified to-do form saves the trip and default options", await db.task.count({where:{title:"Synthetic owner follow-up",serviceCaseId:"trip",priority:"MEDIUM",resultType:"NOTE"}}) === 1); } else { await taskDialog.getByRole("button", { name: "Close work dialog", exact: true }).click(); }
          await page.goto(origin + "/masters/customer?tab=documents"); await page.getByRole("heading", { name: "Document library", exact: true }).waitFor();
          check(`${viewport.width}: one customer file library and upload action`, await page.getByRole("heading", { name: "Document library", exact: true }).isVisible() && await page.getByRole("button", { name: "Upload document", exact: true }).count() === 1);
          await page.getByLabel("Files for").selectOption("customer"); check(`${viewport.width}: customer file filter excludes traveller documents`, await page.getByText("No documents.", {exact:true}).isVisible()); await page.getByLabel("Files for").selectOption("traveller"); check(`${viewport.width}: document library fits screen`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.screenshot({path:path.join(artifacts,`documents-${viewport.width}.png`),fullPage:true});
          await page.goto(origin + "/payments?action=record&customer=customer&booking=open-booking"); const receiptDialog=page.getByRole("dialog"); await receiptDialog.getByRole("button",{name:"Save receipt",exact:true}).waitFor(); check(`${viewport.width}: payment save stays visible`, await receiptDialog.getByRole("button",{name:"Save receipt",exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})); await receiptDialog.evaluate(el=>el.scrollTop=el.scrollHeight); check(`${viewport.width}: payment close stays visible after scrolling`, await receiptDialog.getByRole("button",{name:"Close",exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})); await receiptDialog.getByRole("button",{name:"Cancel",exact:true}).click(); await page.goto(origin + "/ticketing/cancelled"); await page.getByRole("heading", { name: "Historical tickets", exact: true }).waitFor();
          check(`${viewport.width}: old tickets are historical and collection controls collapsed`, await page.getByRole("heading", { name: "Historical tickets", exact: true }).isVisible() && await page.getByText("Historical · OK", { exact: true }).isVisible() && !await page.locator('#booking-document-history').getAttribute("open"));
          await page.goto(origin + "/reports?report=ageing");
          await page.getByRole("region", { name: "Report records", exact: true }).waitFor();
          check(`${viewport.width}: report contains an outstanding record`, await page.getByRole("link", { name: "BK-OUTSTANDING", exact: true }).locator("visible=true").count() > 0); const recordsY = await page.getByRole("region", { name: "Report records", exact: true }).evaluate(el => el.getBoundingClientRect().top + scrollY);
          check(`${viewport.width}: report records appear without ten summary cards`, recordsY < (viewport.width < 600 ? 1700 : 1200) && await page.getByRole("button", { name: "Generate report", exact: true }).count() === 1);
          console.log(`Report records begin at ${Math.round(recordsY)}px at ${viewport.width}px width.`);
          await page.screenshot({ path: path.join(artifacts, `reports-${viewport.width}.png`), fullPage: true });
          await page.goto(origin + "/visa/visa");
          await page.getByText("Change stage", { exact: true }).click();
          check(`${viewport.width}: single stage picker with four workflow phases`, await page.getByLabel("Visa workflow stage").count() === 1 && await page.getByRole("list", { name: "Visa phases", exact: true }).locator(':scope > li').count() === 4);
          if (viewport.width === 390) {
            await page.getByRole("button", { name: "Upload document", exact: true }).first().click();
            const dialog = page.getByRole("dialog");
            await dialog.getByLabel("File *", { exact: true }).setInputFiles({ name: "passport.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nBrowser synthetic file\n%%EOF") });
            await dialog.getByLabel("Expiry date *", { exact: true }).fill("2035-01-01");
            await dialog.getByRole("button", { name: "Upload document", exact: true }).click();
            await dialog.waitFor({ state: "hidden" });
            await page.getByText("Check application progress", {exact:true}).waitFor();
            check("Phone: direct checklist upload survives refresh and remains one requirement", (await db.document.findUniqueOrThrow({ where: { id: "requirement" } })).status === "RECEIVED" && await db.document.count() === 2);
          }
          await page.screenshot({ path: path.join(artifacts, `visa-${viewport.width}.png`), fullPage: true });
          await page.goto(origin + "/employees");
          await page.getByRole("button", { name: "+ New employee", exact: true }).click();
          const roleId = roles.get("TICKETING_EXECUTIVE")!;
          await page.getByRole("dialog").getByLabel("Role *", { exact: true }).selectOption(roleId);
          check(`${viewport.width}: role chooser explains restricted financial access`, (await page.getByRole("dialog").getByRole("note").textContent())?.includes("Internal costs and profit are hidden."));
          check(`${viewport.width}: no client runtime errors`, errors.length === 0);
        } catch (error) { await page.screenshot({ path: path.join(artifacts, `failure-${viewport.width}.png`), fullPage: true }); console.error((await page.locator("body").innerText()).slice(0,6000)); throw error; } finally { await context.close(); }
      }
    } finally { await browser.close(); }
    console.log(`Visual evidence: ${artifacts}`);
  }
  console.log(`Owner interface passed: ${checks} checks; isolated database, uploads and loopback server.`);
} catch (error) { console.error(logs.slice(-4000)); throw error; }
finally {
  if (server) await stopFixtureChild(server);
  await db.$disconnect();
  const owned = await realpath(directory); assert.equal(path.dirname(owned), parent); assert(path.basename(owned).startsWith("crm-owner-review-"));
  await rm(owned, { recursive: true, force: true });
}
