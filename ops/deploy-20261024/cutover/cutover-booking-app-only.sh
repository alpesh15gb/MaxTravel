#!/usr/bin/env bash
# OFFLINE DRAFT: independent review required; never run before both builds verified.
set -Eeuo pipefail
umask 077
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$HERE/common.sh"
init booking
: "${BOOKING_BACKUP_STAGE:?Exact successful backup stage required}"
POINTER=/root/maxtravel-revamp-backup-9B5326/booking-current-cutover-path.txt
case "$BOOKING_BACKUP_STAGE" in "$BUILD"/final-backup-*) ;; *) fail 'Unexpected backup stage.';; esac
[ -d "$BOOKING_BACKUP_STAGE" ] && [ ! -L "$BOOKING_BACKUP_STAGE" ] || fail 'Backup stage missing/symlinked.'
[ "$(cat "$BOOKING_BACKUP_STAGE/restore-verified.txt")" = verified ] && [ "$(cat "$BOOKING_BACKUP_STAGE/verified-source.txt")" = "$TARGET" ] || fail 'Final backup/restore verification missing.'
sha256sum --check --status "$BOOKING_BACKUP_STAGE/backup.sha256"
cmp -- "$BOOKING_BACKUP_STAGE/source-audit.private.txt" "$BOOKING_BACKUP_STAGE/restored-audit.private.txt"
[ -f "$POINTER" ] && [ ! -L "$POINTER" ] && [ "$(cat "$POINTER")" = "$OLD_RELEASE" ] || fail 'Current booking pointer differs.'
[ "$(cat "$BUILD/source-commit.txt")" = "$TARGET" ] && [ "$(cat "$BUILD/candidate-image-id.txt")" = "$CANDIDATE" ] || fail 'Build identity differs.'
[ "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$CANDIDATE")" = "$TARGET" ] || fail 'Candidate revision differs.'
sha256sum --check --status "$BUILD/frozen-originals.sha256"
sha256sum --check --status "$BUILD/rollback-image.sha256"
[ ! -e "$BOOKING_BACKUP_STAGE/cutover-attempted.txt" ] && [ ! -e "$BOOKING_BACKUP_STAGE/resumed-old.txt" ] || fail 'Backup invalidated or cutover already attempted.'
git -C "$BUILD/git" diff --exit-code "$BASELINE" "$TARGET" -- booking-platform/Dockerfile booking-platform/db booking-platform/scripts/migrate.mjs booking-platform/scripts/provision-runtime-role.mjs > /dev/null || fail 'Migration/schema/entrypoint source changed.'
mapfile -t IDS < <(python3 - "$BOOKING_BACKUP_STAGE/booking-before.private.json" <<'PYIDS'
import json,sys
rows={r['Config']['Labels']['com.docker.compose.service']:r for r in json.load(open(sys.argv[1]))}
print(rows['app']['Id']);print(rows['postgres']['Id'])
PYIDS
)
[ "${#IDS[@]}" = 2 ] || fail 'Original app/PostgreSQL identities missing.'
OLD_APP=${IDS[0]}; PG=${IDS[1]}
[ "$(docker inspect -f '{{.Image}}:{{.State.Running}}' "$OLD_APP")" = "$OLD_IMAGE:false" ] || fail 'Old app must remain stopped.'
[ "$(docker inspect -f '{{.Image}}:{{.State.Health.Status}}:{{.RestartCount}}' "$PG")" = "$PG_IMAGE:healthy:0" ] || fail 'Original PostgreSQL changed.'
mapfile -t ACTIVE_BOOKING < <(docker ps -q --filter label=com.docker.compose.project=max-travel-booking)
[ "${#ACTIVE_BOOKING[@]}" = 1 ] && [ "$(docker inspect -f '{{.Id}}' "${ACTIVE_BOOKING[0]}")" = "$PG" ] || fail 'Unexpected running booking service/writer.'
# Source pin retains direct server startup, never a migrate/provision command.
docker inspect "$OLD_APP" > "$BOOKING_BACKUP_STAGE/pre-cutover-app.private.json"
python3 - "$BOOKING_BACKUP_STAGE/pre-cutover-app.private.json" "$BUILD/candidate-image.private.json" <<'PYSTARTUP'
import json,sys
old=json.load(open(sys.argv[1]))[0]['Config'];new=json.load(open(sys.argv[2]))[0]['Config']
if old.get('Cmd')!=['node','server.js'] or new.get('Cmd')!=['node','server.js']:raise SystemExit('STOP: unreviewed app startup command.')
if old.get('Entrypoint')!=['docker-entrypoint.sh'] or new.get('Entrypoint')!=['docker-entrypoint.sh']:raise SystemExit('STOP: unreviewed entrypoint.')
if old.get('User')!='travel' or new.get('User')!='travel':raise SystemExit('STOP: unreviewed app user.')
PYSTARTUP
RELEASE=$(mktemp -d "$BUILD/booking-release-${TARGET:0:7}-XXXXXX")
chmod 700 "$RELEASE"
CREATED=0
trap 'status=$?; if [ "$status" != 0 ]; then if [ "$CREATED" = 1 ]; then quiesce_candidate app || printf "STOP: candidate quiesce failed; inspect exact candidate app privately before any further action.\n" >&2; fi; printf "STOPPED: app recreation attempted=%s; private release evidence %s. Do not rerun, restore live PostgreSQL, or use old-container resume after recreation.\n" "$CREATED" "$RELEASE" >&2; fi' EXIT
# Do not copy/rebase Compose files: retain every original dependency and absolute runtime.env.
mapfile -t RUNTIME_PATHS < "$BUILD/runtime-env-paths.txt"
[ "${#RUNTIME_PATHS[@]}" = 1 ] || fail 'Expected exactly one frozen runtime.env dependency.'
printf '%s\n' "${RUNTIME_PATHS[0]}" > "$RELEASE/runtime-env-source.txt"
printf 'services:\n  app:\n    image: %s\n' "$CANDIDATE" > "$RELEASE/candidate-image.yaml"
OLD=("${COMPOSE[@]}")
NEW=("${COMPOSE[@]}" -f "$RELEASE/candidate-image.yaml")
"${OLD[@]}" config --format json > "$RELEASE/old-config.private.json" 2> "$RELEASE/config-errors.private.log"
"${NEW[@]}" config --format json > "$RELEASE/new-config.private.json" 2>> "$RELEASE/config-errors.private.log"
"${NEW[@]}" config --no-env-resolution --format json > "$RELEASE/unresolved.private.json" 2>> "$RELEASE/config-errors.private.log"
python3 - "$RELEASE/old-config.private.json" "$RELEASE/new-config.private.json" "$RELEASE/unresolved.private.json" "$BOOKING_BACKUP_STAGE/booking-before.private.json" "$CANDIDATE" "${RUNTIME_PATHS[0]}" "$RELEASE/public-origin.txt" <<'PYCONFIG'
import json,sys,urllib.parse
old=json.load(open(sys.argv[1]));new=json.load(open(sys.argv[2]));unresolved=json.load(open(sys.argv[3]));rows=json.load(open(sys.argv[4]))
if old.get('name')!='max-travel-booking' or new.get('name')!='max-travel-booking':raise SystemExit('STOP: project mismatch.')
expected=json.loads(json.dumps(old));expected['services']['app']['image']=sys.argv[5]
if new!=expected:raise SystemExit('STOP: configuration changed beyond app image.')
paths=[x if isinstance(x,str) else x.get('path') for x in unresolved['services']['app'].get('env_file',[])]
if not paths or any(p!=sys.argv[6] for p in paths):raise SystemExit('STOP: runtime env_file is not frozen absolute source.')
app=next(r for r in rows if r['Config']['Labels']['com.docker.compose.service']=='app');actual=dict(v.split('=',1) for v in app['Config']['Env'] if '=' in v);service=old['services']['app']
if any(v is None or actual.get(k)!=str(v) for k,v in service.get('environment',{}).items()):raise SystemExit('STOP: frozen/live app environment differs.')
try:db=urllib.parse.urlsplit(actual.get('DATABASE_URL',''))
except ValueError:raise SystemExit('STOP: invalid runtime database URL.')
if db.username!='maxtravel_app' or actual.get('MIGRATION_DATABASE_URL') or actual.get('RUNTIME_DATABASE_PASSWORD'):raise SystemExit('STOP: runtime must retain restricted role without owner/provisioning credentials.')
if actual.get('SEO_INDEXING_ENABLED')=='true':raise SystemExit('STOP: testing deployment must remain non-indexed.')
origin=actual.get('BETTER_AUTH_URL','');u=urllib.parse.urlsplit(origin)
if u.scheme!='https' or not u.hostname or u.username or u.password or u.query or u.fragment or u.path not in ('','/'):raise SystemExit('STOP: public origin is not plain HTTPS.')
open(sys.argv[7],'w').write(origin.rstrip('/')+'\n')
networks={old['networks'][n]['name'] for n in service.get('networks',{})}
if networks!=set(app['NetworkSettings']['Networks']):raise SystemExit('STOP: app network identity differs.')
ports={}
for p in service.get('ports',[]):ports.setdefault(str(p['target'])+'/'+p.get('protocol','tcp'),[]).append({'HostIp':p.get('host_ip',''),'HostPort':str(p['published'])})
if ports!=app['HostConfig']['PortBindings']:raise SystemExit('STOP: published ports differ.')
PYCONFIG
python3 - "$RELEASE/new-config.private.json" "$BOOKING_BACKUP_STAGE/booking-before.private.json" "$BUILD/candidate-image.private.json" <<'PYENV'
import json,sys
config=json.load(open(sys.argv[1]));old=next(r for r in json.load(open(sys.argv[2])) if r['Config']['Labels']['com.docker.compose.service']=='app');image=json.load(open(sys.argv[3]))[0]
expected=dict(v.split('=',1) for v in image['Config'].get('Env',[]) if '=' in v)
for k,v in config['services']['app'].get('environment',{}).items():
 if v is None:expected.pop(k,None)
 else:expected[k]=str(v)
