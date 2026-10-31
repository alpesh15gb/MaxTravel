import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isMetaUnavailableBody, metaInboundContent, metaInboundHealthKey, metaMessageSchema, readMetaInboundHealth } from "../src/lib/meta-inbound";

// Every webhook and Graph call in this suite is synthetic. Never use the app DB.
const tempBase = await realpath(os.tmpdir());
const root = await mkdtemp(path.join(tempBase, "maxtravel-meta-inbound-"));
const database = path.join(root, "integration-test.db");
const previous = { ...process.env }, originalFetch = globalThis.fetch, originalWarn = console.warn;
let disconnect: (() => Promise<void>) | undefined;
try {
  const phoneId = "123456789", wabaId = "987654321", phone = "14155550181";
  const secret = randomBytes(32).toString("hex"), warnings: string[] = [];
  Object.assign(process.env, {
    DATABASE_URL: `file:${database.replaceAll("\\", "/")}`,
    CRM_DATA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    WA_PROVIDER: "meta", WA_CLOUD_ACCESS_TOKEN: "synthetic-no-network-token",
    WA_CLOUD_PHONE_NUMBER_ID: phoneId, WA_CLOUD_WABA_ID: wabaId,
    WA_CLOUD_APP_SECRET: secret, WA_CLOUD_VERIFY_TOKEN: randomBytes(32).toString("hex"),
    WA_CLOUD_GRAPH_VERSION: "v99.0", PRISMA_HIDE_UPDATE_MESSAGE: "1",
  });
  await writeFile(database, "");
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: process.env, stdio: "pipe", encoding: "utf8" });
  globalThis.fetch = async () => { throw Error("Unexpected network call in inbound webhook test"); };
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  const { prisma } = await import("../src/lib/db");
  disconnect = () => prisma.$disconnect();
  const { POST } = await import("../src/app/api/whatsapp/meta/route");
  const { attachInbound } = await import("../src/lib/evolution-webhook");
  const branch = await prisma.branch.create({ data: { name: "Synthetic branch", code: "META-INBOUND", city: "Test" } });
  const customer = await prisma.customer.create({ data: { name: "Synthetic customer", code: "META-INBOUND", phone: `+${phone}`, branchId: branch.id, city: "Test", whatsappOptIn: true } });
  const thread = await prisma.whatsAppThread.create({ data: { customerId: customer.id, phone: `+${phone}` } });
  const key = (id: string) => `meta:${phoneId}:${id}`;
  const now = () => String(Math.floor(Date.now() / 1000));
  const message = (id: string, extra: Record<string, unknown>) => ({ id, from: phone, timestamp: now(), ...extra });
  const text = (id: string, body: string) => message(id, { type: "text", text: { body } });
  async function receive(messages: unknown[], options: { signed?: boolean; account?: string; businessPhone?: string } = {}) {
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: options.account ?? wabaId, changes: [{ field: "messages", value: { metadata: { phone_number_id: options.businessPhone ?? phoneId }, messages } }] }] });
    return POST(new Request("http://localhost/api/whatsapp/meta", { method: "POST", headers: { "x-hub-signature-256": `sha256=${options.signed === false ? "0".repeat(64) : createHmac("sha256", secret).update(raw).digest("hex")}` }, body: raw }));
  }
  const inbound = (id: string) => prisma.whatsAppInbound.findUniqueOrThrow({ where: { providerKey: key(id) } });
  const stored = (id: string) => prisma.whatsAppMessage.findUniqueOrThrow({ where: { providerKey: key(id) } });
  const health = async () => readMetaInboundHealth((await prisma.settings.findUnique({ where: { key: metaInboundHealthKey(phoneId) } }))?.value);

  assert.equal((await receive([text("forged", "Forged")], { signed: false })).status, 401);
  assert.equal((await receive([text("wrong-account", "Wrong account")], { account: "111" })).status, 200);
  assert.equal((await receive([text("wrong-number", "Wrong number")], { businessPhone: "111" })).status, 200);
  assert.equal(await prisma.whatsAppInbound.count(), 0);
  assert.equal(await health(), null);

  for (const [id, value] of [["plain", "Hello, I need a flight ticket"], ["unicode", "नमस्ते ✈️\nVisa enquiry"]]) {
    assert.equal((await receive([text(id, value)])).status, 200);
    assert.equal((await stored(id)).body, value);
  }
  const unread = (await prisma.whatsAppThread.findUniqueOrThrow({ where: { id: thread.id } })).unread;
  await receive([text("plain", "A duplicate must not edit the original")]);
  await receive([message("plain", { type: "unsupported", errors: [{ code: 131051 }] })]);
  assert.equal((await stored("plain")).body, "Hello, I need a flight ticket");
  assert.equal((await prisma.whatsAppThread.findUniqueOrThrow({ where: { id: thread.id } })).unread, unread);
  assert.equal((await health())?.contentAvailable, true);

  await receive([
    message("button", { type: "button", button: { text: "Flights", payload: "flight" } }),
    message("interactive", { type: "interactive", interactive: { list_reply: { title: "Visa assistance", id: "visa" } } }),
    message("odd-label", { type: "unsupported", text: { body: "Readable content must win" }, errors: [{ code: 131051 }] }),
  ]);
  assert.equal((await stored("button")).body, "Flights");
  assert.equal((await stored("interactive")).body, "Visa assistance");
  assert.equal((await stored("odd-label")).body, "Readable content must win");

  const unavailable = message("unavailable", {
    timestamp: String(Math.floor(Date.now() / 1000) - 25 * 3600), type: "unsupported",
    errors: [{ code: 131060, title: "PRIVATE TITLE MUST NOT BE STORED", error_data: { details: "PRIVATE DETAILS MUST NOT BE STORED" } }],
  });
  await receive([unavailable]);
  const before = await stored("unavailable"), noticeUnread = (await prisma.whatsAppThread.findUniqueOrThrow({ where: { id: thread.id } })).unread;
  assert.match(before.body, /Meta error 131060/);
  assert(!before.body.includes("Incoming documents"));
  assert(!before.body.includes("PRIVATE"));
  assert.deepEqual((await health())?.errorCodes, [131060]);
  assert.equal((await health())?.contentAvailable, false);
  await receive([unavailable]);
  assert.equal(await prisma.whatsAppMessage.count({ where: { providerKey: key("unavailable") } }), 1);
  assert.equal(warnings.length, 1, "Duplicate notices must not log repeatedly");
  assert(!warnings.join(" ").includes(phone));
  assert(!warnings.join(" ").includes("PRIVATE"));

  await receive([{ ...text("unavailable", "Wrong sender"), from: "14155550182" }]);
  assert.equal((await stored("unavailable")).body, before.body);
  await receive([text("unavailable", "Recovered flight enquiry")]);
  assert.equal((await stored("unavailable")).body, "Recovered flight enquiry");
  assert.equal((await inbound("unavailable")).body, "Recovered flight enquiry");
  assert.equal((await stored("unavailable")).at.getTime(), before.at.getTime(), "Recovery must not reopen the reply window");
  assert.equal((await prisma.whatsAppThread.findUniqueOrThrow({ where: { id: thread.id } })).unread, noticeUnread);
  assert.equal((await health())?.contentAvailable, true);

  const legacyBody = "[unsupported message received; open Incoming documents for supported PDF/images]";
  const legacy = await prisma.whatsAppInbound.create({ data: { providerKey: key("legacy"), phone, body: legacyBody, reason: "MATCHED" } });
  await prisma.$transaction(tx => attachInbound(tx, legacy.id, customer.id));
  await prisma.whatsAppMessage.update({ where: { providerKey: key("legacy") }, data: { recipient: null } });
  await receive([text("legacy", "Readable legacy correction")]);
  assert.equal((await stored("legacy")).body, "Readable legacy correction");

  const hash = randomBytes(32).toString("base64");
  await receive([message("pdf", { type: "document", document: { id: "123", mime_type: "application/pdf", sha256: hash, filename: "synthetic.pdf" } })]);
  assert.match((await stored("pdf")).body, /Document received/);
  assert.equal(await prisma.incomingMedia.count({ where: { providerKey: key("pdf") } }), 1);
  await receive([message("pdf", { type: "document", document: { id: "123", mime_type: "application/pdf", sha256: hash, filename: "synthetic.pdf" } })]);
  assert.equal(await prisma.incomingMedia.count({ where: { providerKey: key("pdf") } }), 1);

  const pending = await prisma.whatsAppMessage.create({ data: { threadId: thread.id, direction: "OUT", recipient: phone, body: "Synthetic pending update", status: "QUEUED" } });
  await receive([message("stop", { type: "unsupported", errors: [{ code: 131051 }] })]);
  await receive([text("stop", "STOP")]);
  assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).whatsappOptIn, false);
  assert.equal((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: pending.id } })).status, "CANCELLED");
  assert.equal((await stored("stop")).body, "STOP");

  const blank = metaInboundContent(metaMessageSchema.parse(text("blank", "   ")));
  assert.equal(blank.available, false);
  assert(!blank.body.includes("Incoming documents"));
  assert(isMetaUnavailableBody(legacyBody));
  assert(isMetaUnavailableBody(blank.body));
  assert(!isMetaUnavailableBody("A real customer message"));
  assert.equal(readMetaInboundHealth("invalid"), null);
  assert.equal(readMetaInboundHealth('{"body":"must not be exposed"}'), null);
  const unsupportedFile = metaInboundContent(metaMessageSchema.parse(message("word", { type: "document", document: { id: "456", mime_type: "application/msword", sha256: hash } })));
  assert.match(unsupportedFile.body, /format this CRM cannot retrieve/);
  assert(!unsupportedFile.body.includes("WhatsApp did not provide"));
  assert.equal(unsupportedFile.media, undefined);
  console.log("PASS Meta inbound: signed/account-isolated text, Unicode and replies; provider error diagnostics without private content; deduplication; same-message recovery without unread/time changes; legacy repair; document intake; STOP recovery.");
} finally {
  console.warn = originalWarn;
  globalThis.fetch = originalFetch;
  await disconnect?.();
  for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
  Object.assign(process.env, previous);
  const resolved = await realpath(root);
  if (path.dirname(resolved) !== tempBase || !path.basename(resolved).startsWith("maxtravel-meta-inbound-")) throw Error("Refusing unexpected fixture cleanup path");
  await rm(resolved, { recursive: true, force: true });
}
