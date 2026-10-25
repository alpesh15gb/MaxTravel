#!/usr/bin/env bash
# One incident only: verify and restart the SAME contained candidate; no recreate/DB restore.
set -Eeuo pipefail
printf '%s\n' 'STOP: incident recovery belongs exclusively to immutable ops/deploy-20261024 at 3c6512; this candidate cannot recover/revalidate historical stages.' >&2
exit 1
umask 077
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init crm
[[ $BUILD == /root/crm-build-c27b8e3-p3drk2 ]] || fail 'Unexpected incident build.'
: "${RELEASE:?Exact failed app-only release required}"
[[ $RELEASE == "$BUILD/crm-release-c27b8e3-2S4iPz" && -d $RELEASE && ! -L $RELEASE ]] || fail 'Unexpected incident release.'
APP=e7153d4b7464ca74d9583c4ad25b134eb5daff3e9c3d8e35c078ec531630675e
WORKER=18f1415897ef28c4ab0dc31b3ba3fbc348cdcd64694088963be3bb30ed0e8867
[[ $CANDIDATE == sha256:b10e495f4f8fbaca93153552e6484800670c91fa7e778a759674829b28cc3e0a ]] || fail 'Unexpected incident candidate.'
SNAPSHOT_STAGE=$(cat "$RELEASE/snapshot-stage.txt")
[[ $SNAPSHOT_STAGE == "$BUILD/final-backup-QC1WkM" ]] || fail 'Unexpected incident snapshot.'
[[ -e $SNAPSHOT_STAGE/cutover-attempted.txt && ! -e $SNAPSHOT_STAGE/resumed-old.txt ]] || fail 'Incident marker mismatch.'
[[ ! -e $RELEASE/app-recovery-attempted.txt && ! -L $RELEASE/app-recovery-attempted.txt && ! -e $RELEASE/app-verified.txt && ! -e $RELEASE/all-after.private.json && ! -e $RELEASE/runtime-node-version.txt ]] || fail 'Release already progressed; do not repeat recovery.'
[[ $(cat "$SNAPSHOT_STAGE/restore-verified.txt") == verified ]] || fail 'Restore verification missing.'
(cd "$RELEASE" && sha256sum --check --status configuration.sha256)
for file in manifest.sha256 audit.sha256 payload.sha256; do sha256sum --check --status "$SNAPSHOT_STAGE/$file"; done
cmp "$SNAPSHOT_STAGE/backup-audit.private.json" "$RELEASE/baseline-audit.private.json" || fail 'Recovery baseline differs from sealed backup.'
cmp "$RELEASE/baseline-audit.private.json" "$RELEASE/live-audit.private.json" || fail 'Original app audit did not pass.'
RECOVERY=$(mktemp -d "$RELEASE/recovery-XXXXXX")
ATTEMPTED=0
trap 'status=$?; if ((status)); then if ((ATTEMPTED)); then RELEASE="$RECOVERY" quiesce_candidate app; fi; printf "STOPPED: same-candidate recovery attempted=%s; private evidence %s. Worker remains stopped; do not recreate or restore a database.\n" "$ATTEMPTED" "$RECOVERY" >&2; fi' EXIT
snapshot_all "$RECOVERY/all-before.private.json"
protected_check "$RELEASE/all-before.private.json" "$RECOVERY/all-before.private.json" 'crm:app'
[[ $(docker inspect -f '{{.Image}}' "$APP") == "$CANDIDATE" ]] || fail 'Incident app image mismatch.'
docker inspect "$APP" "$WORKER" > "$RECOVERY/current.private.json"
NEW=("${COMPOSE[@]}" -f "$RELEASE/candidate-image.yaml")
"${NEW[@]}" config --format json > "$RECOVERY/config.private.json" 2> "$RECOVERY/config-errors.private.log"
python3 -I - "$HERE" "$SNAPSHOT_STAGE/crm-before.private.json" "$RELEASE/after.private.json" "$RECOVERY/current.private.json" "$RELEASE/new-config.private.json" "$RECOVERY/config.private.json" "$RECOVERY" "$APP" "$WORKER" "$RELEASE/public-origin.txt" "$RELEASE/failed-app-$APP.private.json" <<'PY'
import json,pathlib,sys,copy
sys.path.insert(0,sys.argv[1]);from phase_verify import runtime_equal
from verify import canonical_mounts
old=json.load(open(sys.argv[2]));saved=json.load(open(sys.argv[3]));current=json.load(open(sys.argv[4]));oldconfig=json.load(open(sys.argv[5]));config=json.load(open(sys.argv[6]));out=pathlib.Path(sys.argv[7])
def by(rows,name):
 found=[r for r in rows if r['Config']['Labels']['com.docker.compose.service']==name]
 assert len(found)==1;return found[0]
