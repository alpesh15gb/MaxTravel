#!/usr/bin/env bash
# CI ONLY. Execute the actual phase startup command against empty synthetic data.
set -Eeuo pipefail
umask 077
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ ${GITHUB_ACTIONS:-} == true && ${POSTGRES_STARTUP_SMOKE:-} == owned-synthetic-only ]] || { echo 'STOP: dedicated CI smoke only.' >&2; exit 1; }
[[ -z ${DOCKER_HOST:-}${DOCKER_CONTEXT:-}${DOCKER_CONFIG:-} ]] || exit 1
[[ $(docker context show) == default && $(docker context inspect default --format '{{.Endpoints.docker.Host}}') == unix:///var/run/docker.sock ]] || exit 1
STAGE=$(mktemp -d "${RUNNER_TEMP:?}/postgres-startup-smoke.XXXXXXXX")
VERIFY="booking-restore-$(basename "$STAGE" | tr '[:upper:]' '[:lower:]')"
IMAGE=docker.io/library/postgres@sha256:d4bb0a8c1b7bb2e29f976d099e7bfb9a5d8858cffe9e46b35cd302cd1f1f8168
ID='';PG_IMAGE=''
cleanup() {
 local status=$?
 trap - EXIT
 if [[ -n $ID ]]; then
  if [[ $(docker inspect -f '{{.Id}}:{{.Name}}:{{.Image}}:{{index .Config.Labels "maxtravel.cutover.helper"}}:{{.HostConfig.NetworkMode}}' "$ID") != "$ID:/$VERIFY:$PG_IMAGE:true:none" ]]; then
   echo 'STOP: CI cleanup identity mismatch; no removal.' >&2;exit 1
  fi
  timeout 40s docker stop --timeout 30 "$ID" > "$STAGE/stop.private.log" 2>&1 || status=1
  if [[ $(docker inspect -f '{{.State.Running}}' "$ID") == false ]]; then
   timeout 20s docker rm "$ID" > "$STAGE/remove.private.log" 2>&1 || status=1
  else
   echo 'STOP: CI container still running; no forced removal.' >&2;status=1
  fi
 fi
 exit "$status"
}
trap cleanup EXIT
# Exact user-reported official VPS RepoDigest. Pull failure must NOT fall back to a tag.
if ! timeout 180s docker pull "$IMAGE" > "$STAGE/pull.private.log" 2>&1; then
 echo "STOP: supplied official PostgreSQL registry digest could not be pulled; no tag fallback." >&2
 tail -20 "$STAGE/pull.private.log" >&2;exit 1
fi
PG_IMAGE=$(docker image inspect -f '{{.Id}}' "$IMAGE")
[[ $PG_IMAGE =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1
docker image inspect "$PG_IMAGE" > "$STAGE/registry-image.private.json"
python3 - "$STAGE/registry-image.private.json" "$PG_IMAGE" <<'PYREGISTRY'
import json,sys
image=json.load(open(sys.argv[1]));assert len(image)==1;image=image[0]
digest='sha256:d4bb0a8c1b7bb2e29f976d099e7bfb9a5d8858cffe9e46b35cd302cd1f1f8168'
assert image['Id']==sys.argv[2] and image['Os']=='linux' and image['Architecture']=='amd64'
assert set(image.get('RepoDigests',[])) & {'postgres@'+digest,'docker.io/library/postgres@'+digest}
print('Exact official registry digest verified on linux/amd64; runtime config image ID is distinct:',image['Id'])
PYREGISTRY
[[ $(docker run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --entrypoint postgres "$PG_IMAGE" --version) == 'postgres (PostgreSQL) 17.11' ]] || { echo 'STOP: exact-digest image PostgreSQL version differs.' >&2;exit 1; }
# Same official image's account; disposable identity lookup has no mounts/network.
PG_UID=$(docker run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --entrypoint id "$PG_IMAGE" -u postgres)
PG_GID=$(docker run --rm --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --entrypoint id "$PG_IMAGE" -g postgres)
[[ $PG_UID =~ ^[1-9][0-9]*$ && $PG_GID =~ ^[1-9][0-9]*$ ]]
mkdir -m 700 "$STAGE/isolated-data"
sudo chown "$PG_UID:$PG_GID" "$STAGE/isolated-data"
# Read the reviewed actual command; no stale duplicated startup configuration.
COMMAND=$(python3 - "$HERE/cutover/freeze-backup-verify-booking.sh" <<'PY'
import pathlib,sys
s=pathlib.Path(sys.argv[1]).read_text();a=s.index('docker run -d --label maxtravel.cutover.helper=true');b=s.index(' > "$STAGE/isolated-container-id.txt"',a)+len(' > "$STAGE/isolated-container-id.txt"')
command=s[a:b]
assert '-c unix_socket_directories=/tmp,/var/run/postgresql' in command
assert '--network none --read-only' in command
print(command)
PY
)
eval "$COMMAND"
ID=$(cat "$STAGE/isolated-container-id.txt")
[[ $ID =~ ^[0-9a-f]{64}$ ]]
ready=0
for attempt in {1..90}; do
 [[ $(docker inspect -f '{{.State.Running}}' "$ID") == true ]] || break
 # PID 1 becomes postgres only AFTER the official temporary init server exits.
 if [[ $(docker exec "$ID" cat /proc/1/comm) == postgres ]] && docker exec "$ID" psql -h /tmp -X -U maxtravel -d maxtravel -Atc 'SELECT 1' > /dev/null 2>&1; then ready=1;break;fi
 sleep 2
done
docker logs "$ID" > "$STAGE/startup.private.log" 2>&1
[[ $ready == 1 ]] || { echo 'FAIL: official PostgreSQL final startup did not complete.' >&2;tail -60 "$STAGE/startup.private.log";exit 1; }
for socket in /tmp /var/run/postgresql; do
 [[ $(docker exec "$ID" psql -h "$socket" -X -U maxtravel -d maxtravel -Atc 'SELECT 1') == 1 ]]
 [[ $(docker exec "$ID" psql -h "$socket" -X -U maxtravel -d maxtravel -Atc 'SHOW listen_addresses') == '' ]]
done
[[ $(docker exec "$ID" psql -h /tmp -X -U maxtravel -d maxtravel -Atc 'SHOW unix_socket_directories') == /tmp,/var/run/postgresql ]]
sleep 3
[[ $(docker inspect -f '{{.Image}}:{{.State.Running}}:{{.RestartCount}}:{{.HostConfig.NetworkMode}}:{{.HostConfig.ReadonlyRootfs}}:{{.Config.User}}' "$ID") == "$PG_IMAGE:true:0:none:true:$PG_UID:$PG_GID" ]]
# Validate actual Docker inspect representation against the incident guard, using
# synthetic evidence only. This is NOT reproduction of the old initialization failure.
timeout 40s docker stop --timeout 30 "$ID" > "$STAGE/shape-stop.private.log"
docker inspect "$ID" > "$STAGE/shape-container.private.json"
docker image inspect "$PG_IMAGE" > "$STAGE/shape-image.private.json"
PYTHONDONTWRITEBYTECODE=1 python3 - "$HERE" "$STAGE" <<'PYSHAPE'
import json,pathlib,sys
from unittest.mock import patch
here=pathlib.Path(sys.argv[1]);stage=pathlib.Path(sys.argv[2]);sys.path.insert(0,str(here));sys.path.insert(0,str(here/'cutover'))
import phase_verify as phase
import test_candidate
row=json.loads((stage/'shape-container.private.json').read_text())[0]
# Only name and old single-socket Cmd are fixture substitutions. Actual Docker
# State, HostConfig, Mounts, User, Env, Entrypoint, image and identity are retained.
row['Name']='/booking-restore-final-backup-sqr9dj'
row['Config']['Cmd']=['-c','listen_addresses=','-c','unix_socket_directories=/tmp']
ordinary=test_candidate.CandidateChecks().complete_rows()
(stage/'all-before.private.json').write_text(json.dumps(ordinary))
original_regular=phase.regular
expected_image_path=stage.parent/'deployed-images.private.json'
def regular(path):
 return original_regular(stage/'shape-image.private.json' if pathlib.Path(path)==expected_image_path else path)
# Registry manifest digest is not the Docker config image ID. This fixture-only
# override validates CI representation and does not change the production pin.
with patch.object(phase,'FAILED_BOOKING_STAGE',str(stage)),patch.object(phase,'FAILED_POSTGRES_IMAGE',row['Image']),patch.object(phase,'regular',regular):
 phase.failed_booking_helper(stage,ordinary+[row])
print('Actual stopped Docker inspect shape accepted by retained-helper guard; synthetic incident fixture, not old-failure reproduction.')
PYSHAPE
printf 'Official PostgreSQL 17.11 Alpine final startup verified on BOTH Unix sockets; TCP disabled. Actual production startup command exercised. Exact supplied registry digest, linux/amd64 PostgreSQL 17.11; local config ID is not claimed identical to VPS. No tag fallback.\n'
