#!/usr/bin/env bash
# USER-RUN VPS ONLY. Final CRM writer freeze + verified backup. NO cutover/migration.
set -Eeuo pipefail
umask 077
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"
init crm

for tool in docker python3 git sha256sum timeout; do command -v "$tool" >/dev/null || fail "Missing $tool"; done
[ -d "$BUILD" ] && [ ! -L "$BUILD" ] || fail 'Verified CRM build directory missing/symlinked.'
[ "$(cat "$BUILD/source-commit.txt")" = "$TARGET" ] || fail 'Build source mismatch.'
[ "$(cat "$BUILD/candidate-image-id.txt")" = "$CANDIDATE" ] || fail 'Candidate image mismatch.'
[ "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$CANDIDATE")" = "$TARGET" ] || fail 'Candidate revision mismatch.'
docker image inspect "$OLD_IMAGE" >/dev/null
sha256sum --check --status "$BUILD/frozen-originals.sha256"
sha256sum --check --status "$BUILD/rollback-image.sha256"
for name in compose.vps.yaml compose.evolution.yaml image-override.yaml; do
  [ -f "$OLD_RELEASE/$name" ] && [ ! -L "$OLD_RELEASE/$name" ] || fail 'Frozen config changed.'
  cmp -- "$OLD_RELEASE/$name" "$BUILD/preserved$OLD_RELEASE/$name"
done
[ -f "$OLD_RELEASE/crm.env" ] && [ ! -L "$OLD_RELEASE/crm.env" ] || fail 'Frozen env missing/symlinked.'
cmp -- "$OLD_RELEASE/crm.env" "$BUILD/preserved$OLD_RELEASE/crm.env"
# Operational source policy checked in common init against exact historical baseline.
[ "$(df -Pk /root | awk 'END{print $4}')" -ge 20971520 ] || fail 'Less than 20GiB backup disk free.'
mapfile -t APPS < <(docker ps -q --filter label=com.docker.compose.project=max-travel-crm --filter label=com.docker.compose.service=app)
mapfile -t WORKERS < <(docker ps -q --filter label=com.docker.compose.project=max-travel-crm --filter label=com.docker.compose.service=worker)
[ "${#APPS[@]}" = 1 ] && [ "${#WORKERS[@]}" = 1 ] || fail 'Expected one running CRM app and worker.'
APP=${APPS[0]}; WORKER=${WORKERS[0]}
for cid in "$APP" "$WORKER"; do
  [ "$(docker inspect -f '{{.Image}}' "$cid")" = "$OLD_IMAGE" ] || fail 'CRM running image changed.'
  [ "$(docker inspect -f '{{.RestartCount}}' "$cid")" = 0 ] || fail 'CRM restarted since preflight.'
  [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$cid")" = "$EXPECTED_FILES" ] || fail 'CRM operative config pointer changed.'
  [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$cid")" = "$LIVE" ] || fail 'CRM working directory changed.'
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$APP")" = healthy ] || fail 'CRM unhealthy before freeze.'
STAGE=$(mktemp -d "$BUILD/final-backup-XXXXXX")
chmod 700 "$STAGE"
snapshot_all "$STAGE/all-before.private.json"
protected_build_check "$BUILD/after.private.json" "$STAGE/all-before.private.json.all.private.json" ""
# Read-only live ledger precheck before generating the no-new-migrations resume escape.
timeout 120s docker exec "$APP" node -e "$(cat "$HERE/audit-crm.cjs")" > "$STAGE/pre-freeze-audit.private.json" 2> "$STAGE/pre-freeze-audit.private.log"
FROZEN=0
trap 'status=$?; if [ "$status" != 0 ]; then printf "STOPPED: private evidence %s; freeze started=%s. Do not rerun or cut over.\n" "$STAGE" "$FROZEN" >&2; if [ "$FROZEN" = 1 ]; then printf "CRM may remain stopped. Old containers: app=%s worker=%s. Inspect helper status, then use reviewed resume-old.sh if abandoning this attempt.\n" "$APP" "$WORKER" >&2; fi; fi' EXIT
docker inspect "$APP" "$WORKER" > "$STAGE/crm-before.private.json"
mapfile -t BOOKING < <(docker ps -q --filter label=com.docker.compose.project=max-travel-booking)
[ "${#BOOKING[@]}" -ge 2 ] || fail 'Booking baseline unavailable.'
docker inspect "${BOOKING[@]}" > "$STAGE/booking-before.private.json"
"${COMPOSE[@]}" config --format json > "$STAGE/resolved.private.json" 2> "$STAGE/config-errors.private.log"
python3 - "$STAGE/resolved.private.json" "$STAGE/crm-before.private.json" "$STAGE/data-volume.txt" <<'PYCONFIG'
import json,sys
config=json.load(open(sys.argv[1])); rows=json.load(open(sys.argv[2]))
for r in rows:
    name=r['Config']['Labels']['com.docker.compose.service']; actual=dict(v.split('=',1) for v in r['Config']['Env'] if '=' in v)
    expected=config['services'][name].get('environment',{})
    if any(v is None or actual.get(k)!=str(v) for k,v in expected.items()): raise SystemExit('STOP: frozen/live environment mismatch; inspect privately.')
    if name=='app':
        if actual.get('DATABASE_URL')!='file:/data/app.db' or actual.get('UPLOAD_ROOT')!='/data/uploads' or actual.get('PACKAGE_MEDIA_ROOT','/data/package-media') not in ('','/data/package-media'): raise SystemExit('STOP: unexpected data paths; do not assume backup coverage.')
        mounts=[m for m in r['Mounts'] if m['Destination']=='/data']
        if len(mounts)!=1 or mounts[0]['Type']!='volume' or not mounts[0].get('Name'): raise SystemExit('STOP: unexpected CRM data mount.')
        open(sys.argv[3],'w').write(mounts[0]['Name']+'\n')
