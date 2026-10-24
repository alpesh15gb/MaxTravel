#!/usr/bin/env bash
# USER-RUN VPS ONLY. Requires successful final offline backup. App only; worker stays stopped.
set -Eeuo pipefail
umask 077
: "${SNAPSHOT_STAGE:?Set SNAPSHOT_STAGE to the exact successful final-backup directory; never infer latest}"
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init crm
[ "$(id -u)" = 0 ] || fail 'Run as root on the intended VPS.'
for tool in docker python3 curl sha256sum timeout; do command -v "$tool" >/dev/null || fail "Missing $tool"; done
case "$SNAPSHOT_STAGE" in "$BUILD"/final-backup-*) ;; *) fail 'Unexpected snapshot stage path.';; esac
[ -d "$SNAPSHOT_STAGE" ] && [ ! -L "$SNAPSHOT_STAGE" ] || fail 'Missing/symlinked snapshot stage.'
[[ ! -e $SNAPSHOT_STAGE/resumed-old.txt && ! -e $SNAPSHOT_STAGE/cutover-attempted.txt ]] || fail 'Snapshot invalidated or cutover already attempted.'
[[ $(cat "$SNAPSHOT_STAGE/restore-verified.txt") == verified ]] || fail 'Restore not verified.'
sha256sum --check --status "$SNAPSHOT_STAGE/audit.sha256"
sha256sum --check --status "$SNAPSHOT_STAGE/payload.sha256"
sha256sum --check --status "$SNAPSHOT_STAGE/manifest.sha256"
SNAPSHOT=$(cat "$SNAPSHOT_STAGE/verified-snapshot.txt")
case "$SNAPSHOT" in "$SNAPSHOT_STAGE"/backup/backup-*) ;; *) fail 'Unexpected verified snapshot path.';; esac
[ -d "$SNAPSHOT" ] && [ ! -L "$SNAPSHOT" ] || fail 'Snapshot missing/symlinked.'
[ "$(cat "$BUILD/source-commit.txt")" = "$TARGET" ] || fail 'Build source mismatch.'
[ "$(cat "$BUILD/candidate-image-id.txt")" = "$CANDIDATE" ] || fail 'Candidate mismatch.'
[ "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$CANDIDATE")" = "$TARGET" ] || fail 'Candidate revision mismatch.'
sha256sum --check --status "$BUILD/frozen-originals.sha256"
sha256sum --check --status "$BUILD/rollback-image.sha256"
mapfile -t HELPERS < "$SNAPSHOT_STAGE/helper-names.txt"
[ "${#HELPERS[@]}" = 2 ] || fail 'Missing backup/restore helper evidence.'
for helper in "${HELPERS[@]}"; do
  [ "$(docker inspect -f '{{.State.Running}}:{{.State.ExitCode}}' "$helper")" = false:0 ] || fail 'Backup or isolated restore did not finish successfully.'
done
[ "$(docker inspect -f '{{.Image}}' "${HELPERS[0]}")" = "$OLD_IMAGE" ] || fail 'Backup helper image mismatch.'
[ "$(docker inspect -f '{{.Image}}' "${HELPERS[1]}")" = "$CANDIDATE" ] || fail 'Restore helper image mismatch.'
mapfile -t OLD_IDS < <(python3 - "$SNAPSHOT_STAGE/crm-before.private.json" <<'PYIDS'
import json,sys
r=json.load(open(sys.argv[1])); by={x['Config']['Labels']['com.docker.compose.service']:x for x in r}
print(by['app']['Id']);print(by['worker']['Id'])
PYIDS
)
[ "${#OLD_IDS[@]}" = 2 ] || fail 'Missing original container identities.'
OLD_APP=${OLD_IDS[0]}; WORKER=${OLD_IDS[1]}
for cid in "$OLD_APP" "$WORKER"; do
  [ "$(docker inspect -f '{{.Image}}:{{.State.Running}}' "$cid")" = "$OLD_IMAGE:false" ] || fail 'Old CRM containers must remain stopped on the verified image.'
