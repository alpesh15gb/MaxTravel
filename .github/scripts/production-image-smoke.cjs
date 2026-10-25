// Run through stdin inside the final production image, never on the host.
// Read/resolve/import only: do not import CLI scripts, workers, app routes or
// instantiate PrismaClient (those can connect, migrate, mutate or start loops).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

assert.equal(process.getuid(), 1000, 'The image must default to unprivileged UID 1000');
assert.equal(process.cwd(), '/app');
assert.equal(process.env.NODE_ENV, 'production');
for (const key of ['DATABASE_URL', 'JWT_SECRET', 'WA_WORKER_SECRET', 'CRM_DATA_ENCRYPTION_KEY']) {
  assert.equal(process.env[key], undefined, `${key} must not be baked into the image`);
}

const requiredFiles = [
  'package.json', 'next.config.mjs', 'prisma/schema.prisma',
  'prisma/migrations/migration_lock.toml',
  '.next/BUILD_ID', '.next/required-server-files.json',
  '.next/routes-manifest.json', '.next/server/app-paths-manifest.json',
  'scripts/backup.mjs', 'scripts/restore.mjs',
  'scripts/reconcile-reporting.mjs', 'scripts/encrypt-sensitive.mjs',
  'scripts/staff-recovery.mjs', 'scripts/whatsapp-worker.mjs',
  'scripts/configure-evolution.mjs', '/usr/local/bin/docker-entrypoint.sh',
];
for (const file of requiredFiles) {
  assert.ok(fs.statSync(file).isFile(), `Missing runtime file: ${file}`);
  assert.ok(fs.readFileSync(file).length > 0, `Empty runtime file: ${file}`);
}
fs.accessSync('/usr/local/bin/docker-entrypoint.sh', fs.constants.R_OK | fs.constants.X_OK);
for (const dir of ['public', '.next/static', '.next/server']) {
  fs.accessSync(dir, fs.constants.R_OK | fs.constants.X_OK);
  assert.ok(fs.readdirSync(dir).length > 0, `Empty runtime directory: ${dir}`);
}
const migrationDirs = fs.readdirSync('prisma/migrations', { withFileTypes: true })
  .filter((entry) => entry.isDirectory());
assert.ok(migrationDirs.length > 0, 'Committed migrations must be included');
for (const dir of migrationDirs) {
  assert.ok(fs.readFileSync(path.join('prisma/migrations', dir.name, 'migration.sql')).length > 0);
}
const manifest = JSON.parse(fs.readFileSync('.next/required-server-files.json', 'utf8'));
assert.ok(manifest.files.length > 0, 'Next runtime manifest must list its required files');
for (const file of manifest.files) fs.accessSync(file, fs.constants.R_OK);

// Resolve from /app rather than from the host harness. Safe library imports
// exercise runtime-only dependency pruning and native module availability.
const runtimeRequire = createRequire('/app/package.json');
for (const dependency of ['next', 'next/dist/bin/next', 'prisma', '@prisma/client', 'react', 'react-dom', 'exceljs', 'pdfkit', 'sharp']) {
  fs.accessSync(runtimeRequire.resolve(dependency), fs.constants.R_OK);
}
assert.equal(typeof runtimeRequire('@prisma/client').PrismaClient, 'function');
assert.equal(typeof runtimeRequire('exceljs').Workbook, 'function');
assert.equal(typeof runtimeRequire('pdfkit'), 'function');
assert.ok(runtimeRequire('sharp').versions.vips, 'Sharp native runtime must load');
assert.equal(typeof runtimeRequire('react').createElement, 'function');
console.log('Production image smoke passed: UID 1000, runtime artifacts, migrations and safe dependency imports.');