PYCONFIG
VOLUME=$(cat "$STAGE/data-volume.txt")
# Reject another running container mounting the same data volume before declaring a writer freeze.
mapfile -t USERS < <(docker ps -q --filter "volume=$VOLUME")
for cid in "${USERS[@]}"; do [ "$cid" = "$APP" ] || fail 'Another running container mounts CRM data; review writers.'; done
# Private writable targets for unprivileged helper processes; parent remains root-only 0700.
mkdir -m 700 "$STAGE/backup" "$STAGE/restore" "$STAGE/tmp-backup" "$STAGE/tmp-restore"
chown 1000:1000 "$STAGE/backup" "$STAGE/restore" "$STAGE/tmp-backup" "$STAGE/tmp-restore"
BACKUP_HELPER="crm-final-backup-$(basename "$STAGE" | tr '[:upper:]' '[:lower:]')"
RESTORE_HELPER="crm-final-restore-$(basename "$STAGE" | tr '[:upper:]' '[:lower:]')"
printf '%s\n%s\n' "$BACKUP_HELPER" "$RESTORE_HELPER" > "$STAGE/helper-names.txt"
# Explicit fallback only; not run automatically. Old app normal startup rechecks existing migrations; no new source/schema is installed.
cat > "$STAGE/resume-old.sh" <<RESUME
#!/usr/bin/env bash
set -Eeuo pipefail
[ "\$(id -u)" = 0 ] && [ "\$(hostname)" = Apex ] || { echo 'STOP: intended host required'; exit 1; }
[ -z "\${DOCKER_HOST:-}\${DOCKER_CONTEXT:-}\${DOCKER_CONFIG:-}" ] || { echo 'STOP: Docker override'; exit 1; }
[ "\$(docker context show)" = default ] && [ "\$(docker context inspect default --format '{{.Endpoints.docker.Host}}')" = unix:///var/run/docker.sock ] || { echo 'STOP: wrong Docker endpoint'; exit 1; }
exec 9>/root/maxtravel-build-only.lock; flock -n 9 || { echo 'STOP: another phase running'; exit 1; }
sha256sum --check --status '$BUILD/frozen-originals.sha256'
[ ! -e '$STAGE/cutover-attempted.txt' ] && [ ! -e '$STAGE/resumed-old.txt' ] || { echo 'STOP: cutover attempted or snapshot invalidated'; exit 1; }
for helper in '$BACKUP_HELPER' '$RESTORE_HELPER'; do
  if docker container inspect "\$helper" >/dev/null 2>&1; then
    [ "\$(docker inspect -f '{{.State.Running}}' "\$helper")" = false ] || { echo 'STOP: backup/restore helper still running'; exit 1; }
  fi
done
for cid in '$APP' '$WORKER'; do
  [ "\$(docker inspect -f '{{.Image}}' "\$cid")" = '$OLD_IMAGE' ] || { echo 'STOP: old container changed'; exit 1; }
done
touch '$STAGE/resumed-old.txt'
docker start '$APP' >/dev/null
healthy=0
for attempt in {1..60}; do
  if [ "\$(docker inspect -f '{{.State.Health.Status}}' '$APP')" = healthy ]; then healthy=1; break; fi
  sleep 2
done
[ "\$healthy" = 1 ] || { echo 'STOP: old app not healthy; worker remains stopped'; exit 1; }
docker start '$WORKER' >/dev/null
echo 'Old CRM resumed. This backup is no longer a final cutover snapshot; take a new one before cutover.'
RESUME
chmod 700 "$STAGE/resume-old.sh"
# Synthetic same-image Prisma compatibility check BEFORE any service stop.
# This proves the backend can VACUUM a read-only fixture, not that the real WAL is readable.
mkdir -m 700 "$STAGE/probe-source" "$STAGE/probe-output"
chown 1000:1000 "$STAGE/probe-source" "$STAGE/probe-output"
timeout 60s docker run --label maxtravel.cutover.helper=true --rm --pull never --name "crm-probe-create-$(basename "$STAGE" | tr '[:upper:]' '[:lower:]')" --network none --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges \
  --mount "type=bind,src=$STAGE/probe-source,dst=/fixture" --entrypoint node "$OLD_IMAGE" -e '
const {PrismaClient}=require("@prisma/client");
const p=new PrismaClient({datasources:{db:{url:"file:/fixture/input.db"}}});
(async()=>{try{await p.$executeRawUnsafe("CREATE TABLE probe (id INTEGER PRIMARY KEY)");await p.$executeRawUnsafe("INSERT INTO probe VALUES (1)");}finally{await p.$disconnect();}})().catch(()=>{process.exitCode=1});
' > "$STAGE/probe-create.private.log" 2>&1
timeout 60s docker run --label maxtravel.cutover.helper=true --rm --pull never --name "crm-probe-readonly-$(basename "$STAGE" | tr '[:upper:]' '[:lower:]')" --network none --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges \
  --mount "type=bind,src=$STAGE/probe-source,dst=/fixture,readonly" --mount "type=bind,src=$STAGE/probe-output,dst=/output" --entrypoint node "$OLD_IMAGE" -e '
const {PrismaClient}=require("@prisma/client"),fs=require("node:fs/promises");
const p=new PrismaClient({datasources:{db:{url:"file:/fixture/input.db"}}});
(async()=>{const sql="VACUUM INTO "+String.fromCharCode(39)+"/output/copy.db"+String.fromCharCode(39);try{try{await p.$executeRawUnsafe(sql);}catch{await fs.rm("/output/copy.db",{force:true});await p.$queryRawUnsafe(sql);}}finally{await p.$disconnect();}const q=new PrismaClient({datasources:{db:{url:"file:/output/copy.db"}}});try{const rows=await q.$queryRawUnsafe("SELECT COUNT(*) AS total FROM probe");if(Number(rows[0].total)!==1)throw Error("fixture mismatch");}finally{await q.$disconnect();}})().catch(()=>{process.exitCode=1});
' > "$STAGE/probe-readonly.private.log" 2>&1
printf 'Beginning CRM maintenance: stopping worker, then app. Booking/PostgreSQL stay running.\n'
FROZEN=1
docker stop --timeout 260 "$WORKER" > "$STAGE/stop-worker.log"
docker stop --timeout 45 "$APP" > "$STAGE/stop-app.log"
for cid in "$APP" "$WORKER"; do [ "$(docker inspect -f '{{.State.Running}}' "$cid")" = false ] || fail 'CRM writer did not stop.'; done
[ -z "$(docker ps -q --filter "volume=$VOLUME")" ] || fail 'CRM data still mounted by a running container.'
# No production secrets, network, application entrypoint or migration command in either helper.
# Read-only live source: if SQLite refuses this mode, STOP rather than switching to writable.
timeout 15m docker run --label maxtravel.cutover.helper=true --pull never --name "$BACKUP_HELPER" --memory 1g --cpus 1 --pids-limit 128 --network none --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges \
  --mount "type=volume,src=$VOLUME,dst=/data,readonly" \
  --mount "type=bind,src=$STAGE/backup,dst=/backups" --mount "type=bind,src=$STAGE/tmp-backup,dst=/tmp" \
  -e DATABASE_URL=file:/data/app.db -e UPLOAD_ROOT=/data/uploads -e PACKAGE_MEDIA_ROOT=/data/package-media \
  --entrypoint node "$OLD_IMAGE" scripts/backup.mjs --out /backups > "$STAGE/backup.private.log" 2>&1
mapfile -t SNAPSHOTS < <(find "$STAGE/backup" -mindepth 1 -maxdepth 1 -type d -name 'backup-*')
[ "${#SNAPSHOTS[@]}" = 1 ] || fail 'Expected one completed backup.'
SNAPSHOT=${SNAPSHOTS[0]}
python3 - "$SNAPSHOT/manifest.json" <<'PYMANIFEST'
import json,sys
m=json.load(open(sys.argv[1]))
if m.get('formatVersion')!=2 or m.get('rowCountErrors') or any(not isinstance(v,int) or isinstance(v,bool) or v<0 for v in m.get('rowCounts',{}).values()): raise SystemExit('STOP: incomplete backup manifest/counts.')
if not m.get('rowCounts') or not m.get('database',{}).get('sha256'): raise SystemExit('STOP: backup metadata incomplete.')
PYMANIFEST
timeout 15m docker run --label maxtravel.cutover.helper=true --pull never --name "$RESTORE_HELPER" --memory 1g --cpus 1 --pids-limit 128 --network none --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges \
  --mount "type=bind,src=$SNAPSHOT,dst=/backup,readonly" \
  --mount "type=bind,src=$STAGE/restore,dst=/restored" --mount "type=bind,src=$STAGE/tmp-restore,dst=/tmp" \
  --entrypoint node "$CANDIDATE" scripts/restore.mjs --in /backup --out /restored > "$STAGE/restore.private.log" 2>&1
# Exhaustive audit independent of backup tool's curated model list.
cp -- "$HERE/audit-crm.cjs" "$STAGE/audit-crm.cjs"; chmod 644 "$STAGE/audit-crm.cjs"
for kind in live backup restored; do
 case "$kind" in
 live) MOUNT="type=volume,src=$VOLUME,dst=/audit-data,readonly"; DB_PATH=app.db;;
 backup) MOUNT="type=bind,src=$SNAPSHOT/database,dst=/audit-data,readonly"; DB_PATH=app.db;;
 restored) MOUNT="type=bind,src=$STAGE/restore,dst=/audit-data,readonly"; DB_PATH=app.db;;
 esac
 timeout 120s docker run --rm --label maxtravel.cutover.helper=true --pull never --network none --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges --memory 768m --cpus 1 --pids-limit 64 \
 --mount "$MOUNT" --mount "type=bind,src=$STAGE/audit-crm.cjs,dst=/audit-crm.cjs,readonly" \
 -e "DATABASE_URL=file:/audit-data/$DB_PATH" --entrypoint node "$CANDIDATE" /audit-crm.cjs > "$STAGE/$kind-audit.private.json" 2> "$STAGE/$kind-audit.private.log"