done
VOLUME=$(cat "$SNAPSHOT_STAGE/data-volume.txt")
[ -z "$(docker ps -q --filter "volume=$VOLUME")" ] || fail 'CRM data has a running user; snapshot is not final.'
RELEASE=$(mktemp -d "$BUILD/crm-release-c27b8e3-XXXXXX")
chmod 700 "$RELEASE"
CREATED=0
trap 'status=$?; if [ "$status" != 0 ]; then if [ "$CREATED" = 1 ]; then quiesce_candidate app; fi; printf "STOPPED: release evidence %s; app recreation attempted=%s; worker must remain stopped.\nDo not rerun, restore a database, or use the old-container resume script after recreation. Send only this status for recovery review.\n" "$RELEASE" "$CREATED" >&2; fi' EXIT
# Keep every original file and runtime.env dependency in place. Only append reviewed override.
cp "$BUILD/compose-paths.txt" "$RELEASE/original-compose-paths.txt"
cp "$OLD_RELEASE/crm.env" "$RELEASE/crm.env.evidence"
printf 'services:\n  app:\n    image: %s\n    environment:\n      RUN_MIGRATIONS: "false"\n  worker:\n    image: %s\n' "$CANDIDATE" "$CANDIDATE" > "$RELEASE/candidate-image.yaml"
# Source explicitly supports this flag; no migration command is invoked by candidate app.
python3 - "$BUILD/source/scripts/docker-entrypoint.sh" <<'PYSKIP'
import sys
s=open(sys.argv[1]).read()
if 'if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then' not in s or 'RUN_MIGRATIONS=false: skipping migrations' not in s:raise SystemExit('STOP: unrecognized migration skip behavior.')
PYSKIP
OLD=("${COMPOSE[@]}")
NEW=("${COMPOSE[@]}" -f "$RELEASE/candidate-image.yaml")
"${OLD[@]}" config --format json > "$RELEASE/old-config.private.json" 2> "$RELEASE/config-errors.private.log"
"${NEW[@]}" config --format json > "$RELEASE/new-config.private.json" 2>> "$RELEASE/config-errors.private.log"
python3 - "$RELEASE/old-config.private.json" "$RELEASE/new-config.private.json" "$SNAPSHOT_STAGE/crm-before.private.json" "$CANDIDATE" "$RELEASE/public-origin.txt" <<'PYCONFIG'
import json,sys,urllib.parse
old=json.load(open(sys.argv[1]));new=json.load(open(sys.argv[2]));rows=json.load(open(sys.argv[3]))
if old.get('name')!='max-travel-crm' or new.get('name')!='max-travel-crm':raise SystemExit('STOP: Compose project identity mismatch.')
expected=json.loads(json.dumps(old))
for name in ('app','worker'):expected['services'][name]['image']=sys.argv[4]
expected['services']['app'].setdefault('environment',{})['RUN_MIGRATIONS']='false'
if new!=expected:raise SystemExit('STOP: resolved configuration differs beyond image references and explicit app migration skip.')
for r in rows:
 name=r['Config']['Labels']['com.docker.compose.service'];service=old['services'][name]
 actual=dict(v.split('=',1) for v in r['Config']['Env'] if '=' in v)
 if any(v is None or actual.get(k)!=str(v) for k,v in service.get('environment',{}).items()):raise SystemExit('STOP: frozen environment differs from saved live environment.')
 expected_networks={old['networks'][k]['name'] for k in service.get('networks',{})}
 if expected_networks!=set(r['NetworkSettings']['Networks']):raise SystemExit('STOP: network identity mismatch.')
 if name=='app':
  expected_mounts=sorted((v['target'],old['volumes'][v['source']]['name'],v.get('read_only',False)) for v in service.get('volumes',[]) if v['type']=='volume')
  actual_mounts=sorted((v['Destination'],v.get('Name'),not v['RW']) for v in r['Mounts'])
  if expected_mounts!=actual_mounts:raise SystemExit('STOP: volume identity/mode mismatch.')
  ports={}
  for p in service.get('ports',[]):ports.setdefault(str(p['target'])+'/'+p.get('protocol','tcp'),[]).append({'HostIp':p.get('host_ip',''),'HostPort':str(p['published'])})
  if ports!=r['HostConfig']['PortBindings']:raise SystemExit('STOP: published port bindings differ.')
  origin=actual.get('APP_ORIGIN','');u=urllib.parse.urlsplit(origin)
  if u.scheme!='https' or not u.hostname or u.username or u.password or u.query or u.fragment or u.path not in ('','/'):raise SystemExit('STOP: public origin is not a plain HTTPS origin.')
  open(sys.argv[5],'w').write(origin.rstrip('/')+'\n')