a=by(old,'app');s=by(saved,'app');n=by(current,'app');w=by(current,'worker')
assert len(current)==len(old)==len(saved)==2
assert a['Id']=='e66323f2616d616624f4ba307ebd5b0de11230c207070d4cdf477d4d15cd2cfe'
assert s['Id']==n['Id']==sys.argv[8] and w['Id']==by(old,'worker')['Id']==sys.argv[9]
assert oldconfig==config and config['services']['app']['restart']=='unless-stopped'
policy=a['HostConfig']['RestartPolicy'];assert policy=={'Name':'unless-stopped','MaximumRetryCount':0}
assert s['HostConfig']['RestartPolicy']==policy and n['HostConfig']['RestartPolicy']=={'Name':'no','MaximumRetryCount':0}
assert s['State']['Running'] and s['State']['Health']['Status']=='healthy' and s['RestartCount']==0
assert n['RestartCount']==0 and not n['State']['Running'] and n['State']['Status']=='exited'
assert not any(n['State'].get(k) for k in ('Paused','Restarting','Dead','OOMKilled'))
assert not w['State']['Running']
contained=json.load(open(sys.argv[11]));assert len(contained)==1
assert contained[0]['Id']==n['Id'] and contained[0]['Config']==s['Config'] and contained[0]['HostConfig']==s['HostConfig']
assert n['Image']==s['Image']==contained[0]['Image']=='sha256:b10e495f4f8fbaca93153552e6484800670c91fa7e778a759674829b28cc3e0a' and n['Config']==s['Config'] and n['Name']==s['Name'] and canonical_mounts(n['Mounts'])==canonical_mounts(s['Mounts'])
normalized=copy.deepcopy(current);by(normalized,'app')['HostConfig']['RestartPolicy']=policy
assert by(normalized,'app')['HostConfig']==s['HostConfig']
runtime_equal(old,normalized,'crm')
env=dict(x.split('=',1) for x in n['Config']['Env']);assert env.get('RUN_MIGRATIONS')=='false'
assert env['APP_ORIGIN'].rstrip('/')==open(sys.argv[10]).read().strip()
(out/'verified-restart-policy.txt').write_text(policy['Name']+'\n')
PY
VOLUME=$(cat "$SNAPSHOT_STAGE/data-volume.txt")
[[ -z $(docker ps -q --filter "volume=$VOLUME") ]] || fail 'Unexpected live CRM volume user.'
# Existing candidate reads live SQLite only; no network, worker import, migration or live writes.
timeout 120s docker run --rm --label maxtravel.cutover.helper=true --pull never --network none --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges --memory 768m --cpus 1 --pids-limit 64 \
 --mount "type=volume,src=$VOLUME,dst=/data,readonly" --mount "type=bind,src=$RELEASE/audit-db.cjs,dst=/audit-db.cjs,readonly" \
 -e DATABASE_URL=file:/data/app.db --entrypoint node "$CANDIDATE" /audit-db.cjs > "$RECOVERY/pre-audit.private.json" 2> "$RECOVERY/pre-audit.private.log"
cmp "$RELEASE/baseline-audit.private.json" "$RECOVERY/pre-audit.private.json" || fail 'Database changed; reconcile without restoring.'
printf '%s\n' "$RECOVERY" > "$RELEASE/app-recovery-attempted.txt"
ATTEMPTED=1
# Exact saved policy and SAME immutable container ID; no Compose up/create/recreate.
docker update --restart="$(cat "$RECOVERY/verified-restart-policy.txt")" "$APP" > "$RECOVERY/restore-policy.private.log"
[[ $(docker inspect -f '{{.State.Running}}' "$APP") == false ]] || fail 'Unexpected startup before explicit start.'
docker start "$APP" > "$RECOVERY/start.private.log"
healthy=0
for attempt in {1..90}; do
 if [[ $(docker inspect -f '{{.State.Health.Status}}' "$APP") == healthy ]]; then healthy=1; break; fi
 [[ $(docker inspect -f '{{.State.Running}}' "$APP") == true ]] || break
 sleep 2
