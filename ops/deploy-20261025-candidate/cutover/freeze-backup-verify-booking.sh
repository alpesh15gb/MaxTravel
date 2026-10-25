#!/usr/bin/env bash
# OFFLINE DRAFT: independent review required; never run before both builds verified.
set -Eeuo pipefail
umask 077
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$HERE/common.sh"
init booking
[ "$(df -Pk /root | awk 'END{print $4}')" -ge 20971520 ] || fail 'Less than20GiB backup disk free.'
[ "$(awk '/MemAvailable:/{print $2}' /proc/meminfo)" -ge 2097152 ] || fail 'Less than2GiB available for isolated verification.'
mapfile -t APPS < <(docker ps -q --filter label=com.docker.compose.project=max-travel-booking --filter label=com.docker.compose.service=app)
mapfile -t PGS < <(docker ps -q --filter label=com.docker.compose.project=max-travel-booking --filter label=com.docker.compose.service=postgres)
mapfile -t ALL_BOOKING < <(docker ps -q --filter label=com.docker.compose.project=max-travel-booking)
[ "${#APPS[@]}" = 1 ] && [ "${#PGS[@]}" = 1 ] && [ "${#ALL_BOOKING[@]}" = 2 ] || fail 'Expected only booking app and PostgreSQL; unexpected writer requires review.'
APP=${APPS[0]}; PG=${PGS[0]}
[ "$(docker inspect -f '{{.Image}}:{{.State.Health.Status}}:{{.RestartCount}}' "$APP")" = "$OLD_IMAGE:healthy:0" ] || fail 'Booking app baseline changed.'
[ "$(docker inspect -f '{{.Image}}:{{.State.Health.Status}}:{{.RestartCount}}' "$PG")" = "$PG_IMAGE:healthy:0" ] || fail 'PostgreSQL baseline changed.'
[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$APP")" = "$EXPECTED_FILES" ] || fail 'Booking app operative pointer differs.'
for cid in "$APP" "$PG"; do [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$cid")" = "$LIVE" ] || fail 'Booking project directory differs.'; done
mapfile -t CRM < <(docker ps -q --filter label=com.docker.compose.project=max-travel-crm)
[ "${#CRM[@]}" = 2 ] || fail 'Expected deployed CRM app and worker only.'
for cid in "${CRM[@]}"; do [ "$(docker inspect -f '{{.Image}}:{{.State.Running}}:{{.RestartCount}}' "$cid")" = "$CRM_IMAGE:true:0" ] || fail 'CRM cutover not complete/stable.'; done
STAGE=$(mktemp -d "$BUILD/final-backup-XXXXXX")
chmod 700 "$STAGE"
FROZEN=0; VERIFY=''
snapshot_all "$STAGE/all-before.private.json"
protected_build_check "$BUILD/after.private.json" "$STAGE/all-before.private.json.all.private.json" crm:app,crm:worker "$CRM_RELEASE"
protected_check "$CRM_RELEASE/all-final.private.json" "$STAGE/all-before.private.json" ""
trap 'status=$?; if [ -n "$VERIFY" ]; then timeout 30s docker stop --timeout 20 "$VERIFY" > "$STAGE/isolated-stop.private.log" 2>&1 || true; fi; if [ "$status" != 0 ]; then printf "STOPPED: booking freeze started=%s; private evidence %s. Do not rerun or restore into live PostgreSQL. Booking app may remain stopped; CRM and original PostgreSQL were not stopped.\n" "$FROZEN" "$STAGE" >&2; fi' EXIT
docker inspect "$APP" "$PG" > "$STAGE/booking-before.private.json"
docker inspect "${CRM[@]}" > "$STAGE/crm-before.private.json"

"${COMPOSE[@]}" config --format json > "$STAGE/config.private.json" 2> "$STAGE/config-errors.private.log"
python3 - "$STAGE/config.private.json" "$STAGE/booking-before.private.json" "$STAGE/crm-before.private.json" <<'PYCONFIG'
import json,sys
config=json.load(open(sys.argv[1]));rows=json.load(open(sys.argv[2]))
if config.get('name')!='max-travel-booking':raise SystemExit('STOP: Compose project mismatch.')
for r in rows:
 name=r['Config']['Labels']['com.docker.compose.service'];actual=dict(v.split('=',1) for v in r['Config']['Env'] if '=' in v)
 if name=='app':
  if any(v is None or actual.get(k)!=str(v) for k,v in config['services']['app'].get('environment',{}).items()):raise SystemExit('STOP: frozen/live app environment mismatch.')
 elif actual.get('POSTGRES_USER')!='maxtravel' or actual.get('POSTGRES_DB')!='maxtravel':raise SystemExit('STOP: PostgreSQL database/owner differs; do not guess credentials.')