PYCONFIG
# Check full candidate image defaults plus Compose environment before replacing old app.
python3 - "$HERE/.." "$RELEASE/new-config.private.json" "$BUILD/candidate-image.private.json" "$SNAPSHOT_STAGE/crm-before.private.json" <<'PYENV'
import json,sys
sys.path.insert(0,sys.argv[1]);from verify import effective_environment,env_map
config=json.load(open(sys.argv[2]));image=json.load(open(sys.argv[3]))[0]
for old in json.load(open(sys.argv[4])):
 name=old['Config']['Labels']['com.docker.compose.service'];expected=env_map(old['Config']['Env'])
 if name=='app':expected['RUN_MIGRATIONS']='false'
 if effective_environment(image,config['services'][name])!=expected:raise SystemExit('STOP: candidate default environment drift; review privately.')
PYENV
# All named networks and the data volume must already exist; Compose must not invent infrastructure.
python3 - "$RELEASE/new-config.private.json" <<'PYNETWORKS' > "$RELEASE/network-names.txt"
import json,sys
for v in json.load(open(sys.argv[1]))['networks'].values():print(v['name'])
PYNETWORKS
while IFS= read -r name; do docker network inspect "$name" >/dev/null; done < "$RELEASE/network-names.txt"
docker volume inspect "$VOLUME" >/dev/null
# Compare the exact backup schema, ledger and entity counts against the candidate's live read.
cp "$HERE/audit-crm.cjs" "$RELEASE/audit-db.cjs"
chmod 644 "$RELEASE/audit-db.cjs"
DB_NAME=$(python3 - "$SNAPSHOT/manifest.json" <<'PYNAME'
import json,sys,re
name=json.load(open(sys.argv[1]))['database']['fileName']
if not re.fullmatch(r'[A-Za-z0-9_.-]+\.db',name):raise SystemExit('STOP: unexpected snapshot database filename.')
print(name)
PYNAME
)
# This isolated reader never mounts the live data volume.
timeout 60s docker run --label maxtravel.cutover.helper=true --rm --pull never --network none --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges \
 --mount "type=bind,src=$SNAPSHOT,dst=/backup,readonly" --mount "type=bind,src=$RELEASE/audit-db.cjs,dst=/audit-db.cjs,readonly" \
 -e CRM_AUDIT_MANIFEST=/backup/manifest.json -e "DATABASE_URL=file:/backup/database/$DB_NAME" --entrypoint node "$CANDIDATE" /audit-db.cjs > "$RELEASE/baseline-audit.private.json" 2> "$RELEASE/baseline-audit.private.log"
(cd "$RELEASE" && sha256sum candidate-image.yaml audit-db.cjs > configuration.sha256)
printf '%s\n' "$SNAPSHOT_STAGE" > "$RELEASE/snapshot-stage.txt"
printf '%s\n' "$LIVE" > "$RELEASE/project-directory.txt"
mapfile -t BOOKING < <(docker ps -q --filter label=com.docker.compose.project=max-travel-booking)
docker inspect "${BOOKING[@]}" > "$RELEASE/booking-before.private.json"
python3 - "$SNAPSHOT_STAGE/booking-after.private.json" "$RELEASE/booking-before.private.json" <<'PYBOOKING'
import json,sys
before={r['Id']:r for r in json.load(open(sys.argv[1]))};after={r['Id']:r for r in json.load(open(sys.argv[2]))}
if before.keys()!=after.keys():raise SystemExit('STOP: booking/PostgreSQL identities changed.')
for id,r in after.items():
 if r['Image']!=before[id]['Image'] or r['RestartCount']!=before[id]['RestartCount'] or not r['State']['Running'] or r['State'].get('Health',{}).get('Status') not in (None,'healthy'):raise SystemExit('STOP: booking/PostgreSQL state changed.')