done
[[ $healthy == 1 && $(docker inspect -f '{{.RestartCount}}' "$APP") == 0 ]] || fail 'Existing candidate not healthy/stable.'
docker inspect "$APP" "$WORKER" > "$RECOVERY/after.private.json"
python3 -I "$HERE/phase_verify.py" runtime-equal "$SNAPSHOT_STAGE/crm-before.private.json" "$RECOVERY/after.private.json" crm
docker exec "$APP" node -e 'console.log(require("node:fs").readFileSync("/app/.next/BUILD_ID","utf8").trim())' > "$RECOVERY/build-id.txt"
python3 -I - "$BUILD/non-root-readability.private.json" "$RECOVERY/build-id.txt" <<'PY'
import json,sys
assert json.load(open(sys.argv[1]))['buildId']==open(sys.argv[2]).read().strip()
PY
timeout 60s docker exec "$APP" node -e "$(cat "$RELEASE/audit-db.cjs")" > "$RECOVERY/live-audit.private.json" 2> "$RECOVERY/live-audit.private.log"
cmp "$RELEASE/baseline-audit.private.json" "$RECOVERY/live-audit.private.json" || fail 'Database audit changed after restart; no blind restore.'
ORIGIN=$(cat "$RELEASE/public-origin.txt")
curl --fail --silent --show-error --max-time 15 http://127.0.0.1:3107/api/health > "$RECOVERY/local-health.private.json"
curl --fail --silent --show-error --max-time 20 "$ORIGIN/api/health" > "$RECOVERY/public-health.private.json"
[[ $(curl --silent --show-error --max-time 20 --output "$RECOVERY/login.private.html" --write-out '%{http_code}' "$ORIGIN/login") == 200 ]] || fail 'Login failed.'
[[ $(curl --silent --show-error --max-time 20 --output "$RECOVERY/packages.private.json" --write-out '%{http_code}' "$ORIGIN/api/public/travel-packages") == 200 ]] || fail 'Catalogue failed.'
python3 -I - "$RECOVERY/login.private.html" "$RECOVERY/packages.private.json" <<'PY'
import json,sys
from html.parser import HTMLParser
class Login(HTMLParser):
 def __init__(self):super().__init__();self.password=False
 def handle_starttag(self,tag,attrs):
  if tag=='input' and dict(attrs).get('type')=='password':self.password=True
page=Login();page.feed(open(sys.argv[1]).read());assert page.password
p=json.load(open(sys.argv[2]));assert isinstance(p.get('packages'),list) and isinstance(p.get('truncated'),bool) and type(p.get('unavailableCount')) is int and p['unavailableCount']>=0
PY
[[ $(docker inspect -f '{{.State.Running}}' "$WORKER") == false ]] || fail 'Worker unexpectedly started.'
snapshot_all "$RECOVERY/all-after.private.json"
protected_check "$RELEASE/all-before.private.json" "$RECOVERY/all-after.private.json" 'crm:app'
[[ $(docker inspect -f '{{.Image}}:{{.State.Health.Status}}:{{.RestartCount}}' "$APP") == "$CANDIDATE:healthy:0" ]] || fail 'Candidate changed during recovery.'
# Original evidence remains untouched. These original completion files were absent above.
docker exec "$APP" node --version > "$RELEASE/runtime-node-version.txt"
cp "$RECOVERY/all-after.private.json" "$RELEASE/all-after.private.json"
printf '%s\n' "$RECOVERY" > "$RELEASE/app-recovery-stage.txt"
printf 'verified\n' > "$RELEASE/app-verified.txt"
printf 'CRM SAME-CANDIDATE APP RECOVERY VERIFIED\nRelease: %s\nContainer: %s\nWorker remains stopped; current pointer unchanged.\n' "$RELEASE" "$APP"
