#!/usr/bin/env node
// Restore tool for the Travel OS workspace.
//
// Takes a directory produced by scripts/backup.mjs and writes it into a fresh directory, then
// proves the result is good: the database checksum, every row count recorded in the manifest, and
// the uploaded-document tree must all match. A restore that cannot be verified is a failed
// restore, so verification failures exit non-zero.
//
// The source backup is only ever read. Restoring never lands on top of a live database unless
// --force says so, because a half-overwritten datastore is worse than no restore at all.
//
// Usage:
//   node scripts/restore.mjs --in <backupDir> --out <targetDir> [--force] [--help]

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

// Same label → Prisma client delegate map as backup.mjs; a manifest key we do not know about is
// reported rather than silently ignored.
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
const DELEGATES = new Map(COUNTED_MODELS);
const DATABASE_FILE_PATTERN = /\.db(?:-journal|-wal|-shm)?$/i;

const USAGE = `Restore a backup made by scripts/backup.mjs and verify it.

Usage:
  node scripts/restore.mjs --in <backupDir> --out <targetDir> [--force] [--help]

Options:
  --in <dir>    Required. A backup directory containing manifest.json.
  --out <dir>   Required. Directory to restore into (created if missing).
  --force       Allow writing into a directory that already holds a database.
  --help        Show this message.
`;

// ── Small helpers ────────────────────────────────────────────────────────────

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
    if (name === "force") {
      flags.force = true;
      continue;
    }
    if (!["in", "out"].includes(name)) throw fail(`Unknown option "--${name}". Run with --help for usage.`);
    const value = eq === -1 ? argv[++i] : token.slice(eq + 1);
    if (value === undefined || value === "" || value.startsWith("--")) {
      throw fail(`Option "--${name}" needs a value.`);
    }
    flags[name] = value;
  }
  return flags;
}

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

// ── Reading the backup ───────────────────────────────────────────────────────

async function readManifest(backupDir) {
  let raw;
  try {
    raw = await fs.readFile(path.join(backupDir, "manifest.json"), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw fail(`No manifest.json in ${backupDir}. Point --in at a directory created by scripts/backup.mjs.`);
    }
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw fail(`manifest.json in ${backupDir} is not valid JSON; the backup may be damaged.`);
  }
}

/** The backed-up database file: the name from the manifest, else the only file in database/. */
async function findBackedUpDatabase(backupDir, manifest) {
  const dir = path.join(backupDir, "database");
  let names = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    names = entries.filter((e) => e.isFile() && !e.name.startsWith(".")).map((e) => e.name);
  } catch {
    names = [];
  }
  const wanted = manifest?.database?.fileName;
  const chosen = wanted && names.includes(wanted) ? wanted : names.length === 1 ? names[0] : null;
  if (!chosen) {
    throw fail(
      names.length
        ? `Cannot tell which file in ${dir} is the database (manifest names "${wanted ?? "nothing"}").`
        : `No database file found in ${dir}; the backup is incomplete.`,
    );
  }
  const file = path.join(dir, chosen);
  if (manifest?.database?.bytes !== undefined) {
    const stat = await fs.stat(file);
    if (stat.size !== manifest.database.bytes) {
      throw fail(
        `Backed-up database is ${stat.size} bytes but the manifest records ${manifest.database.bytes}. ` +
          "The backup has been altered since it was taken.",
      );
    }
  }
  return { file, fileName: chosen };
}

async function existingDatabaseNames(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && DATABASE_FILE_PATTERN.test(e.name)).map((e) => e.name);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

// ── Restore ──────────────────────────────────────────────────────────────────