PYBOOKING
# No worker start, dependencies, build/pull or migrations. Explicit skip flag was verified above.
snapshot_all "$RELEASE/all-before.private.json"
protected_check "$SNAPSHOT_STAGE/all-after.private.json" "$RELEASE/all-before.private.json" ""
cmp "$SNAPSHOT_STAGE/backup-audit.private.json" "$RELEASE/baseline-audit.private.json" || fail 'Backup audit changed.'
touch "$SNAPSHOT_STAGE/cutover-attempted.txt"
CREATED=1
"${NEW[@]}" up -d --no-deps --no-build --pull never app > "$RELEASE/app-create.private.log" 2>&1
APP=$("${NEW[@]}" ps -q app)
[ -n "$APP" ] || fail 'New app container missing.'
[ "$(docker inspect -f '{{.Image}}' "$APP")" = "$CANDIDATE" ] || fail 'Running candidate image mismatch.'
healthy=0
for attempt in {1..90}; do
 if [ "$(docker inspect -f '{{.State.Health.Status}}' "$APP")" = healthy ]; then healthy=1; break; fi
 [ "$(docker inspect -f '{{.State.Running}}' "$APP")" = true ] || break
 sleep 2
done
[ "$healthy" = 1 ] || fail 'Candidate app did not become healthy; worker remains stopped.'
[ "$(docker inspect -f '{{.RestartCount}}' "$APP")" = 0 ] || fail 'Candidate restarted; inspect before proceeding.'
# Build ID must match the successful isolated build-readability record.
docker exec "$APP" node -e 'console.log(require("node:fs").readFileSync("/app/.next/BUILD_ID","utf8").trim())' > "$RELEASE/running-build-id.txt"
python3 - "$BUILD/non-root-readability.private.json" "$RELEASE/running-build-id.txt" <<'PYBUILD'
import json,sys
if json.load(open(sys.argv[1]))['buildId']!=open(sys.argv[2]).read().strip():raise SystemExit('STOP: running BUILD_ID differs from verified build.')
PYBUILD
# Read-only SQL audit inside app. No application imports or provider calls.
timeout 60s docker exec -i "$APP" node -e "$(cat "$RELEASE/audit-db.cjs")" < "$SNAPSHOT/manifest.json" > "$RELEASE/live-audit.private.json" 2> "$RELEASE/live-audit.private.log"
cmp -- "$RELEASE/baseline-audit.private.json" "$RELEASE/live-audit.private.json" || fail 'Schema, migration ledger or entity counts changed; keep worker stopped and review.'
curl --fail --silent --show-error --max-time 15 http://127.0.0.1:3107/api/health > "$RELEASE/local-health.private.json"
ORIGIN=$(cat "$RELEASE/public-origin.txt")
curl --fail --silent --show-error --max-time 20 "$ORIGIN/api/health" > "$RELEASE/public-health.private.json"
[ "$(curl --silent --show-error --max-time 20 --output "$RELEASE/login.private.html" --write-out '%{http_code}' "$ORIGIN/login")" = 200 ] || fail 'Public login did not return 200.'
[ "$(curl --silent --show-error --max-time 20 --output "$RELEASE/packages.private.json" --write-out '%{http_code}' "$ORIGIN/api/public/travel-packages")" = 200 ] || fail 'Public package catalogue did not return 200.'
python3 - "$RELEASE/login.private.html" "$RELEASE/packages.private.json" <<'PYHTTP'
from html.parser import HTMLParser
import json,sys
class Login(HTMLParser):
 def __init__(self):super().__init__();self.password=False
 def handle_starttag(self,tag,attrs):
  if tag=='input' and dict(attrs).get('type')=='password':self.password=True
