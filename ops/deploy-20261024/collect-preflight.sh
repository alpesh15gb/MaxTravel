#!/usr/bin/env bash
# USER-RUN on intended VPS only; no Docker mutations, application calls, or DB access.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 ]] || { echo 'STOP: Run as root on the intended VPS.' >&2; exit 1; }
[[ -z ${DOCKER_HOST:-} && -z ${DOCKER_CONTEXT:-} ]] || { echo 'STOP: Docker endpoint override present.' >&2; exit 1; }
[[ $(docker context show) == default && $(docker context inspect default --format '{{.Endpoints.docker.Host}}') == unix:///var/run/docker.sock ]] || { echo 'STOP: Expected default local Docker socket.' >&2; exit 1; }
OUT=$(mktemp -d /root/maxtravel-preflight-20261024-XXXXXX)
trap 'printf "Private preflight directory: %s\nDo not paste raw files: inspect/config output can contain secrets.\n" "$OUT"' EXIT
cat /etc/machine-id > "$OUT/machine-id.private.txt"
date -u +%FT%TZ > "$OUT/captured-at.txt"
docker version > "$OUT/docker-version.txt"
docker compose version > "$OUT/compose-version.txt"
docker info > "$OUT/docker-info.private.txt"
docker buildx version > "$OUT/buildx-version.txt"
# No --bootstrap: inspection must not start an inactive builder.
docker buildx ls > "$OUT/builders.private.txt" 2> "$OUT/builders-errors.private.log"
docker ps -aq --no-trunc > "$OUT/container-ids.txt"
mapfile -t IDS < "$OUT/container-ids.txt"
((${#IDS[@]})) && docker inspect "${IDS[@]}" > "$OUT/containers.private.json"
free -k > "$OUT/memory.txt"
df -Pk /root "$(docker info --format '{{.DockerRootDir}}')" > "$OUT/disk.txt"
for app in crm booking; do
 pointer="/root/maxtravel-revamp-backup-9B5326/$app-current-cutover-path.txt"
 [[ -f $pointer && ! -L $pointer ]] || { echo 'STOP: Release pointer missing or symlinked.' >&2; exit 1; }
 cp -- "$pointer" "$OUT/$app-current-cutover-path.txt"
done
printf 'READ-ONLY COLLECTION COMPLETE. Fresh state still needs private review before any build.\n'
