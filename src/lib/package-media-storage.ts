import path from "node:path";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { ApiError } from "./guard";
import { resolveSqlitePath } from "./config";
import { scanUpload } from "./upload-scan";
import { PACKAGE_MEDIA_ID } from "./package-media-path";

export const MAX_MEDIA_INPUT = 5 * 1024 * 1024;
export const MAX_MEDIA_BYTES = 3 * 1024 * 1024;
export const MAX_PACKAGE_MEDIA = 24;
export const MAX_PACKAGE_MEDIA_BYTES = 48 * 1024 * 1024;
export function mediaRoot() {
  const db = resolveSqlitePath(process.env.DATABASE_URL ?? "");
  if (!process.env.PACKAGE_MEDIA_ROOT && !db) throw new ApiError(503, "Package media storage is not configured.");
  return path.resolve(process.env.PACKAGE_MEDIA_ROOT || path.join(path.dirname(db!), "package-media"));
}
async function checkedRoot(create = false) {
  const root = mediaRoot();
  const privateRoot = path.resolve(process.env.UPLOAD_ROOT || "uploads");
  const publicRoot = path.resolve("public");
  if ([privateRoot, publicRoot].some(p => root === p || root.startsWith(p + path.sep) || p.startsWith(root + path.sep))) throw new ApiError(503, "Package media must use isolated storage.");
  if (create) await fs.mkdir(root, { recursive: true, mode: 0o700 });
  // Reject symlinks in the root or any parent; never follow a configured alias into another tree.
  if (await fs.realpath(root) !== root || !(await fs.lstat(root)).isDirectory()) throw new ApiError(503, "Package media storage must not use symlinks.");
  return root;
}
function filename(id: string) {
  if (!PACKAGE_MEDIA_ID.test(id)) throw new ApiError(404, "Image not found.");
  return `${id}.webp`;
}
export async function normalizePackageImage(input: Buffer, declaredType: string) {
  if (!input.length || input.length > MAX_MEDIA_INPUT) throw new ApiError(413, "Choose an image smaller than 5 MiB.");
  const kind = input.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "png" : input[0] === 255 && input[1] === 216 && input[2] === 255 ? "jpeg" : input.toString("ascii", 0, 4) === "RIFF" && input.toString("ascii", 8, 12) === "WEBP" ? "webp" : "";
  if (!kind || declaredType !== `image/${kind}`) throw new ApiError(415, "Choose a genuine JPEG, PNG or WebP image. SVG and animated images are not supported.");
  if (kind === "png") {
    // Some PNG decoders expose only the first APNG frame. Inspect actual chunk boundaries,
    // never a substring search in compressed pixels, to enforce the still-image contract.
    for (let offset = 8; offset + 12 <= input.length;) {
      const length = input.readUInt32BE(offset);
      if (length > input.length - offset - 12) throw new ApiError(422, "The PNG image is truncated.");
      const chunk = input.toString("ascii", offset + 4, offset + 8);
      if (chunk === "acTL") throw new ApiError(422, "Animated PNG images are not supported. Choose a still image.");
      offset += length + 12;
      if (chunk === "IEND") break;
    }
  }
  await scanUpload(input);
  try {
    const decoder = sharp(input, { limitInputPixels: 20_000_000, failOn: "warning", animated: true });
    const metadata = await decoder.metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > 20_000_000 || (metadata.pages ?? 1) !== 1 || metadata.format !== kind) throw Error("Unsupported image dimensions or animation");
    const { data, info } = await decoder.rotate().resize(2400, 2400, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    if (data.length > MAX_MEDIA_BYTES) throw new ApiError(413, "This image remains too large after processing. Choose a smaller image.");
    if (data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP" || data.readUInt32LE(4) + 8 !== data.length) throw Error("Invalid normalized WebP");
    return { bytes: data, width: info.width, height: info.height, sha256: createHash("sha256").update(data).digest("hex") };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(422, "Image could not be safely decoded. Choose a still image up to 20 megapixels.");
  }
}
export async function writePackageImage(id: string, bytes: Buffer) {
  const root = await checkedRoot(true), final = path.join(root, filename(id));
  const temp = path.join(root, `.${randomUUID()}.tmp`);
  const handle = await fs.open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await fs.link(temp, final);
  } finally { await fs.unlink(temp); }
}
/** Only for a just-created asset whose DB transaction failed. Never deletes existing assets. */
export async function removeFailedPackageImage(id: string) { await fs.unlink(path.join(await checkedRoot(), filename(id))).catch(() => {}); }
export async function readPackageImage(asset: { id: string; storageName: string; byteSize: number; sha256: string }) {
  if (asset.storageName !== filename(asset.id) || asset.byteSize < 1 || asset.byteSize > MAX_MEDIA_BYTES) throw new ApiError(404, "Image not found.");
  const root = await checkedRoot();
  const handle = await fs.open(path.join(root, asset.storageName), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== asset.byteSize) throw new ApiError(404, "Image not found.");
    // Bounded read even if a damaged file grows after fstat; never allocate arbitrary disk size.
    const buffer = Buffer.alloc(asset.byteSize + 1); let length = 0;
    while (length < buffer.length) { const read = await handle.read(buffer, length, buffer.length - length, length); if (!read.bytesRead) break; length += read.bytesRead; }
    const bytes = buffer.subarray(0, length);
    if (bytes.length !== asset.byteSize || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new ApiError(404, "Image not found.");
    return bytes;
  } finally { await handle.close(); }
}
export async function boundedMediaForm(req: Request) {
  const cap = MAX_MEDIA_INPUT + 65536;
  if (Number(req.headers.get("content-length")) > cap) throw new ApiError(413, "Choose an image smaller than 5 MiB.");
  if (!req.headers.get("content-type")?.startsWith("multipart/form-data;") || !req.body) throw new ApiError(415, "Send an image upload form.");
  const reader = req.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > cap) { await reader.cancel(); throw new ApiError(413, "Choose an image smaller than 5 MiB."); } chunks.push(part.value); } }
  finally { reader.releaseLock(); }
  try { return await new Response(Buffer.concat(chunks), { headers: { "Content-Type": req.headers.get("content-type")! } }).formData(); }
  catch { throw new ApiError(400, "The image upload form is invalid."); }
}
