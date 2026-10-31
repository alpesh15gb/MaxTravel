import { z } from "zod";

const mediaFields = {
  id: z.string().regex(/^\d+$/),
  mime_type: z.string().max(100),
  sha256: z.string().max(100),
  caption: z.string().max(3000).optional(),
};

export const metaMessageSchema = z.object({
  id: z.string().min(1).max(250),
  from: z.string().max(30),
  timestamp: z.string().max(20),
  type: z.string().min(1).max(80),
  text: z.object({ body: z.string().max(4096) }).optional(),
  button: z.object({ text: z.string().max(4096) }).optional(),
  interactive: z.object({
    button_reply: z.object({ title: z.string().max(4096) }).optional(),
    list_reply: z.object({ title: z.string().max(4096) }).optional(),
  }).optional(),
  document: z.object({ ...mediaFields, filename: z.string().max(200).optional() }).optional(),
  image: z.object(mediaFields).optional(),
  // Keep only numeric codes. Provider titles/details can contain private content.
  errors: z.array(z.object({ code: z.number().int().nonnegative().max(2147483647) })).max(20).optional(),
});

export type MetaMessage = z.infer<typeof metaMessageSchema>;
const supportedMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const unavailablePrefix = "[WhatsApp did not provide readable message content";

export function metaInboundContent(message: MetaMessage) {
  const type = /^[a-z_]{1,40}$/.test(message.type) ? message.type : "unknown";
  const errorCodes = [...new Set(message.errors?.map(error => error.code) ?? [])];
  const media = message.type === "document" ? message.document : message.type === "image" ? message.image : undefined;
  const supportedMedia = media && supportedMimeTypes.has(media.mime_type) ? media : undefined;
  // Prefer actual readable content, even when the provider labels the event unsupported.
  const text = [message.text?.body, message.button?.text, message.interactive?.button_reply?.title,
    message.interactive?.list_reply?.title, media?.caption].find(value => value?.trim());
  if (text) return { body: text.trim().slice(0, 4000), type, errorCodes, media: supportedMedia, available: true };
  if (supportedMedia) return {
    body: `[${type === "image" ? "Image" : "Document"} received. Open Incoming documents to retrieve it.]`,
    type, errorCodes, media: supportedMedia, available: true,
  };
  const notices: Record<string, string> = {
    audio: "[Voice message received. Audio playback is not available in this CRM.]",
    video: "[Video received. Video playback is not available in this CRM.]",
    sticker: "[Sticker received. Sticker display is not available in this CRM.]",
    reaction: "[Message reaction received.]",
    contacts: "[Contact card received. Contact-card display is not available in this CRM.]",
    location: "[Location received. Location display is not available in this CRM.]",
  };
  const body = (media ? "[File received in a format this CRM cannot retrieve. Ask the sender for a PDF, JPEG or PNG.]" : notices[type]) ?? `${unavailablePrefix}${errorCodes.length ? ` (Meta error ${errorCodes.join(", ")})` : ""}. Ask the sender to send a new plain-text message.]`;
  return { body, type, errorCodes, media: undefined, available: false };
}

export function isMetaUnavailableBody(body: string) {
  return /^\[WhatsApp did not provide readable message content(?: \(Meta error \d+(?:, \d+)*\))?\. Ask the sender to send a new plain-text message\.\]$/.test(body) ||
    /^\[(?:unsupported|unknown|text) message received; open Incoming documents for supported PDF\/images\]$/.test(body);
}

export const metaInboundHealthSchema = z.object({
  receivedAt: z.string().datetime(),
  type: z.string().max(40),
  errorCodes: z.array(z.number().int().nonnegative()).max(20),
  contentAvailable: z.boolean(),
});
export type MetaInboundHealth = z.infer<typeof metaInboundHealthSchema>;
export const metaInboundHealthKey = (phoneId: string) => `wa.meta.inbound.health.${phoneId}`;

export function readMetaInboundHealth(value: string | undefined): MetaInboundHealth | null {
  if (!value) return null;
  try {
    const parsed = metaInboundHealthSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
