/** Real HTTP route, isolated SQLite and manual logging only. Never processes an outbound queue. */
import assert from "node:assert/strict";
import { mkdtemp, rm, cp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { within, withFixtureCleanup, stopFixtureChild } from "./fixture-lifecycle.mjs";
const dir = await mkdtemp(join(tmpdir(), "whatsapp-idempotency-")), database = `file:${join(dir, "fixture.db")}`;
const base = "http://127.0.0.1:3382", secret = randomBytes(48).toString("hex"), out = resolve("test-artifacts/whatsapp-manual-idempotency");
await mkdir(out, { recursive: true });
await writeFile(join(dir, "schema.prisma"), await readFile(new URL("../prisma/schema.prisma", import.meta.url)));
await cp(new URL("../prisma/migrations", import.meta.url), join(dir, "migrations"), { recursive: true });
const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: database, APP_ORIGIN: base, JWT_SECRET: secret, UPLOAD_ROOT: join(dir, "uploads"), NEXT_TELEMETRY_DISABLED: "1" };
for (const key of Object.keys(env)) if (/^(WA_|EVOLUTION_|CRM_REQUIRE_MFA$)/.test(key)) delete env[key];
env.WA_PROVIDER = "manual";
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", join(dir, "schema.prisma")], { env, stdio: "pipe" });
const db = new PrismaClient({ datasources: { db: { url: database } } });
let server: ChildProcessWithoutNullStreams | undefined, logs = "", cookie = "";
const report = { passed: false, checks: [] as string[], failure: "", concurrencyStatuses: [] as number[] };
async function start(configured = false) {
  if (server) await stopFixtureChild(server);
  const childEnv = { ...env, ...(configured ? { WA_PROVIDER: "meta", WA_CLOUD_ACCESS_TOKEN: "synthetic-not-a-token", WA_CLOUD_PHONE_NUMBER_ID: "111", WA_CLOUD_WABA_ID: "222", WA_CLOUD_GRAPH_VERSION: "v99.0", WA_CLOUD_APP_SECRET: secret, WA_CLOUD_VERIFY_TOKEN: secret, WA_WORKER_SECRET: secret } : {}) };
  // Only an existing manual row is replayed with config present. No new provider enqueue/send is attempted.
  server = spawn(process.execPath, ["--import", "./tests/whatsapp-no-provider.mjs", "node_modules/next/dist/bin/next", "start", "--port", "3382", "--hostname", "127.0.0.1"], { env: childEnv, stdio: "pipe" });
  let spawnError = ""; server.stdout.on("data", value => logs += value); server.stderr.on("data", value => logs += value); server.on("error", error => spawnError = String(error));
  await within((async () => { while (true) {
    assert(!spawnError && server?.exitCode === null && server.signalCode === null, `Owned server exited: ${spawnError}\n${logs}`);
    try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) return; } catch { /* owned startup */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  } })(), 90000, "manual idempotency fixture startup");
}
async function session(id: string) {
  const sessionId = randomUUID(); await db.staffSession.create({ data: { id: sessionId, userId: id, expiresAt: new Date(Date.now() + 3600000), agent: "Synthetic idempotency fixture" } });
  const value = await new SignJWT({ id, sessionId, authVersion: createHash("sha256").update("fixture-not-a-password-hash").digest("hex") }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(secret));
  return `tos_session=${value}`;
}
async function send(body: unknown, expected?: number) {
  const response = await fetch(`${base}/api/whatsapp/send`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base, Cookie: cookie }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const data = await response.json(); if (expected !== undefined) assert.equal(response.status, expected, JSON.stringify(data));
  return { status: response.status, data };
}
const counts = async () => ({ messages: await db.whatsAppMessage.count(), activity: await db.activity.count({ where: { type: "WHATSAPP" } }), audit: await db.auditLog.count({ where: { entity: "WhatsAppMessage" } }) });
await withFixtureCleanup(async () => {
  try {
    await db.role.createMany({ data: [{ id: "owner", key: "OWNER", name: "Fixture owner", desc: "Synthetic" }, { id: "manager", key: "BRANCH_MANAGER", name: "Fixture manager", desc: "Synthetic" }] });
    await db.branch.createMany({ data: [{ id: "branch-a", code: "A", name: "Fixture A", city: "Test" }, { id: "branch-b", code: "B", name: "Fixture B", city: "Test" }] });
    for (const id of ["actor-a", "actor-b"]) await db.user.create({ data: { id, employeeCode: id, name: id, email: `${id}@example.test`, phone: "", passwordHash: "fixture-not-a-password-hash", roleId: "owner", branchId: "branch-a" } });
    for (const id of ["customer-a", "customer-b", "no-phone"]) await db.customer.create({ data: { id, code: id, name: id, phone: id === "no-phone" ? "" : "+15550000001", city: "Test", branchId: "branch-a" } });
    cookie = await session("actor-a"); const actorA = cookie, actorB = await session("actor-b");
    await start();
    const body = { customerId: "customer-a", text: "Synthetic private A message", requestId: randomUUID() };
    const first = (await send(body, 200)).data; assert.equal(first.status, "LOGGED"); assert.match(first.whatsappUrl, /^https:\/\/wa\.me\/15550000001\?/);
    const once = await counts(); assert.deepEqual(once, { messages: 1, activity: 1, audit: 1 });
    assert.deepEqual((await send(body, 200)).data, first); assert.deepEqual(await counts(), once);
    await send({ ...body, text: "Changed text" }, 409); await send({ ...body, customerId: "customer-b" }, 409); await send({ ...body, template: "OTHER" }, 409);
    await send({ ...body, attachmentId: "not-a-real-attachment" }, 400); assert.deepEqual(await counts(), once);
    await send({ ...body, requestId: "invalid" }, 400); assert.deepEqual(await counts(), once);
    await db.customer.update({ where: { id: "customer-a" }, data: { phone: "+15550000099" } });
    assert.deepEqual((await send(body, 200)).data, first, "Replay uses frozen recipient, not changed phone");
    const noPhoneBody = { customerId: "no-phone", text: "No original phone", requestId: randomUUID() };
    const noPhone = (await send(noPhoneBody, 200)).data; assert.equal(noPhone.whatsappUrl, null);
    await db.customer.update({ where: { id: "no-phone" }, data: { phone: "+15550000098" } });
    assert.deepEqual((await send(noPhoneBody, 200)).data, noPhone, "Phone repair cannot create a handoff absent from original log");
    report.checks.push("Same-ID logs/activity/audit commit once; changed payload/customer/template/attachment rejected; frozen and null-recipient provenance preserved");
    const templateBody = { customerId: "customer-a", text: "Identical rendered text", template: "TEMPLATE_A", requestId: randomUUID() };
    const templateFirst = (await send(templateBody, 200)).data; assert.deepEqual((await send(templateBody, 200)).data, templateFirst);
    const beforeTemplate = await counts(); await send({ ...templateBody, template: "TEMPLATE_B" }, 409); assert.deepEqual(await counts(), beforeTemplate);
    const concurrent = { customerId: "customer-b", text: "Concurrent same-ID fixture", requestId: randomUUID() }, beforeRace = await counts();
    const race = await Promise.all([send(concurrent), send(concurrent)]); report.concurrencyStatuses = race.map(result => result.status);
    assert(race.some(result => result.status === 200), JSON.stringify(race)); assert(race.every(result => [200, 409, 500].includes(result.status)), JSON.stringify(race));
    const acknowledged = race.find(result => result.status === 200)!.data;
    assert.deepEqual((await send(concurrent, 200)).data, acknowledged, "An explicit same-ID replay reconciles a lost/contended response without re-execution");
    const afterRace = await counts(); assert.deepEqual(afterRace, { messages: beforeRace.messages + 1, activity: beforeRace.activity + 1, audit: beforeRace.audit + 1 });
    report.checks.push("Concurrent duplicates create exactly one message/activity/audit; contention is safely reconcilable, not evidence that nothing committed");
    cookie = actorB; const otherActor = (await send(body, 200)).data; assert.notEqual(otherActor.messageId, first.messageId);
    assert.deepEqual((await send(body, 200)).data, otherActor); cookie = actorA;
    await db.user.update({ where: { id: "actor-a" }, data: { roleId: "manager", branchId: "branch-b" } });
    const beforeDenied = await counts(); await send(body, 403); assert.deepEqual(await counts(), beforeDenied);
    await db.user.update({ where: { id: "actor-a" }, data: { roleId: "owner", branchId: "branch-a" } });
    const legacy = { customerId: "customer-a", text: "Legacy no-ID manual log" }; const legacyA = (await send(legacy, 200)).data, legacyB = (await send(legacy, 200)).data; assert.notEqual(legacyA.messageId, legacyB.messageId);
    report.checks.push("Keys are actor-scoped; current scope is checked on replay; legacy omitted-ID manual callers remain explicitly non-idempotent");
    const beforeConfig = await counts(); await start(true);
    const inbox = await fetch(`${base}/whatsapp?customer=customer-a`, { headers: { Cookie: cookie } });
    assert.equal(inbox.status, 200); assert((await inbox.text()).includes("WhatsApp desk"), "Configured real inbox renders without provider fetch");
    assert.deepEqual((await send(body, 200)).data, first); assert.deepEqual((await send(noPhoneBody, 200)).data, noPhone);
    await send({ ...body, cloudTemplateKey: "NEW_TEMPLATE" }, 409);
    assert.deepEqual(await counts(), beforeConfig); assert.equal(await db.whatsAppMessage.count({ where: { status: { not: "LOGGED" } } }), 0);
    report.checks.push("Provider configuration appearing later cannot promote/requeue a LOGGED replay or change its frozen handoff");
    assert(!logs.includes("WHATSAPP_FIXTURE_EXTERNAL_FETCH_BLOCKED"), "No server provider/external fetch may be attempted"); report.passed = true; console.log(`PASS manual WhatsApp idempotency: ${report.checks.length} groups; concurrent statuses ${report.concurrencyStatuses.join(", ")}; zero provider actions.`);
  } catch (error) { report.failure = String(error); throw error; }
}, async () => {
  if (server) await stopFixtureChild(server); await db.$disconnect();
  await writeFile(join(out, "server.log"), logs); await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2)); await rm(dir, { recursive: true, force: true });
});
