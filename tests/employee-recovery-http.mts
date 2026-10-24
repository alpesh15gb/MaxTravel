/** Disposable SQLite only: staff recovery reads and optional client write guards preserve access contracts. */
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { employeeRecoveryContext } from "../src/lib/employee-recovery-server";
import { ROLE_ACCESS, ROLE_PERMISSIONS, type RoleKey } from "../src/lib/permissions";
import { within, withFixtureCleanup, stopFixtureChild } from "./fixture-lifecycle.mjs";

const dir = await mkdtemp(join(tmpdir(), "employee-http-fixture-")), database = `file:${join(dir, "fixture.db")}`;
const base = "http://127.0.0.1:3382", secret = randomBytes(48).toString("hex"), passwordHash = "synthetic-only-password-hash";
const out = resolve("test-artifacts/employee-recovery-http"); await mkdir(out, { recursive: true });
const db = new PrismaClient({ datasources: { db: { url: database } } });
let server: ReturnType<typeof spawn> | undefined, logs = "";
const report = { passed: false, checks: [] as string[], failure: "" };
type Actor = { cookie: string; context: string };
async function actor(id: string, role: RoleKey, sessionId = randomBytes(16).toString("hex")): Promise<Actor> {
  await db.staffSession.create({ data: { id: sessionId, userId: id, expiresAt: new Date(Date.now() + 3600000), agent: "Synthetic recovery HTTP" } });
  const cookie = await new SignJWT({ id, sessionId, authVersion: createHash("sha256").update(passwordHash).digest("hex") }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret));
  return { cookie, context: employeeRecoveryContext({ id, sessionId, role, branchId: "fixture-branch", accessMode: ROLE_ACCESS[role], permissions: ROLE_PERMISSIONS[role], mfaEnabled: false }) };
}
async function request(who: Actor | null, query: string, data?: object, context: string | null = who?.context ?? null) {
  const response = await fetch(`${base}/api/employees${query}`, { method: data ? "POST" : "GET", headers: { Origin: base, ...(who ? { Cookie: `tos_session=${who.cookie}` } : {}), ...(context === null ? {} : { "X-Employee-Recovery-Context": context }), ...(data ? { "Content-Type": "application/json" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(15000) });
  return { response, body: await response.json() };
}
await withFixtureCleanup(async () => {
  try {
    await writeFile(join(dir, "schema.prisma"), await readFile(new URL("../prisma/schema.prisma", import.meta.url)));
    await cp(new URL("../prisma/migrations", import.meta.url), join(dir, "migrations"), { recursive: true });
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", join(dir, "schema.prisma")], { env: { ...process.env, DATABASE_URL: database }, stdio: "pipe" });
    for (const role of ["OWNER", "HR", "READ_ONLY", "BRANCH_MANAGER"] as const) await db.role.create({ data: { id: role, key: role, name: role, desc: "Fixture only" } });
    await db.branch.create({ data: { id: "fixture-branch", code: "FIX", name: "Fixture", city: "Fixture" } });
    for (const [id, role] of [["owner", "OWNER"], ["second-owner", "OWNER"], ["hr", "HR"], ["reader", "READ_ONLY"], ["branch-manager", "BRANCH_MANAGER"], ["target", "READ_ONLY"]]) await db.user.create({ data: { id, employeeCode: `TEST-${id}`, name: `Fixture ${id}`, email: `${id}@example.test`, phone: "9000000000", passwordHash, roleId: role, branchId: "fixture-branch", salary: 1000, bankAccount: "SYNTHETIC-NOT-A-BANK" } });
    const owner = await actor("owner", "OWNER"), replacement = await actor("owner", "OWNER"), other = await actor("second-owner", "OWNER"), hr = await actor("hr", "HR"), reader = await actor("reader", "READ_ONLY"), branch = await actor("branch-manager", "BRANCH_MANAGER");
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", "3382", "--hostname", "127.0.0.1"], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DATABASE_URL: database, APP_ORIGIN: base, JWT_SECRET: secret, UPLOAD_ROOT: join(dir, "uploads"), WA_PROVIDER: "manual", NEXT_TELEMETRY_DISABLED: "1" } });
    server.stdout!.on("data", value => logs += value); server.stderr!.on("data", value => logs += value);
    let spawnError = ""; server.on("error", error => spawnError = String(error));
    await within((async () => { while (true) { assert(!spawnError && server!.exitCode === null && server!.signalCode === null, `Fixture server stopped: ${spawnError}\n${logs}`); try { if ((await fetch(base + "/api/health", { signal: AbortSignal.timeout(1000) })).ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 200)); } })(), 60000, "employee HTTP fixture startup");
    const initial = await request(owner, "?employeeId=target"); assert.equal(initial.response.status, 200); assert.equal(initial.response.headers.get("cache-control"), "private, no-store"); assert.equal(initial.body.recoveryContext, owner.context); assert.equal(initial.body.employee.id, "target"); assert.match(initial.body.employee.revision, /^[a-f0-9]{64}$/); assert(!JSON.stringify(initial.body).includes(passwordHash)); assert(!("passwordHash" in initial.body.employee));
    const emailRead = await request(owner, "?email=target%40example.test"); assert.equal(emailRead.body.employee.id, "target");
    const missing = await request(owner, "?email=missing%40example.test"); assert.equal(missing.response.status, 200); assert.equal(missing.body.employee, null);
    for (const query of ["", "?employeeId=target&email=target%40example.test", "?employeeId=&email=target%40example.test", "?employeeId=target&employeeId=owner", "?email=target%40example.test&email=owner%40example.test"]) assert.equal((await request(owner, query)).response.status, 400);
    assert.equal((await request(null, "?employeeId=target")).response.status, 401);
    for (const who of [reader, branch]) { const denied = await request(who, "?employeeId=target"); assert.equal(denied.response.status, 403); assert(!JSON.stringify(denied.body).includes("SYNTHETIC-NOT-A-BANK")); }
    for (const who of [replacement, other]) { const changed = await request(who, "?employeeId=target", undefined, owner.context); assert.equal(changed.response.status, 409); assert(!("employee" in changed.body)); }
    report.checks.push("Authenticated exact-id/email no-store reads; unknown remains null; no credential disclosure; no management privilege expansion; stale actor/session reveals no employee");
    const before = await db.auditLog.count();
    for (const who of [replacement, other]) { const stale = await request(who, "", { id: "target", name: "Stale actor", baseRevision: initial.body.employee.revision }, owner.context); assert.equal(stale.response.status, 409); assert.equal(stale.body.employeeWrite, "rejected"); assert.equal(stale.body.code, "EMPLOYEE_CONTEXT_CHANGED"); }
    await db.user.update({ where: { id: "owner" }, data: { branchId: null } });
    const scopeChanged = await request(owner, "", { id: "target", name: "Stale scope", baseRevision: initial.body.employee.revision }); assert.equal(scopeChanged.response.status, 409); assert.equal(scopeChanged.body.employeeWrite, "rejected");
    await db.user.update({ where: { id: "owner" }, data: { branchId: "fixture-branch" } });
    assert.equal(await db.auditLog.count(), before); assert.equal((await db.user.findUniqueOrThrow({ where: { id: "target" } })).name, "Fixture target");
    const good = await request(owner, "", { id: "target", phone: "9000000111", baseRevision: initial.body.employee.revision }); assert.equal(good.response.status, 200); assert.equal(good.body.recoveryContext, owner.context); assert.equal(good.body.employeeId, "target");
    const stale = await request(owner, "", { id: "target", phone: "9000000222", baseRevision: initial.body.employee.revision }); assert.equal(stale.response.status, 409); assert.equal(stale.body.employeeWrite, "rejected"); assert.equal(await db.auditLog.count(), before + 1); assert.equal((await db.user.findUniqueOrThrow({ where: { id: "target" } })).phone, "9000000111");
    report.checks.push("Changed actor/session/scope writes reject before audit or employee mutation; stale employee revision cannot overwrite newer values");
    const current = await request(hr, "?employeeId=target"); assert.equal(current.response.status, 200);
    const reset = await request(hr, "", { id: "target", password: "Synthetic-Reset-Password-2026!", baseRevision: current.body.employee.revision }); assert.equal(reset.response.status, 403); assert.equal(reset.body.employeeWrite, "rejected"); assert.equal(reset.body.recoveryContext, hr.context, "Known action-level denial keeps same-context drafts");
    const promotion = await request(hr, "", { id: "target", roleId: "OWNER", baseRevision: current.body.employee.revision }); assert.equal(promotion.response.status, 403);
    const self = await request(owner, "?employeeId=owner"); const selfDeactivate = await request(owner, "", { id: "owner", active: false, baseRevision: self.body.employee.revision }); assert.equal(selfDeactivate.response.status, 400);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: "target" } })).passwordHash, passwordHash); assert.equal(await db.auditLog.count(), before + 1);
    const legacy = await request(owner, "", { id: "target", phone: "9000000333" }, null); assert.equal(legacy.response.status, 200); assert.equal((await db.user.findUniqueOrThrow({ where: { id: "target" } })).phone, "9000000333");
    report.checks.push("Existing HR password/promotion restrictions and self-deactivation denial preserved; ordinary headerless client writes remain compatible");
    report.passed = true; console.log(`PASS employee recovery HTTP: ${report.checks.length} access/response/revision contract groups`);
  } catch (error) { report.failure = String(error); throw error; }
}, async () => { await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2)); await writeFile(join(out, "server.log"), logs); if (server) await stopFixtureChild(server); await db.$disconnect(); await rm(dir, { recursive: true, force: true }); }, (error: unknown) => { report.passed = false; report.failure += `\nCleanup: ${String(error)}`; writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2)); });