done
cmp "$STAGE/live-audit.private.json" "$STAGE/backup-audit.private.json" || fail 'Live-to-backup exhaustive audit mismatch.'
cmp "$STAGE/backup-audit.private.json" "$STAGE/restored-audit.private.json" || fail 'Isolated restore exhaustive audit mismatch.'
# Independently prove full live attachments/media coverage, including empty directories.
cp "$HERE/audit-tree.cjs" "$STAGE/audit-tree.cjs"; chmod 644 "$STAGE/audit-tree.cjs"
for kind in live backup restored; do
 case "$kind" in
 live) MOUNT="type=volume,src=$VOLUME,dst=/audit-data,readonly";;
 backup) MOUNT="type=bind,src=$SNAPSHOT,dst=/audit-data,readonly";;
 restored) MOUNT="type=bind,src=$STAGE/restore,dst=/audit-data,readonly";;
 esac
 timeout 120s docker run --rm --label maxtravel.cutover.helper=true --pull never --network none --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges --memory 1g --cpus 1 --pids-limit 64 \
 --mount "$MOUNT" --mount "type=bind,src=$STAGE/audit-tree.cjs,dst=/audit-tree.cjs,readonly" \
 --entrypoint node "$CANDIDATE" /audit-tree.cjs > "$STAGE/$kind-tree-audit.private.json" 2> "$STAGE/$kind-tree-audit.private.log"
