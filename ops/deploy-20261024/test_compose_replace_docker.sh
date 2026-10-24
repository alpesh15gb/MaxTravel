#!/usr/bin/env bash
# CI ONLY: exercise real Compose recreation metadata without starting any container.
set -Eeuo pipefail
umask 077
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ ${GITHUB_ACTIONS:-} == true && ${COMPOSE_REPLACE_SMOKE:-} == owned-synthetic-only ]] || { echo 'STOP: dedicated GitHub CI smoke only.' >&2; exit 1; }
[[ -z ${DOCKER_HOST:-} && -z ${DOCKER_CONTEXT:-} && -z ${DOCKER_CONFIG:-} ]] || { echo 'STOP: Docker endpoint overrides are not allowed.' >&2; exit 1; }
[[ $(docker context show) == default && $(docker context inspect default --format '{{.Endpoints.docker.Host}}') == unix:///var/run/docker.sock ]] || { echo 'STOP: local default Docker daemon required.' >&2; exit 1; }
WORK=$(mktemp -d "${RUNNER_TEMP:?}/compose-replace-smoke.XXXXXXXX")
TOKEN=$(basename "$WORK" | tr '[:upper:]' '[:lower:]')
PROJECT=${TOKEN//./-}
IMAGE=docker.io/library/alpine:3.22
IDS=()
cleanup() {
 local status=$? id owner project service running failed=0
 trap - EXIT
 # Only exact IDs captured after our own successful create operations. A replaced old
 # ID may already be absent; no broad rm/prune, compose down, force or volume deletion.
 for id in "${IDS[@]}"; do
  if ! timeout 10s docker inspect "$id" > "$WORK/cleanup-$id.private.json" 2> "$WORK/cleanup-$id.private.log"; then
   # Distinguish an expected removed original from daemon/inventory failures.
   remaining=$(timeout 10s docker ps -aq --no-trunc) || { failed=1; continue; }
   if grep -Fxq "$id" <<< "$remaining"; then failed=1; fi
   continue
  fi
  if ! python3 -I - "$WORK/cleanup-$id.private.json" "$TOKEN" "$PROJECT" <<'PY'
import json,sys
rows=json.load(open(sys.argv[1]));assert len(rows)==1
r=rows[0];l=r['Config']['Labels'];assert l.get('maxtravel.compose-smoke.owner')==sys.argv[2]
assert l.get('com.docker.compose.project')==sys.argv[3] and l.get('com.docker.compose.service')=='app'
assert r['State']['Running'] is False
PY
  then printf 'STOP: cleanup ownership/state differs; no forced removal.\n' >&2; failed=1; continue; fi
  timeout 15s docker rm "$id" > "$WORK/remove-$id.private.log" 2>&1 || failed=1
 done
 if ((failed)); then printf 'STOP: owned smoke cleanup incomplete; private evidence retained on ephemeral runner.\n' >&2; status=1; fi
 exit "$status"
}
trap cleanup EXIT
cat > "$WORK/compose.yaml" <<YAML
services:
  app:
    image: $IMAGE
    command: ["/bin/true"]
    network_mode: none
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    labels:
      maxtravel.compose-smoke.owner: $TOKEN
YAML
COMPOSE=(docker compose --project-name "$PROJECT" --project-directory "$WORK" -f "$WORK/compose.yaml")
timeout 150s docker pull "$IMAGE" > "$WORK/pull.private.log" 2>&1
docker compose version --short > "$WORK/compose-version.txt"
# 'create' and 'create --force-recreate' do not start the synthetic service.
timeout 60s "${COMPOSE[@]}" create --no-build --pull never app > "$WORK/create.private.log" 2>&1
mapfile -t FOUND < <(docker ps -aq --no-trunc --filter "label=maxtravel.compose-smoke.owner=$TOKEN" --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.service=app)
[[ ${#FOUND[@]} == 1 && ${FOUND[0]} =~ ^[0-9a-f]{64}$ ]] || { echo 'STOP: expected one owned created fixture.' >&2; exit 1; }
OLD=${FOUND[0]}; IDS+=("$OLD")
docker inspect "$OLD" > "$WORK/before.private.json"
timeout 60s "${COMPOSE[@]}" create --force-recreate --no-build --pull never app > "$WORK/recreate.private.log" 2>&1
mapfile -t FOUND < <(docker ps -aq --no-trunc --filter "label=maxtravel.compose-smoke.owner=$TOKEN" --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.service=app)
[[ ${#FOUND[@]} == 1 && ${FOUND[0]} =~ ^[0-9a-f]{64}$ ]] || { echo 'STOP: expected one owned recreated fixture.' >&2; exit 1; }
NEW=${FOUND[0]}; IDS+=("$NEW")
[[ $NEW != "$OLD" ]] || { echo 'STOP: synthetic fixture not recreated.' >&2; exit 1; }
docker inspect "$NEW" > "$WORK/after.private.json"
python3 -I - "$WORK" "$TOKEN" "$PROJECT" <<'PY'
import json,pathlib,sys
p=pathlib.Path(sys.argv[1]);a=json.loads((p/'before.private.json').read_text())[0];b=json.loads((p/'after.private.json').read_text())[0]
for r in (a,b):
 l=r['Config']['Labels'];assert l['maxtravel.compose-smoke.owner']==sys.argv[2]
 assert l['com.docker.compose.project']==sys.argv[3] and l['com.docker.compose.service']=='app'
 assert r['State']['Status']=='created' and r['State']['Running'] is False
 assert r['HostConfig']['NetworkMode']=='none' and not r['Mounts'] and not r['HostConfig'].get('PortBindings')
assert a['Id']!=b['Id'] and a['Name']==b['Name']
number=a['Config']['Labels']['com.docker.compose.container-number'];assert number=='1'
replace=b['Config']['Labels'].get('com.docker.compose.replace')
# Verified official implementations: v2.24.7 uses full old ID; v2.39.4 uses service-number.
assert replace in (a['Id'],'app-'+number), 'Unrecognized replacement label semantics'
kind='full-old-id' if replace==a['Id'] else 'service-number'
print('Real Compose replacement smoke passed: '+kind+'; two isolated fixtures created, none started.')
PY
# Also exercise the production full-runtime validator with the observed Docker metadata.
# The synthetic project is not CRM; no migration/env exception applies.
python3 -I "$SCRIPT_DIR/cutover/phase_verify.py" runtime-equal "$WORK/before.private.json" "$WORK/after.private.json" booking
# Raw inspect remains private; only the semantic category is printed. No artifact uploads.
