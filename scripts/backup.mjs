#!/usr/bin/env node
// Backup tool for the Travel OS workspace.
//
// A backup here is two things that only make sense together: the SQLite database, and the
// private documents under UPLOAD_ROOT (rows point at those files by name, so a database-only
// copy restores into a workspace with missing attachments).
//
// The database copy is taken with SQLite's own `VACUUM INTO`, which writes a complete database
// from a read snapshot — a plain file copy of a live database can capture a torn page set.
//
// Usage:
//   node scripts/backup.mjs --out <dir> [--uploads <dir>] [--help]
//
// The backup lands in `<dir>/backup-<timestamp>/` and is never written inside a git-ignored or
// source directory unless you ask for it. Nothing here prints secret values.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PRISMA_DIR = path.join(ROOT, "prisma");
const MANIFEST_FORMAT = 1;

// Business entities whose row counts make the backup self-describing and let restore.mjs prove
// it put back what it took out. Label → Prisma client delegate.
const COUNTED_MODELS = [
  ["User", "user"],
  ["Customer", "customer"],
  ["Traveller", "traveller"],
  ["VisaCase", "visaCase"],
  ["Booking", "booking"],
  ["Ticket", "ticket"],
  ["Payment", "payment"],
  ["Invoice", "invoice"],
  ["Refund", "refund"],
  ["Document", "document"],
  ["Task", "task"],
  ["Supplier", "supplier"],
  ["WhatsAppThread", "whatsAppThread"],
  ["WhatsAppMessage", "whatsAppMessage"],
  ["Notification", "notification"],
  ["AuditLog", "auditLog"],
];

const USAGE = `Back up the Travel OS database and its uploaded documents.

Usage:
  node scripts/backup.mjs --out <dir> [--uploads <dir>] [--help]

Options:
  --out <dir>       Required. Directory that will receive backup-<timestamp>/.
  --uploads <dir>   Override UPLOAD_ROOT for this run.
  --help            Show this message.
`;

// ── Small helpers ────────────────────────────────────────────────────────────

/** An error whose message is meant for the operator, not a stack trace. */
function fail(message) {
  const error = new Error(message);
  error.operatorFacing = true;
  return error;
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

function shortHash(hash) {
  return typeof hash === "string" && hash.length >= 12 ? `${hash.slice(0, 12)}…` : String(hash ?? "");
}

/** Reads .env.local then .env, without overriding anything already set in the environment. */
async function loadEnvFiles() {
  for (const name of [".env.local", ".env"]) {
    let text;
    try {
      text = await fs.readFile(path.join(ROOT, name), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[match[1]] === undefined) process.env[match[1]] = value;
    }
  }
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) throw fail(`Unexpected argument "${token}". Run with --help for usage.`);
    const eq = token.indexOf("=");
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
    if (name === "help") {
      flags.help = true;
      continue;
    }
    if (!["out", "uploads"].includes(name)) throw fail(`Unknown option "--${name}". Run with --help for usage.`);
    let value = eq === -1 ? argv[++i] : token.slice(eq + 1);
    if (value === undefined || value === "" || value.startsWith("--")) {
      throw fail(`Option "--${name}" needs a value.`);
    }
    flags[name] = value;
  }
  return flags;
}

/** Prisma resolves `file:./dev.db` against the schema directory; so do we. */
function resolveDatabaseFile(url) {
  if (!url) {
    throw fail("DATABASE_URL is not set. Copy .env.example to .env, or export DATABASE_URL.");
  }
  if (!url.startsWith("file:")) {
    throw fail(
      "This backup tool only understands SQLite `file:` URLs. " +
        "For a hosted database use the provider's own snapshot tooling.",
    );
  }
  const raw = url.slice("file:".length).split("?")[0];
  if (!raw) throw fail("DATABASE_URL has no file path after `file:`.");
  return path.isAbsolute(raw) ? raw : path.resolve(PRISMA_DIR, raw);
}

/** The URL form Prisma wants for an absolute SQLite file (forward slashes on every OS). */
function sqliteUrlFromFile(file) {
  return `file:${file.split(path.sep).join("/")}`;
}

function openDatabase(file) {
  return new PrismaClient({
    datasources: { db: { url: sqliteUrlFromFile(file) } },
    log: ["error"],
  });
}

async function sha256File(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", resolve)
      .on("error", reject);
  });
  return hash.digest("hex");
}

/**
 * Hashes a directory tree: per-file sha256 plus one digest over the sorted
 * `path\nsha256\n` lines, so restore can detect a changed, added or removed file
 * without hashing every path by hand.
 */
async function hashTree(root) {
  const files = [];
  let symlinks = 0;

  async function walk(dir, prefix) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        symlinks += 1;
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolute, relative);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(absolute);
      files.push({ path: relative, bytes: stat.size, sha256: await sha256File(absolute) });
    }
  }

  await walk(root, "");
  const digest = createHash("sha256");
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.bytes;
    digest.update(`${file.path}\n${file.sha256}\n`);
  }
  return { fileCount: files.length, totalBytes, digest: digest.digest("hex"), files, symlinks };
}

async function rowCounts(prisma) {
  const counts = {};
  const errors = {};
  for (const [label, delegate] of COUNTED_MODELS) {
    try {
      counts[label] = await prisma[delegate].count();
    } catch (error) {
      counts[label] = null;
      errors[label] = String(error?.message ?? error).split("\n")[0];
    }
  }
  return { counts, errors };
}

/** Which migrations Prisma has applied, when the database uses Prisma Migrate at all. */
async function migrationState(prisma) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT migration_name, finished_at FROM _prisma_migrations WHERE rolled_back_at IS NULL ORDER BY finished_at",
    );
    const list = Array.isArray(rows) ? rows : [];
    return {
      migrationsTable: true,
      appliedMigrations: list.length,
      lastApplied: list.length ? String(list[list.length - 1].migration_name) : null,
    };
  } catch {
    return { migrationsTable: false, appliedMigrations: 0, lastApplied: null };
  }
}