for r in json.load(open(sys.argv[3])):
 if r['State'].get('Health',{}).get('Status') not in (None,'healthy'):raise SystemExit('STOP: CRM unhealthy.')
PYCONFIG
# Existing local Unix-socket owner access only. No password printed or passed as a command argument.
[ "$(docker exec "$PG" psql -X -U maxtravel -d maxtravel -Atc 'SELECT current_user')" = maxtravel ] || fail 'Existing owner socket access unavailable.'
docker exec "$PG" pg_dump --version > "$STAGE/pg-dump-version.txt"
# Fail BEFORE downtime on unreviewed live RLS role dependencies; source migrations define none.
[ "$(docker exec "$PG" psql -X -U maxtravel -d maxtravel -Atc "SELECT count(*) FROM pg_policies WHERE schemaname NOT IN ('pg_catalog','information_schema')")" = 0 ] || fail 'Live row-security policies require a separately reviewed isolated-role restore plan.'
# Create only isolated scratch storage. No live volume is attached to the verification server.
PG_UID=$(docker exec "$PG" id -u postgres); PG_GID=$(docker exec "$PG" id -g postgres)
[[ "$PG_UID" =~ ^[0-9]+$ && "$PG_GID" =~ ^[0-9]+$ ]] || fail 'Cannot determine existing image PostgreSQL UID/GID.'
mkdir -m 700 "$STAGE/isolated-data"
chown "$PG_UID:$PG_GID" "$STAGE/isolated-data"
VERIFY="booking-restore-$(basename "$STAGE" | tr '[:upper:]' '[:lower:]')"
docker run -d --label maxtravel.cutover.helper=true --pull never --name "$VERIFY" --network none --read-only --user "$PG_UID:$PG_GID" --cap-drop ALL --security-opt no-new-privileges --memory 1g --cpus 1 --pids-limit 256 \
 --tmpfs /tmp:rw,nosuid,nodev,mode=1777 --tmpfs /var/run/postgresql:rw,nosuid,nodev,mode=1777 \
 --mount "type=bind,src=$STAGE/isolated-data,dst=/var/lib/postgresql/data" \
 -e PGHOST=/tmp -e POSTGRES_USER=maxtravel -e POSTGRES_DB=maxtravel -e POSTGRES_HOST_AUTH_METHOD=trust \
 "$PG_IMAGE" -c listen_addresses= -c unix_socket_directories=/tmp > "$STAGE/isolated-container-id.txt"
ready=0
for attempt in {1..30}; do
 if docker exec "$VERIFY" psql -h /tmp -X -U maxtravel -d maxtravel -Atc 'SELECT 1' > /dev/null 2>&1; then ready=1; break; fi
 sleep 2