if expected!=dict(v.split('=',1) for v in old['Config']['Env'] if '=' in v):raise SystemExit('STOP: candidate effective environment differs from old runtime; review image defaults privately.')
PYENV
python3 - "$RELEASE/new-config.private.json" <<'PYNETWORKS' > "$RELEASE/network-names.txt"
import json,sys
for n in json.load(open(sys.argv[1]))['networks'].values():print(n['name'])
PYNETWORKS
while IFS= read -r name; do docker network inspect "$name" >/dev/null; done < "$RELEASE/network-names.txt"
# Public/runtime metadata only; isolated candidate gets no production env, DB mount or network.
timeout 60s docker run --rm --label maxtravel.cutover.helper=true --pull never --network none --read-only --cap-drop ALL --security-opt no-new-privileges --entrypoint node "$CANDIDATE" -e 'console.log(JSON.stringify({buildId:require("node:fs").readFileSync("/app/.next/BUILD_ID","utf8").trim(),node:process.version}))' > "$RELEASE/candidate-runtime.json"
cat > "$RELEASE/check-crm.py" <<'PYCRM'
import json,sys
before={r['Id']:r for r in json.load(open(sys.argv[1]))};after={r['Id']:r for r in json.load(open(sys.argv[2]))}
if before.keys()!=after.keys():raise SystemExit('STOP: CRM identities changed.')
for id,r in after.items():
 if r['Image']!=before[id]['Image'] or r['Image']!=sys.argv[3] or r['RestartCount']!=before[id]['RestartCount'] or not r['State']['Running'] or r['State'].get('Health',{}).get('Status') not in (None,'healthy'):raise SystemExit('STOP: protected CRM state changed.')