page=Login();page.feed(open(sys.argv[1]).read())
if not page.password:raise SystemExit('STOP: public login form missing.')
data=json.load(open(sys.argv[2]))
if not isinstance(data.get('packages'),list) or not isinstance(data.get('truncated'),bool) or type(data.get('unavailableCount')) is not int or data['unavailableCount']<0:raise SystemExit('STOP: unexpected public package response.')
PYHTTP
[ "$(docker inspect -f '{{.State.Running}}' "$WORKER")" = false ] || fail 'Worker unexpectedly started.'
docker inspect "$APP" "$WORKER" > "$RELEASE/after.private.json"
python3 "$HERE/phase_verify.py" runtime-equal "$SNAPSHOT_STAGE/crm-before.private.json" "$RELEASE/after.private.json" crm
python3 - "$SNAPSHOT_STAGE/crm-before.private.json" "$RELEASE/after.private.json" <<'PYTOPOLOGY'
import json,sys
before={r['Config']['Labels']['com.docker.compose.service']:r for r in json.load(open(sys.argv[1]))}
after={r['Config']['Labels']['com.docker.compose.service']:r for r in json.load(open(sys.argv[2]))}
old=before['app'];new=after['app']
def env(r):return dict(x.split('=',1) for x in r['Config']['Env'])
expected=env(old);expected['RUN_MIGRATIONS']='false'
if env(new)!=expected:raise SystemExit('STOP: full runtime environment changed beyond migration skip.')
if new['Config'].get('Entrypoint')!=old['Config'].get('Entrypoint') or new['Config'].get('Cmd')!=old['Config'].get('Cmd') or new['Config'].get('User')!=old['Config'].get('User'):raise SystemExit('STOP: app startup identity differs.')
def mounts(row):return sorted(json.dumps(m,sort_keys=True,separators=(',',':')) for m in row['Mounts'])
if mounts(old)!=mounts(new) or old['HostConfig']['PortBindings']!=new['HostConfig']['PortBindings'] or set(old['NetworkSettings']['Networks'])!=set(new['NetworkSettings']['Networks']):raise SystemExit('STOP: candidate runtime topology differs.')
if after['worker']['Id']!=before['worker']['Id'] or after['worker']['Image']!=before['worker']['Image'] or after['worker']['State']['Running']:raise SystemExit('STOP: original worker changed or started.')
PYTOPOLOGY
mapfile -t BOOKING < <(docker ps -q --filter label=com.docker.compose.project=max-travel-booking)
docker inspect "${BOOKING[@]}" > "$RELEASE/booking-after.private.json"
python3 - "$SNAPSHOT_STAGE/booking-after.private.json" "$RELEASE/booking-after.private.json" <<'PYBOOKING'
import json,sys
before={r['Id']:r for r in json.load(open(sys.argv[1]))};after={r['Id']:r for r in json.load(open(sys.argv[2]))}
if before.keys()!=after.keys():raise SystemExit('STOP: booking/PostgreSQL identities changed.')
for id,r in after.items():
 if r['Image']!=before[id]['Image'] or r['RestartCount']!=before[id]['RestartCount'] or not r['State']['Running'] or r['State'].get('Health',{}).get('Status') not in (None,'healthy'):raise SystemExit('STOP: booking/PostgreSQL state changed.')
PYBOOKING
docker exec "$APP" node --version > "$RELEASE/runtime-node-version.txt"
snapshot_all "$RELEASE/all-after.private.json"
protected_check "$RELEASE/all-before.private.json" "$RELEASE/all-after.private.json" 'crm:app'
printf 'verified\n' > "$RELEASE/app-verified.txt"
printf '\nCRM APP-ONLY CUTOVER VERIFIED\nRelease: %s\nSource: %s\nImage: %s\n' "$RELEASE" "$TARGET" "$CANDIDATE"
printf 'App healthy; schema/ledger/entity counts unchanged. Worker remains STOPPED. Current release pointer not changed.\nSend only this summary; retain private evidence.\n'
