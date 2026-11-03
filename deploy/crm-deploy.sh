#!/usr/bin/env bash
# Build and roll out the CRM on its own: backup, build, swap app + worker, verify, roll back
# on failure. The booking site is never touched.
# Run on the VPS as root, from the CRM checkout:  ./deploy/crm-deploy.sh
# Roll back to a tag:                              ./deploy/crm-deploy.sh --rollback max-travel-crm:<tag>
set -euo pipefail

CRM_DIR="${CRM_DIR:-/opt/max-travel-crm}"
export CRM_ENV_FILE="${CRM_ENV_FILE:-/opt/max-travel-crm-secrets/crm.env}"
export CRM_BACKUP_DIR="${CRM_BACKUP_DIR:-/opt/max-travel-crm-backups/crm}"
APP_CONTAINER="${APP_CONTAINER:-max-travel-crm-app-1}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3107/api/health}"
compose() { docker compose -f "$CRM_DIR/compose.crm.yaml" --env-file "$CRM_ENV_FILE" "$@"; }

cd "$CRM_DIR"
[ -r "$CRM_ENV_FILE" ] || { echo "Missing $CRM_ENV_FILE. Run deploy/crm-adopt.sh once first." >&2; exit 1; }

wait_healthy() {
  for _ in $(seq 1 40); do
    status="$(docker inspect -f '{{.State.Health.Status}}' "$APP_CONTAINER" 2>/dev/null || echo none)"
    if [ "$status" = healthy ] && curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then return 0; fi
    sleep 3
  done
  return 1
}

previous="$(docker inspect -f '{{.Config.Image}}' "$APP_CONTAINER" 2>/dev/null || true)"

if [ "${1:-}" = "--rollback" ]; then
  target="${2:?usage: crm-deploy.sh --rollback <image tag>}"
  docker image inspect "$target" >/dev/null
  CRM_IMAGE="$target" compose up -d app worker
  wait_healthy && echo "Rolled back to $target" || { echo "Health check failed after rollback." >&2; exit 1; }
  exit 0
fi

echo "== Current image: ${previous:-none}"
git fetch origin main
git merge --ff-only origin/main
tag="max-travel-crm:release-$(git rev-parse --short=12 HEAD)-$(date -u +%Y%m%d%H%M)"

echo "== Building $tag"
docker build -t "$tag" .

echo "== Backing up (using the known-good running image)"
install -d -o 1000 -g 1000 -m 700 "$CRM_BACKUP_DIR"
CRM_IMAGE="${previous:-$tag}" compose --profile maintenance run --interactive=false --rm backup

echo "== Starting $tag"
CRM_IMAGE="$tag" compose up -d app worker
if wait_healthy; then
  echo "== CRM is healthy on $tag"
  echo "   Previous image kept for rollback: ${previous:-none}"
  echo "   Rollback command: ./deploy/crm-deploy.sh --rollback ${previous:-<tag>}"
  echo "   Note: a rollback does not undo database migrations; restore the backup in $CRM_BACKUP_DIR if a migration ran."
else
  echo "!! $tag did not become healthy. Rolling back." >&2
  docker logs --tail=60 "$APP_CONTAINER" >&2 || true
  if [ -n "$previous" ]; then CRM_IMAGE="$previous" compose up -d app worker; wait_healthy && echo "Rolled back to $previous" >&2; fi
  exit 1
fi