PYCRM
mapfile -t CRM < <(docker ps -q --filter label=com.docker.compose.project=max-travel-crm)
docker inspect "${CRM[@]}" > "$RELEASE/crm-before.private.json"
python3 "$RELEASE/check-crm.py" "$BOOKING_BACKUP_STAGE/crm-after.private.json" "$RELEASE/crm-before.private.json" "$CRM_IMAGE"
# Verify final data did not change between backup and cutover; SQL is read-only.
timeout 120s docker exec -i "$PG" psql -X -qAt -v ON_ERROR_STOP=1 -U maxtravel -d maxtravel < "$BOOKING_BACKUP_STAGE/audit.sql" > "$RELEASE/pre-audit.private.txt" 2> "$RELEASE/pre-audit.private.log"
cmp -- "$BOOKING_BACKUP_STAGE/source-audit.private.txt" "$RELEASE/pre-audit.private.txt" || fail 'Data changed since final backup; reconcile before starting candidate.'
[ "$(docker exec "$PG" psql -X -U maxtravel -d maxtravel -Atc "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()")" = 0 ] || fail 'Unexpected database clients before cutover.'
timeout 120s docker exec "$PG" pg_dump -U maxtravel -d maxtravel --schema-only --no-owner --no-acl > "$RELEASE/pre-schema.private.sql" 2> "$RELEASE/pre-schema.private.log"
python3 - "$BOOKING_BACKUP_STAGE/source-schema.private.sql" "$RELEASE/pre-schema.private.sql" <<'PYPRESCHEMA'
import sys
def normalized(file):return '\n'.join(line for line in open(file).read().splitlines() if not line.startswith(('\\restrict ','\\unrestrict ')))
if normalized(sys.argv[1])!=normalized(sys.argv[2]):raise SystemExit('STOP: schema changed since backup; do not cut over.')
PYPRESCHEMA
(cd "$RELEASE" && sha256sum candidate-image.yaml > configuration.sha256)
cp -- "$BUILD/frozen-originals.sha256" "$RELEASE/frozen-originals.sha256"
cp -- "$POINTER" "$RELEASE/prior-current-pointer.txt"
printf '%s\n' "$BOOKING_BACKUP_STAGE" > "$RELEASE/backup-stage.txt"
printf '%s\n' "$LIVE" > "$RELEASE/project-directory.txt"
printf '%s\n' "${FILES[@]}" "$RELEASE/candidate-image.yaml" > "$RELEASE/compose-paths.txt"
snapshot_all "$RELEASE/all-before.private.json"
protected_check "$BOOKING_BACKUP_STAGE/all-after.private.json" "$RELEASE/all-before.private.json" ""
# Snapshot becomes non-resumable BEFORE Compose can remove the original container.
touch "$BOOKING_BACKUP_STAGE/cutover-attempted.txt"
sha256sum --check --status "$BUILD/frozen-originals.sha256"
CREATED=1
"${NEW[@]}" up -d --no-deps --no-build --pull never app > "$RELEASE/app-create.private.log" 2>&1
APP=$("${NEW[@]}" ps -q app)
[ -n "$APP" ] && [ "$(docker inspect -f '{{.Image}}' "$APP")" = "$CANDIDATE" ] || fail 'Candidate app/image missing.'
healthy=0
for attempt in {1..90}; do
 if [ "$(docker inspect -f '{{.State.Health.Status}}' "$APP")" = healthy ]; then healthy=1; break; fi
 [ "$(docker inspect -f '{{.State.Running}}' "$APP")" = true ] || break
 sleep 2