// ── Backup ───────────────────────────────────────────────────────────────────

async function run() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (!flags.out) throw fail("Missing required option --out <dir>. Run with --help for usage.");

  await loadEnvFiles();

  const databaseFile = resolveDatabaseFile(process.env.DATABASE_URL);
  const uploadsDir = path.resolve(ROOT, flags.uploads ?? process.env.UPLOAD_ROOT ?? "./uploads");
  const outRoot = path.resolve(process.cwd(), flags.out);

  try {
    const stat = await fs.stat(databaseFile);
    if (!stat.isFile()) throw fail(`Not a file: ${databaseFile}`);
  } catch (error) {
    if (error?.operatorFacing) throw error;
    throw fail(`Database file not found at ${databaseFile}. Check DATABASE_URL in .env.`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(outRoot, `backup-${stamp}`);
  await fs.mkdir(path.join(backupDir, "database"), { recursive: true });

  const prisma = openDatabase(databaseFile);
  let manifest;
  try {
    // VACUUM INTO refuses to overwrite, so the destination must not exist yet.
    const databaseCopy = path.join(backupDir, "database", path.basename(databaseFile));
    const sqliteLiteral = databaseCopy.split(path.sep).join("/").replace(/'/g, "''");
    const vacuum = `VACUUM INTO '${sqliteLiteral}'`;
    try {
      await prisma.$executeRawUnsafe(vacuum);
    } catch (error) {
      // Some Prisma/SQLite driver pairings classify VACUUM INTO as a query that returns rows
      // rather than a plain execute. Retry once through the query path — a partial destination
      // from the first attempt has to go first, because VACUUM INTO refuses to overwrite.
      try {
        await fs.rm(databaseCopy, { force: true });
        await prisma.$queryRawUnsafe(vacuum);
      } catch (retryError) {
        throw fail(
          `Could not take a consistent database copy: ${String(retryError?.message ?? error?.message ?? retryError).split("\n")[0]}\n` +
            "A plain file copy was refused on purpose — it can capture a half-written database.",
        );
      }
    }

    const databaseStat = await fs.stat(databaseCopy);
    const database = {
      fileName: path.basename(databaseCopy),
      bytes: databaseStat.size,
      sha256: await sha256File(databaseCopy),
    };

    let uploads = { present: false, fileCount: 0, totalBytes: 0, digest: null, files: [], symlinks: 0 };
    try {
      const uploadsStat = await fs.stat(uploadsDir);
      if (uploadsStat.isDirectory()) {
        const tree = await hashTree(uploadsDir);
        await fs.cp(uploadsDir, path.join(backupDir, "uploads"), {
          recursive: true,
          preserveTimestamps: true,
        });
        uploads = { present: true, ...tree };
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      // No uploads directory yet is a valid (empty) workspace, not a failure.
    }

    const { counts, errors } = await rowCounts(prisma);
    const packageJson = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));

    manifest = {
      formatVersion: MANIFEST_FORMAT,
      createdAt: new Date().toISOString(),
      app: { name: packageJson.name ?? "travel-os", version: packageJson.version ?? "0.0.0" },
      runtime: { node: process.version, platform: process.platform },
      source: {
        // Relative paths only: a manifest is a private artifact, but it need not leak a home
        // directory or a username if it is ever copied off the machine.
        databaseFile: path.relative(ROOT, databaseFile) || path.basename(databaseFile),
        uploadsDir: uploads.present ? path.relative(ROOT, uploadsDir) || "." : null,
        databaseUrlKind: "sqlite",
      },
      database,
      uploads,
      schema: await migrationState(prisma),
      rowCounts: counts,
    };
    if (Object.keys(errors).length) manifest.rowCountErrors = errors;

    await fs.writeFile(
      path.join(backupDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
  } finally {
    await prisma.$disconnect().catch(() => {});
  }

  const counted = Object.values(manifest.rowCounts).filter((n) => typeof n === "number");
  const totalRows = counted.reduce((sum, n) => sum + n, 0);

  console.log("Backup complete.");
  console.log(`  backup:   ${backupDir}`);
  console.log(
    `  database: ${manifest.source.databaseFile} → database/${manifest.database.fileName}` +
      ` (${humanBytes(manifest.database.bytes)}, sha256 ${shortHash(manifest.database.sha256)})`,
  );
  if (manifest.uploads.present) {
    console.log(
      `  uploads:  ${manifest.uploads.fileCount} file(s), ${humanBytes(manifest.uploads.totalBytes)}` +
        `, sha256 ${shortHash(manifest.uploads.digest)}`,
    );
    if (manifest.uploads.symlinks) {
      console.log(`  note:     ${manifest.uploads.symlinks} symbolic link(s) were listed but not copied`);
    }
  } else {
    console.log("  uploads:  none (UPLOAD_ROOT has no files yet)");
  }
  console.log(
    `  entities: ${counted.length}/${COUNTED_MODELS.length} models, ${totalRows} row(s)` +
      (manifest.rowCountErrors ? ` — ${Object.keys(manifest.rowCountErrors).length} model(s) could not be counted` : ""),
  );
  console.log(`  manifest: ${path.join(backupDir, "manifest.json")}`);
  console.log("");
  console.log(`Verify this backup with: node scripts/restore.mjs --in "${backupDir}" --out <fresh-dir>`);
}

run().catch((error) => {
  console.error(`Error: ${error?.message ?? error}`);
  if (process.env.TRAVELOS_DEBUG && !error?.operatorFacing) console.error(error);
  process.exitCode = 1;
});
