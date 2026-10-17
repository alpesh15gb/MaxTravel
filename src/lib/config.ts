// The configuration contract for running the agency workspace.
//
// A misconfigured deploy used to look healthy until the first person tried to sign in: the session
// secret was read into a constant at import time, so a missing JWT_SECRET only surfaced as a
// failed sign-in, and a database path typo surfaced as a 500 on the first query. This module turns
// those into one readable message at boot instead.
//
// It is deliberately pure: it reads from the environment passed in, never from a file, and it
// never prints a secret. The instrumentation hook (src/instrumentation.ts) calls assertConfig()
// once when a server instance starts — not during `next build`, which must not need real config.

import fs from "node:fs";
import path from "node:path";

export const MIN_SECRET_BYTES = 32;
export const SESSION_HOURS = 12;

export interface ConfigIssue {
  level: "error" | "warning";
  /** The environment variable the issue is about. */
  key: string;
  message: string;
}

const DATABASE_SCHEMES = ["file:"];

/**
 * Prisma resolves a relative `file:` URL against the directory holding schema.prisma, so
 * `file:./dev.db` is `<root>/prisma/dev.db`. Mirroring that here keeps the boot check honest.
 */
export function resolveSqlitePath(databaseUrl: string, root = process.cwd()): string | null {
  if (!databaseUrl.startsWith("file:")) return null;
  const raw = databaseUrl.slice("file:".length).replace(/^\/\//, "");
  if (!raw) return null;
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(root, "prisma", raw);
}

/**
 * Every problem worth telling an operator about, most serious first. Errors stop the process;
 * warnings are logged and the app keeps serving.
 */
export function checkConfig(env: NodeJS.ProcessEnv = process.env, root = process.cwd()): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const production = env.NODE_ENV === "production";

  // ── Session signing ────────────────────────────────────────────────────────────────────────
  const secret = env.JWT_SECRET ?? "";
  if (!secret) {
    issues.push({
      level: "error",
      key: "JWT_SECRET",
      message:
        "JWT_SECRET is not set, so staff sessions cannot be signed. Generate one with:\n" +
        '      node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    });
  } else if (Buffer.byteLength(secret) < MIN_SECRET_BYTES) {
    issues.push({
      level: "error",
      key: "JWT_SECRET",
      message: `JWT_SECRET is ${Buffer.byteLength(secret)} bytes; at least ${MIN_SECRET_BYTES} are required. Replace it with a freshly generated 32-byte value.`,
    });
  } else if (/^(changeme|secret|password|test|demo)/i.test(secret)) {
    issues.push({
      level: "error",
      key: "JWT_SECRET",
      message: "JWT_SECRET looks like a placeholder, which would let anyone forge a session. Replace it with a generated random value.",
    });
  }

  // ── Database ───────────────────────────────────────────────────────────────────────────────
  const databaseUrl = env.DATABASE_URL ?? "";
  if (!databaseUrl) {
    issues.push({
      level: "error",
      key: "DATABASE_URL",
      message: 'DATABASE_URL is not set. For a single machine use DATABASE_URL="file:./dev.db".',
    });
  } else if (!DATABASE_SCHEMES.some((scheme) => databaseUrl.startsWith(scheme))) {
    issues.push({
      level: "error",
      key: "DATABASE_URL",
      message: `DATABASE_URL must start with one of ${DATABASE_SCHEMES.join(", ")}.`,
    });
  } else {
    const file = resolveSqlitePath(databaseUrl, root);
    if (file) {
      const dir = path.dirname(file);
      if (!fs.existsSync(dir)) {
        issues.push({
          level: "error",
          key: "DATABASE_URL",
          message: `The directory for the SQLite database does not exist: ${dir}. Create it (and mount it) before starting the app.`,
        });
      } else {
        try {
          fs.accessSync(dir, fs.constants.W_OK);
        } catch {
          issues.push({
            level: "error",
            key: "DATABASE_URL",
            message: `The directory for the SQLite database is not writable: ${dir}.`,
          });
        }
      }
    }
  }

  // ── Private document storage ───────────────────────────────────────────────────────────────
  // Uploads are private customer documents. If UPLOAD_ROOT ever pointed inside public/, Next would
  // serve passports and bank statements as plain static files, which is the one mistake here that
  // cannot be undone after the fact.
  const uploadRoot = path.resolve(root, env.UPLOAD_ROOT || "./uploads");
  const publicDir = path.resolve(root, "public");
  const within = (child: string, parent: string) => child === parent || child.startsWith(parent + path.sep);
  if (env.UPLOAD_ROOT && within(uploadRoot, publicDir)) {
    issues.push({
      level: "error",
      key: "UPLOAD_ROOT",
      message: `UPLOAD_ROOT points inside public/ (${uploadRoot}), which would serve private customer documents as public files. Choose a directory outside the app's public folder.`,
    });
  } else if (env.UPLOAD_ROOT && within(uploadRoot, path.resolve(root, ".next"))) {
    issues.push({
      level: "error",
      key: "UPLOAD_ROOT",
      message: "UPLOAD_ROOT points inside the build output, which is replaced on every deploy. Choose a durable directory.",
    });
  } else if (!fs.existsSync(uploadRoot)) {
    issues.push({
      level: "warning",
      key: "UPLOAD_ROOT",
      message: `UPLOAD_ROOT does not exist yet (${uploadRoot}); the app creates it on first upload. Back this directory up along with the database.`,
    });
  }

  // ── Optional: the public origin of the workspace ────────────────────────────────────────────
  const origin = env.APP_ORIGIN ?? "";
  if (origin) {
    try {
      const url = new URL(origin);
      if (!["http:", "https:"].includes(url.protocol) || url.pathname !== "/" || url.search || url.hash) {
        throw new Error("not an origin");
      }
    } catch {
      issues.push({
        level: "error",
        key: "APP_ORIGIN",
        message: `APP_ORIGIN must be a bare http(s) origin such as https://office.example.com (no path, query or fragment). Got: ${origin}`,
      });
    }
  } else if (production) {
    issues.push({
      level: "warning",
      key: "APP_ORIGIN",
      message:
        "APP_ORIGIN is not set. Cross-site write protection then compares the request's Origin with its Host header, which is weaker behind a reverse proxy. Set it to the address staff actually use.",
    });
  }

  // ── Optional: the inbound WhatsApp webhook ─────────────────────────────────────────────────
  // Half-configured is worse than off: the webhook answers 503 when either value is missing, so a
  // single token silently disables it. Say so rather than letting an operator wonder.
  const hasVerify = Boolean(env.WA_VERIFY_TOKEN);
  const hasSecret = Boolean(env.WA_WEBHOOK_SECRET);
  if (hasVerify !== hasSecret && !env.EVOLUTION_BASE_URL && env.WA_PROVIDER!=="meta") {
    issues.push({
      level: "warning",
      key: hasVerify ? "WA_WEBHOOK_SECRET" : "WA_VERIFY_TOKEN",
      message: "The inbound WhatsApp webhook needs both WA_VERIFY_TOKEN and WA_WEBHOOK_SECRET; with only one set it stays disabled.",
    });
  }

  if (env.WA_PROVIDER==="evolution" && (env.EVOLUTION_BASE_URL || env.EVOLUTION_API_KEY)) {
    for (const key of ["EVOLUTION_BASE_URL", "EVOLUTION_API_KEY", "EVOLUTION_INSTANCE", "WA_WEBHOOK_SECRET", "WA_WORKER_SECRET"] as const) {
      if (!env[key]) issues.push({ level: "error", key, message: `${key} is required when Evolution messaging is enabled.` });
    }
    for (const key of ["WA_WEBHOOK_SECRET", "WA_WORKER_SECRET"] as const) {
      if (env[key] && env[key]!.length < 32) issues.push({ level: "error", key, message: `${key} must contain at least 32 characters.` });
    }
    try {
      const url = new URL(env.EVOLUTION_BASE_URL ?? "");
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    } catch { issues.push({ level: "error", key: "EVOLUTION_BASE_URL", message: "EVOLUTION_BASE_URL must be an http(s) URL without embedded credentials, query or fragment." }); }
  }

  if(env.WA_PROVIDER==="meta"&&["WA_CLOUD_ACCESS_TOKEN","WA_CLOUD_PHONE_NUMBER_ID","WA_CLOUD_WABA_ID","WA_CLOUD_APP_SECRET","WA_CLOUD_VERIFY_TOKEN","WA_CLOUD_GRAPH_VERSION"].some(key=>env[key])){
    for(const key of ["WA_CLOUD_ACCESS_TOKEN","WA_CLOUD_PHONE_NUMBER_ID","WA_CLOUD_WABA_ID","WA_CLOUD_APP_SECRET","WA_CLOUD_VERIFY_TOKEN","WA_CLOUD_GRAPH_VERSION","WA_WORKER_SECRET"])if(!env[key])issues.push({level:"error",key,message:`${key} is required for Meta Cloud API.`});
  }
  if(env.WA_PROVIDER==="meta"){
    for(const key of ["WA_CLOUD_PHONE_NUMBER_ID","WA_CLOUD_WABA_ID"])if(env[key]&&!/^\d+$/.test(env[key]!))issues.push({level:"error",key,message:`${key} must be the numeric Meta identifier.`});
    if(env.WA_CLOUD_GRAPH_VERSION&&!/^v\d+\.\d+$/.test(env.WA_CLOUD_GRAPH_VERSION))issues.push({level:"error",key:"WA_CLOUD_GRAPH_VERSION",message:"Use an explicit supported Graph version, for example vNN.0 from Meta's API setup."});
    for(const key of ["WA_CLOUD_APP_SECRET","WA_CLOUD_VERIFY_TOKEN","WA_WORKER_SECRET"])if(env[key]&&env[key]!.length<32)issues.push({level:"error",key,message:`${key} must contain at least 32 characters.`});
  }
  const encryptionKey=env.CRM_DATA_ENCRYPTION_KEY;
  if(encryptionKey&&!/^[a-f0-9]{64}$/i.test(encryptionKey))issues.push({level:"error",key:"CRM_DATA_ENCRYPTION_KEY",message:"Use a stable, private 32-byte hexadecimal encryption key."});
  if(env.CRM_REQUIRE_MFA==="true"&&!encryptionKey)issues.push({level:"error",key:"CRM_DATA_ENCRYPTION_KEY",message:"Configure the encryption key before enforcing staff authenticators."});
  if(!encryptionKey)issues.push({level:"warning",key:"CRM_DATA_ENCRYPTION_KEY",message:"Sensitive-field encryption and authenticator enrolment need a private encryption key. Legacy plaintext records require explicit backfill."});
  if(env.UPLOAD_SCAN_REQUIRED==="true"&&!env.CLAMAV_HOST)issues.push({level:"error",key:"CLAMAV_HOST",message:"Required upload scanning needs a reachable private scanner."});
  return issues;
}

/** Errors only, in the order they should be fixed. */
export const configErrors = (env: NodeJS.ProcessEnv = process.env, root = process.cwd()) =>
  checkConfig(env, root).filter((i) => i.level === "error");

/**
 * The origin to put in a link we generate and hand to somebody else — a customer's document upload
 * link, for instance.
 *
 * APP_ORIGIN wins whenever it is set, because behind a reverse proxy the request's own host is often
 * the internal one: building the link from the request URL then sends the customer to a host they
 * cannot open, and the link quietly dies. When APP_ORIGIN is absent we fall back to the request,
 * which is exactly the weaker case checkConfig() already warns about in production.
 *
 * Returns null when neither is usable, so a caller can decide what to do rather than emit "null".
 */
export function publicOrigin(requestUrl?: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.APP_ORIGIN;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // A malformed APP_ORIGIN is already an error in checkConfig; fall through to the request.
    }
  }
  if (!requestUrl) return null;
  try {
    return new URL(requestUrl).origin;
  } catch {
    return null;
  }
}