done
[ "$ready" = 1 ] || fail 'Isolated PostgreSQL did not start; booking app has not been stopped.'
[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$VERIFY")" = none ] || fail 'Isolated verifier network mismatch.'
[ "$(docker exec "$VERIFY" psql -h /tmp -X -U maxtravel -d maxtravel -Atc 'SHOW listen_addresses')" = '' ] || fail 'Isolated verifier must not listen on TCP.'
cat > "$STAGE/audit.sql" <<'SQL'
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SELECT format('SELECT %L || chr(9) || count(*)::text FROM %I.%I;', 'table:'||schemaname||'.'||tablename,schemaname,tablename) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,tablename
\gexec
SELECT format('SELECT %L || chr(9) || last_value::text || chr(9) || is_called::text FROM %I.%I;', 'sequence:'||schemaname||'.'||sequencename,schemaname,sequencename) FROM pg_sequences WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname,sequencename
\gexec
SELECT 'migration:'||name||chr(9)||applied_at::text FROM public.schema_migrations ORDER BY name;
COMMIT;
SQL
# Explicit fallback preserves the existing app/config and does not invoke migrations.
cat > "$STAGE/resume-old.sh" <<RESUME
#!/usr/bin/env bash
set -Eeuo pipefail
exec 9>/root/maxtravel-build-only.lock
flock -n 9 || { echo 'STOP: build or cutover phase already running'; exit 1; }
[ "\$(id -u)" = 0 ] && [ "\$(hostname)" = Apex ] || { echo 'STOP: intended root host required'; exit 1; }
[ -z "\${DOCKER_HOST:-}\${DOCKER_CONTEXT:-}\${DOCKER_CONFIG:-}" ] || { echo 'STOP: Docker endpoint overrides'; exit 1; }
[ "\$(docker context show)" = default ] && [ "\$(docker context inspect default --format '{{.Endpoints.docker.Host}}')" = unix:///var/run/docker.sock ] || { echo 'STOP: wrong Docker endpoint'; exit 1; }
sha256sum --check --status '$BUILD/frozen-originals.sha256'
[ "\$(docker inspect -f '{{.State.Running}}' '$VERIFY')" = false ] || { echo 'STOP: isolated helper still running; inspect and stop that helper only'; exit 1; }
[ "\$(cat '$BUILD/source-commit.txt')" = '$TARGET' ] || { echo 'STOP: build changed'; exit 1; }
[ ! -e '$STAGE/cutover-attempted.txt' ] && [ ! -e '$STAGE/resumed-old.txt' ] || { echo 'STOP: backup invalidated or recreation already attempted'; exit 1; }
[ "\$(docker inspect -f '{{.Image}}' '$APP')" = '$OLD_IMAGE' ] || { echo 'STOP: original app changed'; exit 1; }
[ "\$(docker inspect -f '{{.Image}}:{{.State.Health.Status}}' '$PG')" = '$PG_IMAGE:healthy' ] || { echo 'STOP: original PostgreSQL changed/unhealthy'; exit 1; }
touch '$STAGE/resumed-old.txt'
docker start '$APP' >/dev/null
healthy=0
for attempt in {1..60}; do if [ "\$(docker inspect -f '{{.State.Health.Status}}' '$APP')" = healthy ]; then healthy=1; break; fi; sleep 2; done
[ "\$healthy" = 1 ] || { echo 'STOP: old booking app unhealthy'; exit 1; }
echo 'Old booking app resumed; this backup is no longer a final cutover snapshot.'
RESUME
chmod 700 "$STAGE/resume-old.sh"
FROZEN=1
docker stop --timeout 45 "$APP" > "$STAGE/stop-app.log"
[ "$(docker inspect -f '{{.State.Running}}' "$APP")" = false ] || fail 'Booking app did not stop.'
# Refuse another ordinary client backend after application shutdown; do not terminate connections.
[ "$(docker exec "$PG" psql -X -U maxtravel -d maxtravel -Atc "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()")" = 0 ] || fail 'Other database clients remain; inspect writers before backup.'
timeout 120s docker exec -i "$PG" psql -X -qAt -v ON_ERROR_STOP=1 -U maxtravel -d maxtravel < "$STAGE/audit.sql" > "$STAGE/pre-dump-audit.private.txt" 2> "$STAGE/pre-dump-audit.private.log"
timeout 300s docker exec "$PG" pg_dump -U maxtravel -d maxtravel --format=custom > "$STAGE/database.dump" 2> "$STAGE/dump.private.log"
[ -s "$STAGE/database.dump" ] || fail 'Database archive is empty.'
timeout 60s docker exec "$PG" pg_dumpall -U maxtravel --globals-only --no-role-passwords > "$STAGE/globals-without-passwords.private.sql" 2> "$STAGE/globals.private.log"
timeout 120s docker exec -i "$PG" psql -X -qAt -v ON_ERROR_STOP=1 -U maxtravel -d maxtravel < "$STAGE/audit.sql" > "$STAGE/source-audit.private.txt" 2> "$STAGE/source-audit.private.log"
timeout 120s docker exec "$PG" pg_dump -U maxtravel -d maxtravel --schema-only --no-owner --no-acl > "$STAGE/source-schema.private.sql" 2> "$STAGE/source-schema.private.log"
timeout 60s docker exec -i "$VERIFY" pg_restore --list < "$STAGE/database.dump" > "$STAGE/archive-toc.private.txt" 2> "$STAGE/archive-toc.private.log"
timeout 300s docker exec -i "$VERIFY" pg_restore -h /tmp -U maxtravel -d maxtravel --exit-on-error --single-transaction --no-owner --no-acl < "$STAGE/database.dump" > "$STAGE/restore.private.log" 2>&1
timeout 120s docker exec -i "$VERIFY" psql -h /tmp -X -qAt -v ON_ERROR_STOP=1 -U maxtravel -d maxtravel < "$STAGE/audit.sql" > "$STAGE/restored-audit.private.txt" 2> "$STAGE/restored-audit.private.log"
timeout 120s docker exec "$VERIFY" pg_dump -h /tmp -U maxtravel -d maxtravel --schema-only --no-owner --no-acl > "$STAGE/restored-schema.private.sql" 2> "$STAGE/restored-schema.private.log"
cmp -- "$STAGE/pre-dump-audit.private.txt" "$STAGE/source-audit.private.txt" || fail 'Data changed during dump.'
cmp -- "$STAGE/source-audit.private.txt" "$STAGE/restored-audit.private.txt" || fail 'Restored table counts, sequences or migration ledger differ.'
python3 - "$STAGE/source-schema.private.sql" "$STAGE/restored-schema.private.sql" <<'PYSCHEMA'
import sys
# pg_dump anti-injection restrict tokens are random per invocation, not database schema.
def normalized(file):return '\n'.join(line for line in open(file).read().splitlines() if not line.startswith(('\\restrict ','\\unrestrict ')))
if normalized(sys.argv[1])!=normalized(sys.argv[2]):raise SystemExit('STOP: restored schema differs.')
PYSCHEMA
sha256sum "$STAGE/database.dump" "$STAGE/globals-without-passwords.private.sql" "$STAGE/audit.sql" "$STAGE/source-audit.private.txt" "$STAGE/restored-audit.private.txt" "$STAGE/source-schema.private.sql" "$STAGE/restored-schema.private.sql" > "$STAGE/backup.sha256"
mapfile -t CRM_AFTER < <(docker ps -q --filter label=com.docker.compose.project=max-travel-crm)
docker inspect "${CRM_AFTER[@]}" > "$STAGE/crm-after.private.json"
python3 - "$STAGE/crm-before.private.json" "$STAGE/crm-after.private.json" <<'PYCRM'
import json,sys
before={r['Id']:r for r in json.load(open(sys.argv[1]))};after={r['Id']:r for r in json.load(open(sys.argv[2]))}
if before.keys()!=after.keys():raise SystemExit('STOP: CRM identities changed.')
for id,r in after.items():
 if r['Image']!=before[id]['Image'] or r['RestartCount']!=before[id]['RestartCount'] or not r['State']['Running'] or r['State'].get('Health',{}).get('Status') not in (None,'healthy'):raise SystemExit('STOP: protected CRM state changed.')
PYCRM
[ "$(docker inspect -f '{{.Image}}:{{.State.Health.Status}}:{{.RestartCount}}' "$PG")" = "$PG_IMAGE:healthy:0" ] || fail 'Original PostgreSQL changed.'
[ "$(docker inspect -f '{{.State.Running}}' "$APP")" = false ] || fail 'Booking app resumed; snapshot is no longer final.'
timeout 30s docker stop --timeout 20 "$VERIFY" > "$STAGE/isolated-stop.private.log"
VERIFY=''
snapshot_all "$STAGE/all-after.private.json"
protected_check "$STAGE/all-before.private.json" "$STAGE/all-after.private.json" booking:app
printf '%s\n' "$TARGET" > "$STAGE/verified-source.txt"
printf 'verified\n' > "$STAGE/restore-verified.txt"
printf '\nFINAL BOOKING BACKUP AND ISOLATED RESTORE VERIFIED\nDirectory: %s\nBooking app remains STOPPED; original PostgreSQL and CRM unchanged.\n' "$STAGE"
printf 'Archive retains owner/ACL metadata; isolated restore verifies data/schema/counts/sequences/ledger without recreating production roles/passwords. No migrations or provider calls executed.\nIf abandoning maintenance: bash %s/resume-old.sh\nSend only this summary, never private backup/config/log files.\n' "$STAGE"
