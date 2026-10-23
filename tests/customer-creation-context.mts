/** Isolated HTTP regression: an old enquiry modal must never write under a replacement session. */
import assert from "node:assert/strict";
import { mkdtemp, rm, cp, readFile, writeFile, mkdir } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { within, withFixtureCleanup } from "./fixture-lifecycle.mjs";

const dir = await mkdtemp(join(tmpdir(), "customer-context-fixture-"));
const database = `file:${join(dir, "fixture.db")}`;
const port = 3375, base = `http://127.0.0.1:${port}`;
const secret = randomBytes(48).toString("hex");
const out = resolve("test-artifacts/customer-context"); await mkdir(out, { recursive: true });
await writeFile(join(dir, "schema.prisma"), await readFile(new URL("../prisma/schema.prisma", import.meta.url)));
await cp(new URL("../prisma/migrations", import.meta.url), join(dir, "migrations"), { recursive: true });
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", join(dir, "schema.prisma")], { env: { ...process.env, DATABASE_URL: database }, stdio: "pipe" });
const db = new PrismaClient({ datasources: { db: { url: database } } });
const built = process.env.CUSTOMER_CONTEXT_USE_BUILD === "1";
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", built ? "start" : "dev", ...(built ? [] : ["--webpack"]), "--port", String(port), "--hostname", "127.0.0.1"], {
  detached: true, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, DATABASE_URL: database, APP_ORIGIN: base, JWT_SECRET: secret, UPLOAD_ROOT: join(dir, "uploads"), WA_PROVIDER: "manual", NEXT_TELEMETRY_DISABLED: "1", ...(built ? {} : { NEXT_DIST_DIR: ".next-customer-context" }) },
});
let logs = "", spawnError = "";
server.stdout.on("data", value => logs += value); server.stderr.on("data", value => logs += value); server.on("error", error => spawnError = String(error));
const report = { passed: false, checks: [] as string[], failure: "" };
async function token(id: string, sessionId: string) {
  await db.staffSession.create({ data: { id: sessionId, userId: id, expiresAt: new Date(Date.now() + 3600000), agent: "Synthetic context regression" } });
  return new SignJWT({ id, sessionId, authVersion: createHash("sha256").update("not-a-real-password-hash").digest("hex") }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret));
}
async function create(cookie: string, context: string | null, name: string) {
  return fetch(`${base}/api/customers`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base, Cookie: `tos_session=${cookie}`, ...(context !== null ? { "X-Sales-Recovery-Context": context } : {}) }, body: JSON.stringify({ name, phone: "9000000150", type: "INDIVIDUAL" }), signal: AbortSignal.timeout(30000) });
}
await withFixtureCleanup(async () => {
  try {
    await db.role.create({ data: { id: "fixture-owner", key: "OWNER", name: "Owner", desc: "Fixture only" } });
    await db.branch.create({ data: { id: "fixture-branch", code: "FIX", name: "Synthetic branch", city: "Fixture" } });
    for (const id of ["staff-a", "staff-b"]) await db.user.create({ data: { id, employeeCode: id, name: id, email: `${id}@example.test`, phone: "", passwordHash: "not-a-real-password-hash", roleId: "fixture-owner", branchId: "fixture-branch" } });
    const cookieA = await token("staff-a", "session-a"), cookieB = await token("staff-b", "session-b"), cookieA2 = await token("staff-a", "session-a2");
    await within((async () => {
      while (true) {
        assert(!spawnError && server.exitCode === null && server.signalCode === null, `Owned server exited: ${spawnError}\n${logs}`);
        try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* wait for owned fixture */ }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    })(), 90000, "customer context fixture startup");
    const contextFor = async (cookie: string) => {
      const response = await fetch(`${base}/api/sales`, { headers: { Cookie: `tos_session=${cookie}` }, signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 200); const body = await response.json(); assert.match(body.recoveryContext, /^[a-f0-9]{64}$/); return body.recoveryContext as string;
    };
    const contextA = await contextFor(cookieA), contextB = await contextFor(cookieB);
    assert.notEqual(contextA, contextB);
    for (const [cookie, reason] of [[cookieB, "other-staff"], [cookieA2, "same-staff-new-session"]]) {
      const before = { customers: await db.customer.count(), travellers: await db.traveller.count(), audit: await db.auditLog.count(), counters: await db.settings.count() };
      const rejected = await create(cookie, contextA, `PRIVATE stale ${reason} form`);
      assert.equal(rejected.status, 409); assert.equal((await rejected.json()).code, "SALES_CONTEXT_CHANGED");
      assert.deepEqual({ customers: await db.customer.count(), travellers: await db.traveller.count(), audit: await db.auditLog.count(), counters: await db.settings.count() }, before, `${reason}: zero customer/traveller/audit/reference writes`);
      report.checks.push(`${reason}: stale write rejected before any records`);
    }
    await db.branch.create({ data: { id: "changed-branch", code: "CHG", name: "Changed scope", city: "Fixture" } });
    await db.user.update({ where: { id: "staff-a" }, data: { branchId: "changed-branch" } });
    const scopeBefore = { customers: await db.customer.count(), travellers: await db.traveller.count(), audit: await db.auditLog.count(), counters: await db.settings.count() };
    const changedScope = await create(cookieA, contextA, "PRIVATE stale scope form"); assert.equal(changedScope.status, 409);
    assert.deepEqual({ customers: await db.customer.count(), travellers: await db.traveller.count(), audit: await db.auditLog.count(), counters: await db.settings.count() }, scopeBefore);
    report.checks.push("same-session scope change: stale write rejected before any records");
    await db.user.update({ where: { id: "staff-a" }, data: { branchId: "fixture-branch" } });
    const malformed = await create(cookieA, "", "Missing bound context"); assert.equal(malformed.status, 409); assert.equal(await db.customer.count(), 0);
    const validA = await create(cookieA, contextA, "Valid A fixture"); assert.equal(validA.status, 200); const a = await validA.json(); assert.equal((await db.customer.findUniqueOrThrow({ where: { id: a.id } })).assignedToId, "staff-a");
    const validB = await create(cookieB, contextB, "Valid B fixture"); assert.equal(validB.status, 200); const b = await validB.json(); assert.equal((await db.customer.findUniqueOrThrow({ where: { id: b.id } })).assignedToId, "staff-b");
    const legacy = await create(cookieB, null, "Ordinary Customers compatibility"); assert.equal(legacy.status, 200);
    assert.equal(await db.customer.count(), 3); assert.equal(await db.auditLog.count({ where: { entity: "Customer", action: "CREATE" } }), 3);
    report.checks.push("matching contexts create under the correct staff", "ordinary Customers POST remains compatible");
    report.passed = true; console.log("PASS customer context HTTP: different staff/session stale writes leave zero customer, traveller, audit and counter records; valid and ordinary creation preserved.");
  } catch (error) { report.failure = String(error); throw error; }
}, async () => {
  await writeFile(join(out, "server.log"), logs); await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));
  if (server.pid) {
    const signal = (kind: NodeJS.Signals | 0) => { try { process.kill(-server.pid!, kind); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; } };
    if (signal("SIGTERM")) {
      try { await within((async () => { while (signal(0)) await new Promise(resolve => setTimeout(resolve, 100)); })(), 3000, "owned server shutdown"); }
      catch { signal("SIGKILL"); await within((async () => { while (signal(0)) await new Promise(resolve => setTimeout(resolve, 100)); })(), 3000, "owned server forced shutdown"); }
    }
  }
  await db.$disconnect(); await rm(dir, { recursive: true, force: true });
}, (error: unknown) => { report.passed = false; report.failure = String(error); writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2)); });