export const configWarnings = (env: NodeJS.ProcessEnv = process.env, root = process.cwd()) =>
  checkConfig(env, root).filter((i) => i.level === "warning");

/**
 * The full message an operator sees when the app cannot start. Kept in one place so the thrown error
 * and the start-up log can never drift apart.
 */
export function formatConfigErrors(errors: ConfigIssue[]): string {
  const detail = errors.map((e) => `  - ${e.key}: ${e.message}`).join("\n");
  return (
    `Max Travel CRM cannot start: ${errors.length} configuration ${errors.length === 1 ? "problem" : "problems"}.\n${detail}\n` +
    "See docs/operations.md for the full list of variables."
  );
}

/**
 * Throws one readable Error listing every configuration error, so a bad deploy fails at start-up
 * with the fix in the message instead of serving 500s to staff.
 */
export function assertConfig(env: NodeJS.ProcessEnv = process.env, root = process.cwd()): void {
  const errors = configErrors(env, root);
  if (!errors.length) return;
  throw new Error(formatConfigErrors(errors));
}

/**
 * A one-line start-up summary safe to write to a log: where data lives, never what the secrets are.
 * Showing only whether secret material is present is enough to debug a deploy without leaking it.
 */
export function configSummary(env: NodeJS.ProcessEnv = process.env, root = process.cwd()): string {
  const file = resolveSqlitePath(env.DATABASE_URL ?? "", root);
  const database = file
    ? `sqlite ${file}${fs.existsSync(file) ? "" : " (created on first migration)"}`
    : (env.DATABASE_URL ?? "").split(":")[0] || "unset";
  const uploads = path.resolve(root, env.UPLOAD_ROOT || "./uploads");
  return [
    `database=${database}`,
    `uploads=${uploads}`,
    `session=${SESSION_HOURS}h`,
    `secret=${env.JWT_SECRET ? `${Buffer.byteLength(env.JWT_SECRET)} bytes` : "MISSING"}`,
    `origin=${env.APP_ORIGIN || "inferred from request host"}`,
  ].join(" · ");
}
