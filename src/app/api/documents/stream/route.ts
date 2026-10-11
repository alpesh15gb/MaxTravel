import { jwtVerify } from "jose";
import { createReadStream, existsSync, statSync } from "fs";
import { Readable } from "stream";
import path from "path";
import type { ReadableStream as WebReadableStream } from "stream/web";

/** Fail closed: without a real secret anyone could mint file URLs for any stored path. */
function fileSecret(): Uint8Array {
  const raw = process.env.JWT_SECRET;
  if (!raw) throw new Error("JWT_SECRET is not configured; document links are disabled.");
  return new TextEncoder().encode(raw);
}
const ROOT = path.resolve(process.env.UPLOAD_ROOT ?? path.join(process.cwd(), "uploads"));

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t");
  if (!t) return new Response("Missing token", { status: 401 });
  try {
    const { payload } = await jwtVerify(t, fileSecret());
    const rel = String(payload.p ?? "");
    if (payload.aud !== "document-file" || !rel.startsWith("uploads/")) return new Response("Invalid token", { status: 403 });
    const resolved = path.resolve(ROOT, rel.slice("uploads/".length));
    if (!resolved.startsWith(ROOT + path.sep)) return new Response("Invalid path", { status: 403 });
    if (!existsSync(resolved)) return new Response("File not found", { status: 404 });

    const stat = statSync(resolved);
    const stream = Readable.toWeb(createReadStream(resolved)) as WebReadableStream<Uint8Array>;
    const ext = path.extname(resolved).toLowerCase();
    const mime = ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : "image/jpeg";
    return new Response(stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(stat.size),
        "Content-Disposition": `inline; filename="${path.basename(resolved)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Link expired or invalid", { status: 403 });
  }
}
