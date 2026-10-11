import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { providerKey, whatsappPhone } from "./evolution";

const ranks: Record<string, number> = { UNKNOWN: 0, FAILED: 0, SENDING: 0, SENT: 1, DELIVERED: 2, READ: 3 };
function receiptStatus(value: unknown): string | null {
  const status = String(value).toUpperCase();
  return ({ "0": "FAILED", ERROR: "FAILED", "2": "SENT", SERVER_ACK: "SENT", "3": "DELIVERED", DELIVERY_ACK: "DELIVERED", "4": "READ", "5": "READ", READ: "READ", PLAYED: "READ" } as Record<string,string>)[status] ?? null;
}
async function receipt(tx: Prisma.TransactionClient, id: string, status: string) {
  const key = providerKey(id);
  const setting = `wa.receipt.${key}`;
  const prior = await tx.settings.findUnique({ where: { key: setting } });
  if ((ranks[prior?.value ?? ""] ?? -1) > (ranks[status] ?? 0)) return;
  await tx.settings.upsert({ where: { key: setting }, create: { key: setting, value: status }, update: { value: status } });
  const msg = await tx.whatsAppMessage.findUnique({ where: { providerKey: key } });
  if (msg && (ranks[msg.status] ?? 0) <= (ranks[status] ?? 0)) await tx.whatsAppMessage.update({ where: { id: msg.id }, data: { status } });
}

// Store normalized content only. Evolution envelopes include credentials and must never be logged.
type RecordValue = Record<string, unknown>;
const object = (value: unknown): RecordValue => value && typeof value === "object" ? value as RecordValue : {};
function content(message: RecordValue): string | null {
  let m = message;
  for (let i=0; i<4; i++) {
    const wrapped = object(m.ephemeralMessage).message ?? object(m.viewOnceMessage).message ?? object(m.viewOnceMessageV2).message;
    if (!wrapped) break;
    m = object(wrapped);
  }
  const text = m.conversation ?? object(m.extendedTextMessage).text;
  if (typeof text === "string" && text.trim()) return text.trim().slice(0,4000);
  for (const [key,label] of [["imageMessage","Photo"],["documentMessage","Document"],["audioMessage","Voice message"],["videoMessage","Video"],["stickerMessage","Sticker"],["locationMessage","Location"],["contactMessage","Contact"]]) {
    if (m[key]) return `[${label} received — open WhatsApp to view]${typeof object(m[key]).caption === "string" ? ` ${String(object(m[key]).caption).slice(0,3000)}` : ""}`;
  }
  return null;
}

export async function attachInbound(tx: Prisma.TransactionClient, inboundId: string, customerId: string) {
  const inbound = await tx.whatsAppInbound.findUniqueOrThrow({ where: { id: inboundId } });
  if (inbound.matched) return;
  let thread = await tx.whatsAppThread.findFirst({ where: { customerId } });
  if (!thread) thread = await tx.whatsAppThread.create({ data: { customerId, phone: `+${inbound.phone}` } });
  await tx.whatsAppMessage.create({ data: { threadId: thread.id, direction: "IN", body: inbound.body, at: inbound.at, providerKey: inbound.providerKey, status: "RECEIVED" } });
  await tx.whatsAppThread.update({ where: { id: thread.id }, data: { unread: { increment: 1 }, ...(inbound.at>thread.lastMsgAt ? { lastMsgAt: inbound.at } : {}) } });
  await tx.whatsAppInbound.update({ where: { id: inboundId }, data: { matched: true, reason: "MATCHED" } });
  if (/^(stop|unsubscribe|cancel messages)$/i.test(inbound.body.trim())) {
    await tx.customer.update({ where: { id: customerId }, data: { whatsappOptIn: false } });
    await tx.whatsAppMessage.updateMany({ where: { thread: { customerId }, status: "QUEUED", automation: { not: null } }, data: { status: "CANCELLED", lastError: "Customer withdrew automatic messaging consent." } });
    await tx.auditLog.create({ data: { action: "CONSENT_WITHDRAWN", entity: "Customer", entityId: customerId, detail: "Customer opted out through WhatsApp." } });
  }
}

export async function handleEvolutionEvent(event: string, data: unknown) {
  const items = Array.isArray(data) ? data : [data];
  if (items.length > 100) throw new Error("Too many webhook entries.");
  let accepted = 0;
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as RecordValue;
    const itemKey = object(item.key);
    const id = itemKey.id ?? item.keyId;
    if (typeof id !== "string" || !id || id.length > 200) continue;
    if (event === "messages.update" || itemKey.fromMe === true) {
      const status = receiptStatus(object(item.update).status ?? item.status);
      if (status) await prisma.$transaction(tx => receipt(tx, id, status));
      continue;
    }
    if (event !== "messages.upsert" || itemKey.fromMe !== false) continue;
    const jid = String(typeof itemKey.remoteJidAlt === "string" && itemKey.remoteJidAlt.endsWith("@s.whatsapp.net") ? itemKey.remoteJidAlt : itemKey.remoteJid ?? "");
    if (!jid.endsWith("@s.whatsapp.net")) continue; // Never mistake group/broadcast/LID IDs for phone numbers.
    const phone = whatsappPhone(jid.split("@")[0].split(":")[0]);
    const body = content(object(item.message));
    if (!phone || !body) continue;
    const key = providerKey(id);
    await prisma.$transaction(async tx => {
      if (await tx.whatsAppInbound.findUnique({ where: { providerKey: key } })) return;
      const candidates = await tx.customer.findMany({ select: { id: true, phone: true } });
      const matches = candidates.filter(c => whatsappPhone(c.phone) === phone);
      const seconds = Number(item.messageTimestamp);
      const timestamp = Number.isFinite(seconds) && seconds > 0 && seconds*1000 <= Date.now()+300000 ? new Date(seconds*1000) : new Date();
      const inbound = await tx.whatsAppInbound.create({ data: { providerKey: key, phone, body, at: timestamp,
        reason: matches.length === 1 ? "MATCHED" : matches.length ? "AMBIGUOUS" : "NO_MATCH" } });
      if (matches.length === 1) await attachInbound(tx, inbound.id, matches[0].id);
    });
    accepted++;
  }
  return { accepted };
}
