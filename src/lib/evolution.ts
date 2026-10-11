import "server-only";
import { timingSafeEqual } from "node:crypto";

export function evolutionConfig() {
  const base = process.env.EVOLUTION_BASE_URL?.replace(/\/$/, "");
  const key = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE?.trim();
  if (!base || !key || !instance) return null;
  const url = new URL(base);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid Evolution server configuration.");
  return { base, key, instance };
}

export function bearerMatches(req: Request, secret: string | undefined) {
  if (!secret || secret.length < 32) return false;
  const supplied = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function whatsappPhone(phone: string) {
  // Do not guess a country code; customer records must contain the international number.
  const value = phone.trim();
  if (!/^\+?[1-9][\d\s().-]{8,24}$/.test(value)) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export class EvolutionError extends Error {
  constructor(public uncertain: boolean, public retryable: boolean, message: string) { super(message); }
}

export async function evolutionRequest(path: string, body?: unknown) {
  const config = evolutionConfig();
  if (!config) throw new EvolutionError(false, false, "Evolution is not configured.");
  let response: Response;
  try {
    response = await fetch(`${config.base}${path}/${encodeURIComponent(config.instance)}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { apikey: config.key, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000), cache: "no-store", redirect: "error",
    });
  } catch {
    throw new EvolutionError(body !== undefined, body === undefined, "Evolution could not be reached. Check the connection.");
  }
  if (!response.ok) {
    // A 5xx after a send may arrive after WhatsApp accepted it. Never blindly resend.
    throw new EvolutionError(body !== undefined && response.status >= 500, response.status === 429,
      response.status === 401 || response.status === 403 ? "Evolution credentials were rejected." : `Evolution returned HTTP ${response.status}.`);
  }
  try { return await response.json(); }
  catch { throw new EvolutionError(body !== undefined, false, "Evolution returned an unreadable response."); }
}

export async function evolutionState(): Promise<string> {
  const data = await evolutionRequest("/instance/connectionState");
  return String(data?.instance?.state ?? "unknown");
}

export async function evolutionSend(phone: string, text: string): Promise<string> {
  const data = await evolutionRequest("/message/sendText", { number: phone, text, linkPreview: false });
  const id = data?.key?.id;
  if (typeof id !== "string" || !id) throw new EvolutionError(true, false, "Send outcome unknown. Verify in WhatsApp before sending again.");
  return id;
}

export function providerKey(id: string) { return `evolution:${evolutionConfig()?.instance}:${id}`; }
