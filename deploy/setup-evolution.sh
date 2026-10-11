#!/usr/bin/env bash
# Run on the existing VPS from the repository root after backing up and pulling.
set -euo pipefail
cd "$(dirname "$0")/.."
test -f .env || { echo "STOP: existing CRM .env not found."; exit 1; }
docker inspect evolution_api >/dev/null
if docker network inspect max-travel-messaging >/dev/null 2>&1; then
  if [ "$(docker network inspect max-travel-messaging --format '{{index .Labels "app"}}')" != "max-travel-crm" ]; then
    echo 'STOP: network name max-travel-messaging is already used without the CRM ownership label.'
    exit 1
  fi
fi
if grep -q '^EVOLUTION_API_KEY=' .env; then
  echo "STOP: Evolution settings already exist. Use the documented update commands instead."
  exit 1
fi
echo 'Paste the API key from the max travel instance card (input is hidden).'
IFS= read -r -s -p 'Instance API key: ' instance_key </dev/tty
printf '\n'
if [[ ! "$instance_key" =~ ^[a-zA-Z0-9._-]{16,512}$ ]]; then
  echo 'STOP: unexpected key format. No settings or network changes were made.'
  exit 1
fi
umask 077
cp -p .env ".env.pre-evolution.$(date +%Y%m%d%H%M%S).local"
printf '\nEVOLUTION_API_KEY=%s\nEVOLUTION_INSTANCE="max travel"\nWA_WEBHOOK_SECRET=%s\nWA_WORKER_SECRET=%s\nCOMPOSE_FILE=compose.vps.yaml:compose.evolution.yaml\n' \
  "$instance_key" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" >> .env
unset instance_key

# Create only the dedicated CRM messaging network; never recreate Evolution's network.
if ! docker network inspect max-travel-messaging >/dev/null 2>&1; then
  docker network create --label app=max-travel-crm max-travel-messaging >/dev/null
fi
if ! docker inspect evolution_api --format '{{json .NetworkSettings.Networks}}' | grep -q '"max-travel-messaging"'; then
  docker network connect --alias evolution-crm-gateway max-travel-messaging evolution_api
fi
docker compose config --quiet
COMPOSE_PARALLEL_LIMIT=1 docker compose build app
docker compose up -d --wait --wait-timeout 180 app worker
# Guarded script refuses to overwrite an enabled webhook pointing to another application.
docker compose exec -T app node scripts/configure-evolution.mjs
docker compose ps
echo 'CRM connected. Automatic rules remain disabled until an administrator enables them in WhatsApp desk.'