async function run() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (!flags.in) throw fail("Missing required option --in <backupDir>. Run with --help for usage.");
  if (!flags.out) throw fail("Missing required option --out <targetDir>. Run with --help for usage.");

  const backupDir = path.resolve(process.cwd(), flags.in);
  const targetDir = path.resolve(process.cwd(), flags.out);

  if (backupDir === targetDir || targetDir.startsWith(backupDir + path.sep)) {
    throw fail("--out must not be the backup directory or a directory inside it.");
  }

  let backupStat;
  try {
    backupStat = await fs.stat(backupDir);
  } catch {
    throw fail(`Backup directory not found: ${backupDir}`);
  }
  if (!backupStat.isDirectory()) throw fail(`Not a directory: ${backupDir}`);

  const manifest = await readManifest(backupDir);
  if (typeof manifest.formatVersion === "number" && manifest.formatVersion > 1) {
    console.log(`Note: this backup was written by a newer format (v${manifest.formatVersion}); verifying what is known.`);
  }
  const database = await findBackedUpDatabase(backupDir, manifest);
  const backupUploads = path.join(backupDir, "uploads");
  const hasUploads = manifest?.uploads?.present === true && (await pathExists(backupUploads));

  // Validate the full source before --force can replace any existing destination data.
  // Post-copy verification remains necessary to catch copy failures or concurrent changes.
  if (manifest?.uploads?.present === true && !hasUploads) {
    throw fail("Manifest records uploaded documents but the backup has no uploads directory; target was not modified.");
  }
  if (hasUploads) {
    const tree = await hashTree(backupUploads);
    const expected = manifest.uploads;
    if (tree.symlinks ||
        (typeof expected.fileCount === "number" && tree.fileCount !== expected.fileCount) ||
        (typeof expected.totalBytes === "number" && tree.totalBytes !== expected.totalBytes) ||
        (expected.digest && tree.digest !== expected.digest) ||
        (Array.isArray(expected.files) && diffFiles(expected.files, tree.files).length)) {
      throw fail("Backed-up uploaded document tree does not match the manifest (or contains symbolic links); target was not modified.");
    }
  }

  await fs.mkdir(targetDir, { recursive: true });
  const conflicts = await existingDatabaseNames(targetDir);
  if (conflicts.length && !flags.force) {
    throw fail(
      `Target directory already contains a database (${conflicts.join(", ")}): ${targetDir}\n` +
        "Restore into an empty directory, or pass --force to overwrite it.",
    );
  }

  // --force cannot make an existing SQLite recovery journal safe to reuse. Even a stopped
  // database can have a hot journal; opening the replacement could replay unrelated pages.
  const sidecars = [];
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    if (await pathExists(path.join(targetDir, database.fileName + suffix))) sidecars.push(database.fileName + suffix);
  }
  if (sidecars.length) throw fail(
    `Target contains SQLite recovery files (${sidecars.join(", ")}). Stop the service and restore into a fresh empty directory; --force cannot safely replace this target.`,
  );
  // Reject a damaged source before overwriting any existing target files.
  if (manifest?.database?.sha256 && await sha256File(database.file) !== manifest.database.sha256) {
    throw fail("Backed-up database checksum does not match the manifest; target was not modified.");
  }

  const restoredDatabase = path.join(targetDir, database.fileName);
  await fs.copyFile(database.file, restoredDatabase);
  if (hasUploads) {
    const restoredUploads = path.join(targetDir, "uploads");
    if (flags.force) await fs.rm(restoredUploads, { recursive: true, force: true });
    await fs.cp(backupUploads, restoredUploads, { recursive: true, preserveTimestamps: true });
  }

  // ── Verification: checksum, then row counts, then the document tree ────────
  const problems = [];
  const notes = [];

  if (manifest?.database?.sha256) {
    const restoredHash = await sha256File(restoredDatabase);
    if (restoredHash !== manifest.database.sha256) {
      problems.push(
        `database checksum mismatch (manifest ${shortHash(manifest.database.sha256)}, restored ${shortHash(restoredHash)})`,
      );
    }
  } else {
    notes.push("manifest has no database checksum; only row counts were checked");
  }

  const expectedCounts = manifest?.rowCounts ?? {};
  const checkedModels = [];
  const prisma = openDatabase(restoredDatabase);
  try {
    for (const [label, expected] of Object.entries(expectedCounts)) {
      if (typeof expected !== "number") continue;
      const delegate = DELEGATES.get(label);
      if (!delegate) {
        notes.push(`manifest counts "${label}", which this tool does not know how to count`);
        continue;
      }
      let actual;
      try {
        actual = await prisma[delegate].count();
      } catch (error) {
        problems.push(`${label} could not be counted: ${String(error?.message ?? error).split("\n")[0]}`);
        continue;
      }
      checkedModels.push(label);
      if (actual !== expected) problems.push(`${label} row count: manifest ${expected}, restored ${actual}`);
    }
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
  if (!checkedModels.length) notes.push("no row counts were available to verify");

  let restoredUploadsInfo = null;
  if (hasUploads) {
    restoredUploadsInfo = await hashTree(path.join(targetDir, "uploads"));
    const expected = manifest.uploads;
    if (typeof expected.fileCount === "number" && restoredUploadsInfo.fileCount !== expected.fileCount) {
      problems.push(`uploaded files: manifest ${expected.fileCount}, restored ${restoredUploadsInfo.fileCount}`);
    }
    if (typeof expected.totalBytes === "number" && restoredUploadsInfo.totalBytes !== expected.totalBytes) {
      problems.push(
        `uploaded bytes: manifest ${humanBytes(expected.totalBytes)}, restored ${humanBytes(restoredUploadsInfo.totalBytes)}`,
      );
    }
    if (expected.digest && restoredUploadsInfo.digest !== expected.digest) {
      const differing = diffFiles(Array.isArray(expected.files) ? expected.files : [], restoredUploadsInfo.files);
      problems.push(
        `uploaded document tree does not match the manifest` +
          (differing.length ? ` (first difference: ${differing[0]})` : ""),
      );
    }
  } else if (manifest?.uploads?.present === true) {
    problems.push("manifest records uploaded documents but the backup has no uploads directory");
  }

  console.log("Restore summary");
  console.log(`  from:     ${backupDir}`);
  console.log(`  to:       ${targetDir}`);
  console.log(
    `  taken:    ${manifest?.createdAt ?? "unknown"}` +
      (manifest?.app?.version ? ` (app ${manifest.app.version})` : ""),
  );
  console.log(`  database: ${database.fileName} (${humanBytes((await fs.stat(restoredDatabase)).size)})`);
  if (manifest?.database?.sha256) {
    console.log(`  checksum: ${problems.some((p) => p.startsWith("database checksum")) ? "MISMATCH" : "verified"}`);
  }
  console.log(`  entities: ${checkedModels.length} model(s) verified${checkedModels.length ? `: ${checkedModels.join(", ")}` : ""}`);
  if (restoredUploadsInfo) {
    console.log(
      `  uploads:  ${restoredUploadsInfo.fileCount} file(s), ${humanBytes(restoredUploadsInfo.totalBytes)}` +
        `, tree ${problems.some((p) => p.startsWith("uploaded ")) ? "MISMATCH" : "verified"}`,
    );
  }
  for (const note of notes) console.log(`  note:     ${note}`);

  if (problems.length) {
    console.error("");
    console.error(`Restore FAILED verification (${problems.length} problem(s)):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    throw fail("The restored copy does not match the backup; do not point the app at it.");
  }

  console.log("");
  console.log("Restore verified: the restored database and documents match the backup.");
  console.log("");
  console.log("To use it, point the app at the restored files and start it:");
  console.log(`  DATABASE_URL="file:${path.join(targetDir, database.fileName).split(path.sep).join("/")}" \\`);
  console.log(`  UPLOAD_ROOT="${path.join(targetDir, "uploads")}" \\`);
  console.log("  npm run start");
}

async function pathExists(target) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

function diffFiles(expected, actual) {
  const actualByPath = new Map(actual.map((f) => [f.path, f]));
  for (const file of expected) {
    const seen = actualByPath.get(file.path);
    if (!seen) return [`${file.path} is missing`];
    if (seen.sha256 !== file.sha256) return [`${file.path} changed`];
    actualByPath.delete(file.path);
  }
  const extra = [...actualByPath.keys()];
  return extra.length ? [`${extra[0]} was not in the backup`] : [];
}

run().catch((error) => {
  console.error(`Error: ${error?.message ?? error}`);
  if (process.env.TRAVELOS_DEBUG && !error?.operatorFacing) console.error(error);
  process.exitCode = 1;
});
