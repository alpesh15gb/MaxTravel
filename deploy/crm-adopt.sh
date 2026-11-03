#!/usr/bin/env bash
# One-time: copy the running CRM's private settings into a root-only env file so the
# CRM can be redeployed on its own. Prints variable NAMES only, never values.
# Run on the VPS as root:  ./deploy/crm-adopt.sh
set -euo pipefail

APP_CONTAINER="${APP_CONTAINER:-max-travel-crm-app-1}"
ENV_FILE="${CRM_ENV_FILE:-/opt/max-travel-crm-secrets/crm.env}"

docker inspect "$APP_CONTAINER" >/dev/null 2>&1 || { echo "Container $APP_CONTAINER is not running." >&2; exit 1; }
[ ! -e "$ENV_FILE" ] || { echo "$ENV_FILE already exists. Move it aside first if you really want to rebuild it." >&2; exit 1; }

image="$(docker inspect -f '{{.Config.Image}}' "$APP_CONTAINER")"
tmp="$(mktemp)"; trap 'rm -f "$tmp" "$tmp.image" "$tmp.run"' EXIT
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$APP_CONTAINER" | sed '/^$/d' | sort > "$tmp.run"
docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$image" | sed '/^$/d' | sort > "$tmp.image"

# Keep only what the operator supplied (not what the image sets), and drop retired
# WhatsApp/Evolution variables.
comm -23 "$tmp.run" "$tmp.image" | grep -vE '^(WA_|EVOLUTION_)' > "$tmp"

for required in JWT_SECRET APP_ORIGIN DATABASE_URL CRM_WORKER_SECRET; do
  grep -q "^${required}=" "$tmp" || { echo "Missing $required in the running container; stop and ask before continuing." >&2; exit 1; }
done

umask 077
install -d -m 700 "$(dirname "$ENV_FILE")"
install -m 600 "$tmp" "$ENV_FILE"
echo "Wrote $ENV_FILE (root-only). Variables kept:"
cut -d= -f1 "$ENV_FILE" | sed 's/^/  /'