done
[ "$healthy" = 1 ] || fail 'Candidate did not become healthy.'
[ "$(docker inspect -f '{{.RestartCount}}' "$APP")" = 0 ] || fail 'Candidate restarted.'
docker exec "$APP" node -e 'console.log(JSON.stringify({buildId:require("node:fs").readFileSync("/app/.next/BUILD_ID","utf8").trim(),node:process.version}))' > "$RELEASE/live-runtime.json"
cmp -- "$RELEASE/candidate-runtime.json" "$RELEASE/live-runtime.json" || fail 'Candidate BUILD_ID/runtime mismatch.'
timeout 120s docker exec -i "$PG" psql -X -qAt -v ON_ERROR_STOP=1 -U maxtravel -d maxtravel < "$BOOKING_BACKUP_STAGE/audit.sql" > "$RELEASE/post-audit.private.txt" 2> "$RELEASE/post-audit.private.log"
cmp -- "$BOOKING_BACKUP_STAGE/source-audit.private.txt" "$RELEASE/post-audit.private.txt" || fail 'Counts/sequences/ledger changed; reconcile legitimate requests before proceeding, never auto-restore.'
timeout 120s docker exec "$PG" pg_dump -U maxtravel -d maxtravel --schema-only --no-owner --no-acl > "$RELEASE/post-schema.private.sql" 2> "$RELEASE/post-schema.private.log"
python3 - "$BOOKING_BACKUP_STAGE/source-schema.private.sql" "$RELEASE/post-schema.private.sql" <<'PYSCHEMA'
import sys
def normalized(file):return '\n'.join(line for line in open(file).read().splitlines() if not line.startswith(('\\restrict ','\\unrestrict ')))
if normalized(sys.argv[1])!=normalized(sys.argv[2]):raise SystemExit('STOP: live schema changed.')
PYSCHEMA
ORIGIN=$(cat "$RELEASE/public-origin.txt")
for path in /api/health / /robots.txt /api/packages; do
 name=$(printf '%s' "$path" | tr '/' '_'); [ -n "$name" ] || name=home
 [ "$(curl --silent --show-error --max-time 20 --output "$RELEASE/http${name}.private" --write-out '%{http_code}' "$ORIGIN$path")" = 200 ] || fail 'A public health/HTML/robots/package check failed.'
