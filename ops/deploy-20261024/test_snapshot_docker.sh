#!/usr/bin/env bash
# CI ONLY. Real Docker CLI compatibility smoke; creates but NEVER starts containers.
set -Eeuo pipefail
umask 077
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ ${GITHUB_ACTIONS:-} == true && ${SNAPSHOT_DOCKER_SMOKE:-} == owned-synthetic-only ]] || { echo 'STOP: dedicated GitHub CI smoke only.' >&2; exit 1; }
[[ -z ${DOCKER_HOST:-} && -z ${DOCKER_CONTEXT:-} && -z ${DOCKER_CONFIG:-} ]] || { echo 'STOP: Docker endpoint overrides are not allowed.' >&2; exit 1; }
[[ $(docker context show) == default && $(docker context inspect default --format '{{.Endpoints.docker.Host}}') == unix:///var/run/docker.sock ]] || { echo 'STOP: local default Docker daemon required.' >&2; exit 1; }
# Source definitions only. NEVER call init or any backup/cutover phase.
source "$SCRIPT_DIR/cutover/common.sh"
WORK=$(mktemp -d "${RUNNER_TEMP:?}/snapshot-cli-smoke.XXXXXXXX")
TOKEN=$(basename "$WORK")
IMAGE=docker.io/library/alpine:3.22
IDS=()
cleanup() {
 local status=$? id owner running failed=0
 trap - EXIT
 for id in "${IDS[@]}"; do
  owner=$(timeout 10s docker inspect --format '{{index .Config.Labels "maxtravel.snapshot-smoke.owner"}}' "$id") || { failed=1; continue; }
  running=$(timeout 10s docker inspect --format '{{.State.Running}}' "$id") || { failed=1; continue; }
  if [[ $owner != "$TOKEN" || $running != false ]]; then
   printf 'STOP: smoke cleanup ownership/state differs; no forced removal.\n' >&2; failed=1; continue
  fi
  timeout 15s docker rm "$id" > "$WORK/cleanup-$id.private.log" 2>&1 || failed=1
 done
 if ((failed)); then printf 'STOP: owned smoke cleanup incomplete; ephemeral runner evidence remains private.\n' >&2; status=1; fi
 exit "$status"
}
trap cleanup EXIT
# Trusted official image; downloaded only. No image entrypoint/command ever executes.
timeout 150s docker pull "$IMAGE" > "$WORK/pull.private.log" 2>&1
for kind in normal helper false; do
 args=(--name "$TOKEN-$kind" --label "maxtravel.snapshot-smoke.owner=$TOKEN" --network none --read-only --cap-drop ALL --security-opt no-new-privileges)
 case "$kind" in helper) args+=(--label maxtravel.cutover.helper=true);; false) args+=(--label maxtravel.cutover.helper=false);; esac
 id=$(timeout 30s docker create "${args[@]}" "$IMAGE" /bin/true 2> "$WORK/create-$kind.private.log")
 [[ $id =~ ^[0-9a-f]{64}$ ]] || { echo 'STOP: invalid created-container identity.' >&2; exit 1; }
 IDS+=("$id")
 printf '%s\n' "$id" > "$WORK/$kind.id"
done
snapshot_all "$WORK/filtered.private.json"
python3 - "$WORK" "$TOKEN" <<'PY'
import json,pathlib,sys
p=pathlib.Path(sys.argv[1]);token=sys.argv[2]
raw=json.loads((p/'filtered.private.json.all.private.json').read_text())
filtered=json.loads((p/'filtered.private.json').read_text())
raw_by={r['Id']:r for r in raw};filtered_by={r['Id']:r for r in filtered}
expected={r['Id']:r for r in raw if ((r.get('Config') or {}).get('Labels') or {}).get('maxtravel.cutover.helper')!='true'}
assert len(raw_by)==len(raw) and len(filtered_by)==len(filtered)
assert filtered_by==expected, 'Full snapshot filtering semantics differ'
for kind in ('normal','helper','false'):
 id=(p/(kind+'.id')).read_text().strip();r=raw_by[id]
 assert r['Config']['Labels']['maxtravel.snapshot-smoke.owner']==token
 assert r['State']['Running'] is False and r['State']['Status']=='created'
 assert r['HostConfig']['NetworkMode']=='none' and not r['Mounts'] and not r['HostConfig'].get('PortBindings')
 assert (id in filtered_by)==(kind!='helper'), 'Synthetic label case failed'
print('Docker CLI snapshot smoke passed: normal/false retained, true helper excluded; no containers started.')
PY
# No raw inspect output is printed or uploaded. Cleanup handles only captured owned IDs.
