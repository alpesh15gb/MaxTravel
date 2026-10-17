import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "./guard";

export const PDF_LIMIT = 5 * 1024 * 1024;
function root() { return path.resolve(process.env.UPLOAD_ROOT || path.join(process.cwd(), "uploads"), "whatsapp-pdf"); }
function filePath(key: string) {
  if (!/^[a-f0-9-]{36}\.pdf$/.test(key)) throw new ApiError(400, "Invalid PDF reference.");
  return path.join(root(), key);
}
export function validatePdf(bytes: Buffer) {
  if (bytes.length < 16 || bytes.length > PDF_LIMIT || !bytes.subarray(0, 8).toString("ascii").match(/^%PDF-1\.[0-9]|^%PDF-2\.0/)
    || !bytes.subarray(-2048).includes(Buffer.from("%%EOF"))) throw new ApiError(400, "Choose a valid PDF up to 5 MB.");
}
export async function boundedPdf(req: Request) {
  if (req.headers.get("content-type")?.split(";")[0] !== "application/pdf") throw new ApiError(415, "Only PDF files are supported.");
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError(400, "Choose a PDF.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length;
    if (size > PDF_LIMIT) { await reader.cancel(); throw new ApiError(413, "PDF must be 5 MB or smaller."); } chunks.push(next.value); }
  const bytes = Buffer.concat(chunks); validatePdf(bytes); return bytes;
}
export function pdfFilename(value: string) {
  const name = value.normalize("NFKC").replace(/[^a-zA-Z0-9 ._()-]/g, "_").replace(/^\.+/, "").slice(0, 100);
  return `${name.replace(/\.pdf$/i, "") || "travel-document"}.pdf`;
}
export async function savePdf(bytes: Buffer) {
  validatePdf(bytes); const storageKey = `${randomUUID()}.pdf`;
  await mkdir(root(), { recursive: true, mode: 0o700 });
  await writeFile(filePath(storageKey), bytes, { flag: "wx", mode: 0o600 });
  return { storageKey, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}
export async function removePdf(storageKey: string) { await unlink(filePath(storageKey)); }
export async function readPdf(attachment: { storageKey: string; sha256: string; size: number }) {
  const handle = await open(filePath(attachment.storageKey), "r");
  let bytes:Buffer;try{const stat=await handle.stat();if(!stat.isFile()||stat.size>PDF_LIMIT||stat.size!==attachment.size)throw new ApiError(409,"Private PDF changed.");bytes=await handle.readFile();}finally{await handle.close();}validatePdf(bytes);
  if (bytes.length !== attachment.size || createHash("sha256").update(bytes).digest("hex") !== attachment.sha256) throw new ApiError(409, "The PDF has changed. Upload and preview it again.");
  return bytes;
}
