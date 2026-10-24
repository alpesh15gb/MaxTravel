#!/usr/bin/env bash
# USER-RUN VPS ONLY, after app-only verification. No manual provider/API transactions.
set -Eeuo pipefail
umask 077
: "${RELEASE:?Set RELEASE to the exact app-only verified release directory}"
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init crm

case "$RELEASE" in "$BUILD"/crm-release-c27b8e3-*) ;; *) fail 'Unexpected release path.';; esac
[ -d "$RELEASE" ] && [ ! -L "$RELEASE" ] || fail 'Missing/symlinked release.'
[ -f "$POINTER" ] && [ ! -L "$POINTER" ] || fail 'Current pointer missing/symlinked.'
[ "$(cat "$POINTER")" = "$OLD_RELEASE" ] || fail 'Current pointer changed; reconcile first.'
(cd "$RELEASE" && sha256sum --check --status configuration.sha256)
[ "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$CANDIDATE")" = "$TARGET" ] || fail 'Candidate revision mismatch.'
SNAPSHOT_STAGE=$(cat "$RELEASE/snapshot-stage.txt")
case "$SNAPSHOT_STAGE" in "$BUILD"/final-backup-*) ;; *) fail 'Unexpected backup stage.';; esac
sha256sum --check --status "$SNAPSHOT_STAGE/manifest.sha256"
cmp -- "$RELEASE/baseline-audit.private.json" "$RELEASE/live-audit.private.json" || fail 'App database/schema/ledger/build audit did not match.'
[[ $(cat "$RELEASE/app-verified.txt") == verified ]] || fail 'App verification incomplete.'
NEW=("${COMPOSE[@]}" -f "$RELEASE/candidate-image.yaml")
"${NEW[@]}" config --format json > "$RELEASE/worker-config.private.json" 2> "$RELEASE/worker-config-errors.private.log"
python3 - "$RELEASE/new-config.private.json" "$RELEASE/worker-config.private.json" <<'PYCONFIG'
import json,sys
if json.load(open(sys.argv[1]))!=json.load(open(sys.argv[2])):raise SystemExit('STOP: resolved configuration changed since app verification.')
PYCONFIG
mapfile -t APPS < <(docker ps -q --filter label=com.docker.compose.project=max-travel-crm --filter label=com.docker.compose.service=app)
[ "${#APPS[@]}" = 1 ] || fail 'Expected one running CRM app.'
APP=${APPS[0]}
VERIFIED_APP=$(python3 - "$RELEASE/after.private.json" <<'PYAPP'
import json,sys
rows=[r for r in json.load(open(sys.argv[1])) if r['Config']['Labels']['com.docker.compose.service']=='app']
if len(rows)!=1:raise SystemExit('STOP: missing verified app identity.')
print(rows[0]['Id'])
PYAPP
)
[ "$(docker inspect -f '{{.Id}}' "$APP")" = "$VERIFIED_APP" ] || fail 'App identity changed since app-only verification.'

[ "$(docker inspect -f '{{.Image}}:{{.State.Health.Status}}:{{.RestartCount}}' "$APP")" = "$CANDIDATE:healthy:0" ] || fail 'Verified app no longer healthy/stable.'
OLD_WORKER=$(python3 - "$SNAPSHOT_STAGE/crm-before.private.json" <<'PYWORKER'
import json,sys
rows=[r for r in json.load(open(sys.argv[1])) if r['Config']['Labels']['com.docker.compose.service']=='worker']
if len(rows)!=1:raise SystemExit('STOP: missing original worker identity.')
print(rows[0]['Id'])
PYWORKER
)
[ "$(docker inspect -f '{{.Image}}:{{.State.Running}}' "$OLD_WORKER")" = "$OLD_IMAGE:false" ] || fail 'Original worker is not stopped on the known image.'
cp -- "$POINTER" "$RELEASE/prior-current-pointer.txt"
STARTED=0
trap 'status=$?; if [ "$status" != 0 ]; then if [ "$STARTED" = 1 ]; then quiesce_candidate worker; quiesce_candidate app; fi; printf "STOPPED: worker recreation attempted=%s. Do not rerun blindly. Current pointer was not advanced unless final verification already completed. Private evidence: %s\n" "$STARTED" "$RELEASE" >&2; fi' EXIT
mapfile -t BOOKING < <(docker ps -q --filter label=com.docker.compose.project=max-travel-booking)
docker inspect "${BOOKING[@]}" > "$RELEASE/booking-before-worker.private.json"
python3 - "$SNAPSHOT_STAGE/booking-after.private.json" "$RELEASE/booking-before-worker.private.json" <<'PYBOOKING'
import json,sys
before={r['Id']:r for r in json.load(open(sys.argv[1]))};after={r['Id']:r for r in json.load(open(sys.argv[2]))}
if before.keys()!=after.keys():raise SystemExit('STOP: booking/PostgreSQL identities changed.')
for id,r in after.items():
 if r['Image']!=before[id]['Image'] or r['RestartCount']!=before[id]['RestartCount'] or not r['State']['Running'] or r['State'].get('Health',{}).get('Status') not in (None,'healthy'):raise SystemExit('STOP: booking/PostgreSQL runtime changed.')
