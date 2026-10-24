#!/usr/bin/env bash
# REVIEWED PREPARATION ONLY. Do not execute until fresh VPS preflight is reviewed.
# Does not deploy, invoke application entrypoints, migrate, or change existing services.
set -Eeuo pipefail
umask 077
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
fail() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
[[ $# == 1 && "$1" =~ ^(crm|booking)$ ]] || fail 'Usage: preserve-build.sh crm|booking'
APP=$1
[[ ${APPROVED_BUILD_ONLY:-} == 'reviewed fresh preflight; build only' ]] || fail 'Fresh preflight review acknowledgement required.'
EXPECTED_HOSTNAME=Apex
# Default is the historically used standard builder, without CPU/memory caps.
# Optional bounded builder is allowed ONLY if it already exists and is verified below.
BUILD_BUILDER=${BUILD_BUILDER:-}
BUILD_CONTAINER=${BUILD_CONTAINER:-}
[[ -z ${BUILDX_BUILDER:-} && -z ${DOCKER_BUILDKIT:-} ]] || fail 'Unexpected build backend override; review before continuing.'
[[ $(id -u) == 0 && $(hostname) == "$EXPECTED_HOSTNAME" ]] || fail 'Root or intended host identity check failed.'
for tool in docker git python3 tar sha256sum timeout flock; do command -v "$tool" >/dev/null || fail "Missing $tool"; done
[[ -z ${DOCKER_HOST:-} && -z ${DOCKER_CONTEXT:-} && -z ${DOCKER_CONFIG:-} ]] || fail 'Remove Docker endpoint overrides; use reviewed local default context.'
[[ $(docker context show) == default ]] || fail 'Expected default Docker context.'
[[ $(docker context inspect default --format '{{.Endpoints.docker.Host}}') == unix:///var/run/docker.sock ]] || fail 'Expected local Docker socket.'
exec 9>/root/maxtravel-build-only.lock
flock -n 9 || fail 'Another preparation build is running. Build CRM and booking sequentially.'
pin() { python3 "$HERE/verify.py" pin "$APP" "$1"; }
TARGET=$(pin commit); TREE=$(pin tree); BASELINE=$(pin baseline); OLD_IMAGE=$(pin image)
OLD_RELEASE=$(pin release); LIVE=$(pin live); REPO=$(pin repo); ENV_NAME=$(pin env)
[[ $(awk '/MemAvailable:/{print $2}' /proc/meminfo) -ge 9437184 ]] || fail 'Less than 9 GiB available; defer build.'
DOCKER_ROOT=$(docker info --format '{{.DockerRootDir}}')
for path in /root "$DOCKER_ROOT"; do [[ $(df -Pk "$path" | awk 'END{print $4}') -ge 20971520 ]] || fail 'Less than 20 GiB free on staging or Docker filesystem.'; done
STAGE=$(mktemp -d "/root/${APP}-build-${TARGET:0:7}-XXXXXX")
mkdir -m 700 "$STAGE/preserved" "$STAGE/source"
trap 's=$?; if ((s)); then printf "STOPPED; private evidence retained at %s. Do not cut over or automatically retry.\n" "$STAGE" >&2; fi' EXIT
snapshot() {
 docker ps -aq --no-trunc > "$STAGE/container-ids.txt"
 mapfile -t IDS < "$STAGE/container-ids.txt"
 ((${#IDS[@]})) || fail 'No containers found.'
 docker inspect "${IDS[@]}" > "$1"
}
snapshot "$STAGE/before.private.json"
python3 "$HERE/verify.py" runtime "$STAGE/before.private.json"
# Image defaults are necessary for full effective-environment comparison, including PostgreSQL.
python3 - "$HERE" "$STAGE/before.private.json" <<'PYIMAGES' > "$STAGE/protected-image-ids.txt"
import sys
sys.path.insert(0,sys.argv[1]);from verify import runtime,read
# Retired check image is not a deployed runtime dependency. Its entire container
# remains in before/after snapshots and must not be changed or removed.
print('\n'.join(sorted({r['Image'] for r in runtime(read(sys.argv[2])).values()})))
PYIMAGES
mapfile -t PROTECTED_IMAGES < "$STAGE/protected-image-ids.txt"
docker image inspect "${PROTECTED_IMAGES[@]}" > "$STAGE/deployed-images.private.json"
BUILD=(docker build)
if [[ -n $BUILD_BUILDER ]]; then
 [[ $BUILD_BUILDER =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ && $BUILD_CONTAINER =~ ^buildx_buildkit_[a-zA-Z0-9_.-]+$ ]] || fail 'Invalid optional builder identity.'
 docker buildx inspect "$BUILD_BUILDER" > "$STAGE/builder.private.txt" 2> "$STAGE/builder-errors.private.log"
 docker inspect "$BUILD_CONTAINER" > "$STAGE/builder-container.private.json"
 python3 "$HERE/verify.py" builder "$STAGE/builder.private.txt" "$STAGE/builder-container.private.json" "$BUILD_BUILDER"
 BUILD=(docker buildx build --builder "$BUILD_BUILDER" --load)
else
 [[ -z $BUILD_CONTAINER ]] || fail 'Builder container supplied without builder name.'
 printf 'Standard existing builder: CPU and memory are NOT capped. Sequential builds and capacity checks reduce risk but production latency may temporarily increase.\n'
fi
python3 "$HERE/verify.py" paths "$APP" "$STAGE/before.private.json" > "$STAGE/compose-paths.txt"
mapfile -t FILES < "$STAGE/compose-paths.txt"
# Validate every ancestor of the frozen interpolation file, not just the basename.
python3 - "$HERE" "$OLD_RELEASE/$ENV_NAME" <<'PY'
import sys
sys.path.insert(0,sys.argv[1]);from verify import regular
regular(sys.argv[2])
PY
# Do not let caller shell variables override frozen --env-file interpolation.
# Explicit Docker config retains the already-verified default local context.
DOCKER_BIN=$(command -v docker)
COMPOSE=(env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$DOCKER_BIN" --config /root/.docker compose --project-name "max-travel-$APP" --project-directory "$LIVE" --env-file "$OLD_RELEASE/$ENV_NAME" --profile '*')
for file in "${FILES[@]}"; do COMPOSE+=(-f "$file"); done
"${COMPOSE[@]}" config --no-env-resolution --format json > "$STAGE/unresolved.private.json" 2> "$STAGE/config-errors.private.log"
"${COMPOSE[@]}" config --format json > "$STAGE/resolved.private.json" 2>> "$STAGE/config-errors.private.log"
python3 "$HERE/verify.py" config "$APP" "$STAGE/resolved.private.json" "$STAGE/unresolved.private.json" "$STAGE/before.private.json" "$STAGE/deployed-images.private.json" > "$STAGE/runtime-env-paths.txt"
# Retain the exact original dependency paths. Copies are evidence, NOT a replacement Compose stack.
{ printf '%s\n' "${FILES[@]}" "$OLD_RELEASE/$ENV_NAME" "/root/maxtravel-revamp-backup-9B5326/$APP-current-cutover-path.txt"; cat "$STAGE/runtime-env-paths.txt"; } | sort -u > "$STAGE/frozen-paths.txt"
while IFS= read -r file; do
 mkdir -p "$STAGE/preserved$(dirname "$file")"
 cp -- "$file" "$STAGE/preserved$file"
 cmp -- "$file" "$STAGE/preserved$file"
 sha256sum "$file" >> "$STAGE/frozen-originals.sha256"
done < "$STAGE/frozen-paths.txt"
docker image inspect "$OLD_IMAGE" > "$STAGE/rollback-image.private.json"
timeout --kill-after=30s 15m docker image save "$OLD_IMAGE" -o "$STAGE/rollback-image.tar"
sha256sum "$STAGE/rollback-image.tar" > "$STAGE/rollback-image.sha256"
# Isolated Git database only: no live checkout changes. Existing approved Git auth only.
git init --bare "$STAGE/git" > "$STAGE/git.private.log" 2>&1
git -C "$STAGE/git" remote add origin "https://github.com/alpesh15gb/$REPO.git"
GIT_TERMINAL_PROMPT=0 timeout --kill-after=10s 5m git -C "$STAGE/git" fetch --depth=64 origin main >> "$STAGE/git.private.log" 2>&1
[[ $(git -C "$STAGE/git" rev-parse FETCH_HEAD) == "$TARGET" ]] || fail 'Remote main moved; review and test the new pin first.'
[[ $(git -C "$STAGE/git" rev-parse "$TARGET^{tree}") == "$TREE" ]] || fail 'Pinned Git tree differs.'
git -C "$STAGE/git" merge-base --is-ancestor "$BASELINE" "$TARGET" || fail 'Deployed source not in fetched ancestry; do not guess or deepen automatically.'
SOURCE=$TARGET
[[ $APP != booking ]] || SOURCE="$TARGET:booking-platform"
git -C "$STAGE/git" ls-tree -r "$SOURCE" > "$STAGE/source-tree.txt"
python3 "$HERE/verify.py" source "$STAGE/source-tree.txt"
git -C "$STAGE/git" diff --name-status "$BASELINE" "$TARGET" > "$STAGE/reviewed-source-diff.txt"
git -C "$STAGE/git" archive --format=tar "$SOURCE" > "$STAGE/source.tar"
tar -xf "$STAGE/source.tar" -C "$STAGE/source"
# Preserve executable bits; allow non-root node/travel to read copied runtime scripts.
# Stage's parent remains 0700; no runtime secrets ever enter this source directory.
chmod -R a+rX "$STAGE/source"
printf '%s\n' "$TARGET" > "$STAGE/source-commit.txt"
printf '%s\n' "$TREE" > "$STAGE/source-tree-id.txt"
sha256sum "$STAGE/source.tar" > "$STAGE/source-archive.sha256"
CANDIDATE="max-travel-$APP:candidate-${TARGET:0:7}-$(basename "$STAGE" | tr '[:upper:]' '[:lower:]')"
printf 'Building %s only. Production services remain running.\n' "$APP"
# Optional caps are on the verified existing builder container, NOT invented build flags.
# The standard docker build path has no claimed CPU or memory cap.
# A timeout cancels the client; inspect builder activity before retrying if timeout occurs.
timeout --kill-after=30s 35m "${BUILD[@]}" --progress=plain \
 --label "org.opencontainers.image.revision=$TARGET" --label "org.opencontainers.image.source-tree=$TREE" \
 --iidfile "$STAGE/candidate-image-id.txt" --tag "$CANDIDATE" "$STAGE/source" > "$STAGE/build.private.log" 2>&1
NEW_IMAGE=$(cat "$STAGE/candidate-image-id.txt")
[[ $NEW_IMAGE =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'Invalid image ID.'
[[ $(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$NEW_IMAGE") == "$TARGET" ]] || fail 'Candidate revision mismatch.'
[[ $(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.source-tree"}}' "$NEW_IMAGE") == "$TREE" ]] || fail 'Candidate tree label mismatch.'
[[ $(docker image inspect -f '{{.Config.User}}' "$NEW_IMAGE") == "$(pin user)" ]] || fail 'Candidate runtime user mismatch.'
printf '%s\n' "$CANDIDATE" > "$STAGE/candidate-image-tag.txt"
docker image inspect "$NEW_IMAGE" > "$STAGE/candidate-image.private.json"
# Disposable isolated validation only: no entrypoint, real env, production mount, or network.
# Read files and resolve dependencies; NEVER import workers/app modules (they auto-run).
# Parent stage remains 0700. The candidate's own non-root USER is retained.
FILES_TO_READ='["package.json","next.config.mjs","prisma/schema.prisma","scripts/whatsapp-worker.mjs","scripts/reconcile-reporting.mjs",".next/BUILD_ID","/usr/local/bin/docker-entrypoint.sh"]'
MODULES_TO_RESOLVE='["next","@prisma/client"]'
if [[ $APP == booking ]]; then
 FILES_TO_READ='["package.json","server.js","scripts/standalone-server.mjs","scripts/migrate.mjs","scripts/provision-runtime-role.mjs","scripts/release-check.mjs","dist/booking-worker.mjs","dist/refund-worker.mjs","dist/maintenance-worker.mjs","dist/cancellation-worker.mjs","dist/crm-worker.mjs","dist/notification-worker.mjs",".next/BUILD_ID"]'
 MODULES_TO_RESOLVE='["next","pg","nodemailer","better-auth"]'
fi
timeout --kill-after=10s 60s docker run --rm --pull never --network none --read-only \
 --cap-drop ALL --security-opt no-new-privileges --memory 768m --cpus 1 --pids-limit 64 \
 --entrypoint node "$NEW_IMAGE" -e '
 const fs=require("node:fs");
 if(process.getuid()===0)throw Error("Candidate unexpectedly runs as root");
 for(const p of JSON.parse(process.argv[1]))fs.readFileSync(p);
 for(const p of JSON.parse(process.argv[2]))require.resolve(p);
 console.log(JSON.stringify({readability:"passed",uid:process.getuid(),buildId:fs.readFileSync(".next/BUILD_ID","utf8").trim()}));
 ' "$FILES_TO_READ" "$MODULES_TO_RESOLVE" > "$STAGE/non-root-readability.private.json" 2> "$STAGE/non-root-readability-errors.private.log"
sha256sum --check --status "$STAGE/frozen-originals.sha256" || fail 'Frozen dependencies changed during build.'
snapshot "$STAGE/after.private.json"
python3 "$HERE/verify.py" after "$STAGE/before.private.json" "$STAGE/after.private.json"
# Final success marker is emitted atomically ONLY after every preceding check passes.
python3 - "$STAGE" "$APP" "$TARGET" "$TREE" "$NEW_IMAGE" <<'PYVERIFIED'
import json,pathlib,sys,os,datetime
stage=pathlib.Path(sys.argv[1])
marker={'status':'verified','stage':str(stage),'app':sys.argv[2],'commit':sys.argv[3],
        'tree':sys.argv[4],'image':sys.argv[5],'verified_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
temporary=stage/'build-verified.json.tmp'
with temporary.open('x') as out:
 json.dump(marker,out,sort_keys=True);out.write('\n');out.flush();os.fsync(out.fileno())
os.replace(temporary,stage/'build-verified.json')
PYVERIFIED
printf '\nBUILD COMPLETE — NOT DEPLOYED\nApp: %s\nDirectory: %s\nSource: %s\nTree: %s\nCandidate: %s\n' "$APP" "$STAGE" "$TARGET" "$TREE" "$NEW_IMAGE"
printf 'Disposable network-isolated non-root readability check passed. No application/worker startup, migration, provider request, production service stop or cutover performed. Private rollback/config evidence retained.\nBoth images must finish before downtime. CRM receiver cutover precedes booking. A separately reviewed backup/restore and cutover plan is still required.\n'