done
[ "$(curl --silent --show-error --max-time 15 --output "$RELEASE/local-health.private.json" --write-out '%{http_code}' http://127.0.0.1:3108/api/health)" = 200 ] || fail 'Local health failed.'
python3 - "$RELEASE" <<'PYHTTP'
import json,pathlib,re,sys,urllib.parse
from html.parser import HTMLParser
root=pathlib.Path(sys.argv[1])
for name in ('http_api_health.private','local-health.private.json'):
 if json.loads((root/name).read_text()).get('status')!='ready':raise SystemExit('STOP: health body not ready.')
robots=(root/'http_robots.txt.private').read_text()
if not re.search(r'(?im)^User-agent:\s*\*\s*$',robots) or not re.search(r'(?im)^Disallow:\s*/\s*$',robots):raise SystemExit('STOP: robots indexing guard missing.')
p=json.loads((root/'http_api_packages.private').read_text())
if not isinstance(p.get('packages'),list):raise SystemExit('STOP: public package contract missing.')
class Page(HTMLParser):
 def __init__(self):super().__init__();self.asset=None;self.noindex=False
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='meta' and a.get('name')=='robots' and 'noindex' in a.get('content',''):self.noindex=True
  src=a.get('src','')
  if tag=='script' and src.startswith('/_next/static/') and not src.startswith('//') and not self.asset:self.asset=src