PYBOOKING
snapshot_all "$RELEASE/all-before-worker.private.json"
protected_check "$RELEASE/all-after.private.json" "$RELEASE/all-before-worker.private.json" ""
STARTED=1
# Resumes the existing configured worker workload; does not submit test messages or provider commands.
"${NEW[@]}" up -d --no-deps --no-build --pull never worker > "$RELEASE/worker-create.private.log" 2>&1
WORKER=$("${NEW[@]}" ps -q worker)
[ -n "$WORKER" ] || fail 'New worker missing.'
EXPECTED_FILES="$EXPECTED_FILES,$RELEASE/candidate-image.yaml"
for attempt in {1..6}; do
 sleep 10
 [ "$(docker inspect -f '{{.Image}}:{{.State.Running}}:{{.RestartCount}}' "$WORKER")" = "$CANDIDATE:true:0" ] || fail 'Worker exited/restarted or image changed.'
 [ "$(docker inspect -f '{{.Image}}:{{.State.Health.Status}}:{{.RestartCount}}' "$APP")" = "$CANDIDATE:healthy:0" ] || fail 'App health/restarts changed.'
done
for cid in "$APP" "$WORKER"; do
 [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$cid")" = "$EXPECTED_FILES" ] || fail 'Operative config pointer differs.'
 [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$cid")" = "$LIVE" ] || fail 'Project working directory differs.'
done
docker inspect "$APP" "$WORKER" > "$RELEASE/final-containers.private.json"
python3 "$HERE/phase_verify.py" runtime-equal "$SNAPSHOT_STAGE/crm-before.private.json" "$RELEASE/final-containers.private.json" crm
python3 - "$RELEASE/worker-config.private.json" "$RELEASE/final-containers.private.json" <<'PYRUNTIME'
import json,sys
config=json.load(open(sys.argv[1]))
for r in json.load(open(sys.argv[2])):
 name=r['Config']['Labels']['com.docker.compose.service'];service=config['services'][name]
 actual=dict(v.split('=',1) for v in r['Config']['Env'] if '=' in v)
 if any(v is None or actual.get(k)!=str(v) for k,v in service.get('environment',{}).items()):raise SystemExit('STOP: configured/runtime environment mismatch.')
 networks={config['networks'][n]['name'] for n in service.get('networks',{})}
 if networks!=set(r['NetworkSettings']['Networks']):raise SystemExit('STOP: runtime network mismatch.')
PYRUNTIME
python3 - "$SNAPSHOT_STAGE/crm-before.private.json" "$RELEASE/final-containers.private.json" <<'PYWORKERCONFIG'
import json,sys
def worker(file):return next(r for r in json.load(open(file)) if r['Config']['Labels']['com.docker.compose.service']=='worker')
old=worker(sys.argv[1]);new=worker(sys.argv[2])
if sorted(old['Config']['Env'])!=sorted(new['Config']['Env']):raise SystemExit('STOP: full worker runtime environment changed.')
if any(old['Config'].get(k)!=new['Config'].get(k) for k in ('Cmd','Entrypoint','User')):raise SystemExit('STOP: worker command/entrypoint/user changed.')
PYWORKERCONFIG
mapfile -t BOOKING < <(docker ps -q --filter label=com.docker.compose.project=max-travel-booking)
docker inspect "${BOOKING[@]}" > "$RELEASE/booking-final.private.json"
python3 - "$SNAPSHOT_STAGE/booking-after.private.json" "$RELEASE/booking-final.private.json" <<'PYBOOKING'
import json,sys
before={r['Id']:r for r in json.load(open(sys.argv[1]))};after={r['Id']:r for r in json.load(open(sys.argv[2]))}
if before.keys()!=after.keys():raise SystemExit('STOP: booking/PostgreSQL identities changed.')
for id,r in after.items():
 if r['Image']!=before[id]['Image'] or r['RestartCount']!=before[id]['RestartCount'] or not r['State']['Running'] or r['State'].get('Health',{}).get('Status') not in (None,'healthy'):raise SystemExit('STOP: booking/PostgreSQL runtime changed.')
PYBOOKING
ORIGIN=$(cat "$RELEASE/public-origin.txt")
[ "$(curl --silent --show-error --max-time 15 --output "$RELEASE/final-local-health.private.json" --write-out '%{http_code}' http://127.0.0.1:3107/api/health)" = 200 ] || fail 'Local health failed.'
[ "$(curl --silent --show-error --max-time 20 --output "$RELEASE/final-public-health.private.json" --write-out '%{http_code}' "$ORIGIN/api/health")" = 200 ] || fail 'Public health failed.'
snapshot_all "$RELEASE/all-final.private.json"
protected_check "$RELEASE/all-before-worker.private.json" "$RELEASE/all-final.private.json" 'crm:worker'
# Advance the EXISTING pointer atomically only after both services and protected booking checks pass.
[ -f "$POINTER" ] && [ ! -L "$POINTER" ] && [ "$(cat "$POINTER")" = "$OLD_RELEASE" ] || fail 'Current pointer changed during verification.'
TMP_POINTER=$(mktemp "${POINTER}.tmp.XXXXXX")
chmod 600 "$TMP_POINTER"
printf '%s\n' "$RELEASE" > "$TMP_POINTER"
mv -T -- "$TMP_POINTER" "$POINTER"
[ "$(cat "$POINTER")" = "$RELEASE" ] || fail 'Pointer verification failed.'
printf '%s\n' "$TARGET" > "$RELEASE/deployed-source.txt"
printf '%s\n' "$CANDIDATE" > "$RELEASE/deployed-image.txt"
printf '\nCRM CUTOVER VERIFIED\nRelease: %s\nSource: %s\nApp and worker image: %s\n' "$RELEASE" "$TARGET" "$CANDIDATE"
printf 'App healthy, worker running without restart for60s; booking/PostgreSQL identities unchanged. Existing release pointer advanced.\nNo manual provider transaction was tested. Retain backup and private rollback/config evidence.\n'
