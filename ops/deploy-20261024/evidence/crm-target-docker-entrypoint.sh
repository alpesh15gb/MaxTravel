#!/bin/sh
# Container entrypoint: fail fast on missing config, make sure the volume is usable,
# apply committed migrations, then hand off to the server with exec so the container
# receives signals (SIGTERM on `docker stop`) directly.
set -eu

log() { echo "[entrypoint] $*"; }
fail() { echo "[entrypoint] FATAL: $*" >&2; exit 1; }

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set. Point it at the mounted volume, e.g. file:/data/app.db"
[ -n "${JWT_SECRET:-}" ] || fail "JWT_SECRET is not set. It must be at least 32 bytes; generate it with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
[ "${#JWT_SECRET}" -ge 32 ] || fail "JWT_SECRET must contain at least 32 characters (got ${#JWT_SECRET})."

# SQLite lives on a mounted volume. Writing there is the failure this catches: a volume
# owned by root while the container runs as uid 1000 would otherwise crash mid-request.
case "$DATABASE_URL" in
  file:*)
    DB_PATH="${DATABASE_URL#file:}"
    DB_PATH="${DB_PATH%%\?*}"
    DB_DIR="$(dirname "$DB_PATH")"
    mkdir -p "$DB_DIR" || fail "cannot create database directory $DB_DIR"
    [ -w "$DB_DIR" ] || fail "$DB_DIR is not writable by uid $(id -u). Mount the volume with ownership for uid 1000 (chown -R 1000:1000)."
    touch "$DB_DIR/.write-test" 2>/dev/null && rm -f "$DB_DIR/.write-test" \
      || fail "$DB_DIR is not writable by uid $(id -u)"
    log "database: $DB_PATH"
    ;;
  *)
    log "database: external provider"
    ;;
esac

UPLOAD_DIR="${UPLOAD_ROOT:-/data/uploads}"
mkdir -p "$UPLOAD_DIR" || fail "cannot create upload directory $UPLOAD_DIR"
[ -w "$UPLOAD_DIR" ] || fail "$UPLOAD_DIR is not writable by uid $(id -u)"
log "private uploads: $UPLOAD_DIR"

# `migrate deploy` only applies committed migrations and never resets data.
# RUN_MIGRATIONS=false is for the case where migrations are applied by a separate job.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  log "applying database migrations"
  ./node_modules/.bin/prisma migrate deploy || fail "database migration failed — refusing to start with an unknown schema"
else
  log "RUN_MIGRATIONS=false: skipping migrations"
fi

log "starting server on ${BIND_HOST:-0.0.0.0}:${PORT:-3000}"
exec node node_modules/next/dist/bin/next start -H "${BIND_HOST:-0.0.0.0}" -p "${PORT:-3000}"