page=Page();page.feed((root/'http_.private').read_text())
if not page.noindex or not page.asset:raise SystemExit('STOP: HTML noindex/static asset missing.')
u=urllib.parse.urlsplit(page.asset)
if u.scheme or u.netloc or u.fragment or '..' in u.path or '\\' in page.asset:raise SystemExit('STOP: unsafe asset path.')
(root/'asset-path.txt').write_text(page.asset+'\n')
PYHTTP
ASSET=$(cat "$RELEASE/asset-path.txt")
[ "$(curl --silent --show-error --max-time 20 --output "$RELEASE/static-asset.private.js" --write-out '%{http_code}' "$ORIGIN$ASSET")" = 200 ] || fail 'Rendered static asset failed.'
[ -s "$RELEASE/static-asset.private.js" ] || fail 'Rendered static asset empty.'
# Stability observation is not a supplier/payment test.
for attempt in {1..3}; do sleep 10; [ "$(docker inspect -f '{{.Image}}:{{.State.Health.Status}}:{{.RestartCount}}' "$APP")" = "$CANDIDATE:healthy:0" ] || fail 'App stability changed.'; done
EXPECTED_FILES="$EXPECTED_FILES,$RELEASE/candidate-image.yaml"
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$APP")" = "$EXPECTED_FILES" ] || fail 'Candidate operative Compose file pointers differ.'
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$APP")" = "$LIVE" ] || fail 'Candidate project working directory differs.'
docker inspect "$APP" "$PG" > "$RELEASE/final-containers.private.json"
python3 "$HERE/phase_verify.py" runtime-equal "$BOOKING_BACKUP_STAGE/booking-before.private.json" "$RELEASE/final-containers.private.json" booking
python3 - "$BOOKING_BACKUP_STAGE/booking-before.private.json" "$RELEASE/final-containers.private.json" "$RELEASE/new-config.private.json" "$BUILD/candidate-image.private.json" <<'PYTOPOLOGY'
import json,sys
before={r['Config']['Labels']['com.docker.compose.service']:r for r in json.load(open(sys.argv[1]))};after={r['Config']['Labels']['com.docker.compose.service']:r for r in json.load(open(sys.argv[2]))};config=json.load(open(sys.argv[3]))
p=after['postgres'];oldp=before['postgres']
if p['Id']!=oldp['Id'] or p['Image']!=oldp['Image'] or p['RestartCount']!=oldp['RestartCount'] or p['State'].get('Health',{}).get('Status')!='healthy':raise SystemExit('STOP: PostgreSQL changed.')
a=after['app'];olda=before['app']
if a['HostConfig']!=olda['HostConfig']:raise SystemExit('STOP: runtime security/resources/host configuration changed.')
def mounts(r):return sorted(json.dumps(m,sort_keys=True,separators=(',',':')) for m in r['Mounts'])
if mounts(a)!=mounts(olda) or a['HostConfig']['PortBindings']!=olda['HostConfig']['PortBindings'] or set(a['NetworkSettings']['Networks'])!=set(olda['NetworkSettings']['Networks']):raise SystemExit('STOP: runtime app topology changed.')
if any(a['Config'].get(k)!=olda['Config'].get(k) for k in ('Cmd','Entrypoint','User')):raise SystemExit('STOP: app command/entrypoint/user changed.')
actual=dict(v.split('=',1) for v in a['Config']['Env'] if '=' in v)
if actual!=dict(v.split('=',1) for v in olda['Config']['Env'] if '=' in v):raise SystemExit('STOP: effective environment changed from original app.')
image=json.load(open(sys.argv[4]))[0]
expected=dict(v.split('=',1) for v in image['Config'].get('Env',[]) if '=' in v)
for k,v in config['services']['app'].get('environment',{}).items():
 if v is None:expected.pop(k,None)
 else:expected[k]=str(v)
if actual!=expected:raise SystemExit('STOP: full effective runtime app environment mismatch.')
PYTOPOLOGY
mapfile -t CRM_AFTER < <(docker ps -q --filter label=com.docker.compose.project=max-travel-crm)
docker inspect "${CRM_AFTER[@]}" > "$RELEASE/crm-after.private.json"
python3 "$RELEASE/check-crm.py" "$BOOKING_BACKUP_STAGE/crm-after.private.json" "$RELEASE/crm-after.private.json" "$CRM_IMAGE"
mapfile -t ACTIVE_BOOKING < <(docker ps -q --filter label=com.docker.compose.project=max-travel-booking)
[ "${#ACTIVE_BOOKING[@]}" = 2 ] || fail 'Unexpected booking worker/service started.'
snapshot_all "$RELEASE/all-after.private.json"
protected_check "$RELEASE/all-before.private.json" "$RELEASE/all-after.private.json" booking:app
sha256sum --check --status "$BUILD/frozen-originals.sha256"
[ -f "$POINTER" ] && [ ! -L "$POINTER" ] && [ "$(cat "$POINTER")" = "$OLD_RELEASE" ] || fail 'Current pointer changed during cutover.' 
TMP_POINTER=$(mktemp "${POINTER}.tmp.XXXXXX"); chmod 600 "$TMP_POINTER"; printf '%s\n' "$RELEASE" > "$TMP_POINTER"; mv -T -- "$TMP_POINTER" "$POINTER"
[ "$(cat "$POINTER")" = "$RELEASE" ] || fail 'Pointer verification failed.'
printf '%s\n' "$TARGET" > "$RELEASE/deployed-source.txt"
printf '%s\n' "$CANDIDATE" > "$RELEASE/deployed-image.txt"
printf '\nBOOKING APP CUTOVER VERIFIED\nRelease: %s\nSource: %s\nImage: %s\n' "$RELEASE" "$TARGET" "$CANDIDATE"
printf 'App healthy; BUILD_ID verified; schema/counts/sequences/ledger unchanged; indexing off; public HTML/asset/packages checked. CRM and original PostgreSQL unchanged, no workers started.\nExisting pointer advanced. Retain old frozen runtime.env source and all private backups. No payment/provider transaction was tested.\n'