done
cmp "$STAGE/live-tree-audit.private.json" "$STAGE/backup-tree-audit.private.json" || fail 'Live attachment/media backup coverage mismatch.'
cmp "$STAGE/backup-tree-audit.private.json" "$STAGE/restored-tree-audit.private.json" || fail 'Restored attachment/media tree differs.'
# Seal every backup payload file, not only manifest; reject link/special before hashing.
python3 - "$SNAPSHOT" <<'PYSEAL' > "$STAGE/payload.sha256"
import pathlib,hashlib,sys,stat
root=pathlib.Path(sys.argv[1])
for p in sorted(root.rglob('*')):
 mode=p.lstat().st_mode
 if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):raise SystemExit('STOP: nonregular backup entry.')
 if p.is_file():
  h=hashlib.sha256()
  with p.open('rb') as f:
   for chunk in iter(lambda:f.read(1048576),b''):h.update(chunk)
  print(h.hexdigest()+'  '+str(p))
PYSEAL
sha256sum "$STAGE/"*-audit.private.json > "$STAGE/audit.sha256"
sha256sum "$SNAPSHOT/manifest.json" > "$STAGE/manifest.sha256"
printf '%s\n' "$SNAPSHOT" > "$STAGE/verified-snapshot.txt"
mapfile -t AFTER_BOOKING < <(docker ps -q --filter label=com.docker.compose.project=max-travel-booking)
docker inspect "${AFTER_BOOKING[@]}" > "$STAGE/booking-after.private.json"
python3 - "$STAGE/booking-before.private.json" "$STAGE/booking-after.private.json" <<'PYBOOKING'
import json,sys
before={r['Id']:r for r in json.load(open(sys.argv[1]))}; after={r['Id']:r for r in json.load(open(sys.argv[2]))}
if before.keys()!=after.keys(): raise SystemExit('STOP: booking container identities changed.')
for id,r in after.items():
    if r['Image']!=before[id]['Image'] or r['RestartCount']!=before[id]['RestartCount'] or not r['State']['Running'] or r['State'].get('Health',{}).get('Status') not in (None,'healthy'): raise SystemExit('STOP: booking runtime changed/unhealthy.')
PYBOOKING
for cid in "$APP" "$WORKER"; do [ "$(docker inspect -f '{{.State.Running}}' "$cid")" = false ] || fail 'CRM resumed unexpectedly; snapshot no longer final.'; done
snapshot_all "$STAGE/all-after.private.json"
protected_check "$STAGE/all-before.private.json" "$STAGE/all-after.private.json" 'crm:app,crm:worker'
printf 'verified\n' > "$STAGE/restore-verified.txt"
printf '\nFINAL CRM BACKUP AND ISOLATED RESTORE VERIFIED\nDirectory: %s\nSnapshot: %s\nCRM app/worker remain STOPPED pending reviewed cutover. Booking unchanged.\n' "$STAGE" "$SNAPSHOT"
printf 'No live DB restore or migration performed. Send only this summary. If abandoning maintenance, reviewed fallback: bash %s/resume-old.sh\n' "$STAGE"
