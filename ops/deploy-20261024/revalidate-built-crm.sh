#!/usr/bin/env bash
# Exact failed-final-guard stage only. NO rebuild, deploy, DB/provider call or service stop.
set -Eeuo pipefail
umask 077
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
STAGE=/root/crm-build-c27b8e3-p3drk2
fail() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
[[ $# == 0 ]] || fail 'This recovery accepts no alternate stage.'
[[ ${APPROVED_BUILD_REVALIDATION:-} == 'reviewed mounts order only; no rebuild' ]] || fail 'Reviewed build-revalidation acknowledgement required.'
[[ $(id -u) == 0 && $(hostname) == Apex ]] || fail 'Expected root on Apex.'
[[ -z ${DOCKER_HOST:-} && -z ${DOCKER_CONTEXT:-} && -z ${DOCKER_CONFIG:-} ]] || fail 'Docker endpoint override present.'
for tool in docker git python3 sha256sum timeout flock cmp; do command -v "$tool" >/dev/null || fail "Missing $tool"; done
[[ $(docker context show) == default && $(docker context inspect default --format '{{.Endpoints.docker.Host}}') == unix:///var/run/docker.sock ]] || fail 'Expected default local Docker socket.'
exec 9>/root/maxtravel-build-only.lock
flock -n 9 || fail 'Another build/preparation is active.'
# Reject wrong/symlinked stage and existing success BEFORE creating any new evidence.
python3 - "$HERE" "$STAGE" <<'PYSTAGE'
import sys,pathlib
sys.path.insert(0,sys.argv[1]);from revalidate_stage import STAGE;from verify import require
p=pathlib.Path(sys.argv[2]);require(p==STAGE and p.is_dir() and not any(x.is_symlink() for x in [p,*p.parents]),'Invalid exact recovery stage.')
require(not (p/'build-verified.json').exists() and not (p/'build-verified.json').is_symlink(),'Already verified or unexpected marker; do not repeat recovery.')
PYSTAGE
EVIDENCE=$(mktemp -d "$STAGE/revalidation-XXXXXX")
trap 's=$?; if ((s)); then printf "STOPPED; no success recorded. Original build evidence unchanged; private recovery evidence: %s\n" "$EVIDENCE" >&2; fi' EXIT
# This verifies every original checksum, preserved dependency, exact source/archive,
# old image and original readability proof. It does not infer success from Mounts alone.
python3 "$HERE/revalidate_stage.py" "$STAGE" > "$EVIDENCE/candidate-id.txt" 2> "$EVIDENCE/artifact-errors.private.log"
NEW_IMAGE=$(cat "$EVIDENCE/candidate-id.txt")
sha256sum "$STAGE/before.private.json" "$STAGE/after.private.json" > "$EVIDENCE/original-snapshots.sha256"
pin() { python3 "$HERE/verify.py" pin crm "$1"; }
TARGET=$(pin commit); TREE=$(pin tree); OLD_RELEASE=$(pin release); LIVE=$(pin live); OLD_IMAGE=$(pin image)
# Current GitHub main must still equal the tested source. Existing auth only; no fetch/mutation.
GIT_TERMINAL_PROMPT=0 timeout --kill-after=10s 2m git ls-remote https://github.com/alpesh15gb/MaxTravel.git refs/heads/main > "$EVIDENCE/remote-main.txt" 2> "$EVIDENCE/git-errors.private.log"
[[ $(wc -l < "$EVIDENCE/remote-main.txt") == 1 && $(cut -f1 "$EVIDENCE/remote-main.txt") == "$TARGET" ]] || fail 'Remote main moved or cannot be established.'
python3 "$HERE/verify.py" source "$STAGE/source-tree.txt"
python3 "$HERE/verify.py" runtime "$STAGE/before.private.json"
python3 "$HERE/verify.py" runtime "$STAGE/after.private.json"
python3 "$HERE/verify.py" after "$STAGE/before.private.json" "$STAGE/after.private.json"
snapshot() {
 docker ps -aq --no-trunc > "$EVIDENCE/container-ids.txt"
 mapfile -t IDS < "$EVIDENCE/container-ids.txt"
 ((${#IDS[@]})) || fail 'No containers found.'
 docker inspect "${IDS[@]}" > "$1"
}
snapshot "$EVIDENCE/current-before.private.json"
python3 "$HERE/verify.py" runtime "$EVIDENCE/current-before.private.json"
python3 "$HERE/verify.py" after "$STAGE/before.private.json" "$EVIDENCE/current-before.private.json"
python3 "$HERE/verify.py" paths crm "$EVIDENCE/current-before.private.json" > "$EVIDENCE/compose-paths.txt"
cmp -- "$STAGE/compose-paths.txt" "$EVIDENCE/compose-paths.txt" || fail 'Operative Compose path sequence changed.'
python3 - "$HERE" "$EVIDENCE/current-before.private.json" <<'PYIMAGES' > "$EVIDENCE/image-ids.txt"
import sys
sys.path.insert(0,sys.argv[1]);from verify import runtime,read
print('\n'.join(sorted({r['Image'] for r in runtime(read(sys.argv[2])).values()})))
PYIMAGES
mapfile -t IMAGE_IDS < "$EVIDENCE/image-ids.txt"
docker image inspect "${IMAGE_IDS[@]}" > "$EVIDENCE/deployed-images.private.json"
mapfile -t FILES < "$EVIDENCE/compose-paths.txt"
DOCKER_BIN=$(command -v docker)
COMPOSE=(env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$DOCKER_BIN" --config /root/.docker compose --project-name max-travel-crm --project-directory "$LIVE" --env-file "$OLD_RELEASE/crm.env" --profile '*')
for file in "${FILES[@]}"; do COMPOSE+=(-f "$file"); done
"${COMPOSE[@]}" config --no-env-resolution --format json > "$EVIDENCE/unresolved.private.json" 2> "$EVIDENCE/config-errors.private.log"
"${COMPOSE[@]}" config --format json > "$EVIDENCE/resolved.private.json" 2>> "$EVIDENCE/config-errors.private.log"
python3 "$HERE/verify.py" config crm "$EVIDENCE/resolved.private.json" "$EVIDENCE/unresolved.private.json" "$EVIDENCE/current-before.private.json" "$EVIDENCE/deployed-images.private.json" > "$EVIDENCE/runtime-env-paths.txt"
cmp -- "$STAGE/runtime-env-paths.txt" "$EVIDENCE/runtime-env-paths.txt" || fail 'Frozen env dependency paths changed.'
python3 - "$STAGE" "$EVIDENCE" <<'PYCONFIG'
import json,pathlib,sys
old,new=map(pathlib.Path,sys.argv[1:])
for name in ('resolved.private.json','unresolved.private.json'):
 if json.loads((old/name).read_text())!=json.loads((new/name).read_text()):raise SystemExit('STOP: Rendered frozen configuration changed.')
PYCONFIG
docker image inspect "$NEW_IMAGE" > "$EVIDENCE/candidate-image.private.json"
CANDIDATE=$(cat "$STAGE/candidate-image-tag.txt")
[[ $(docker image inspect -f '{{.Id}}' "$CANDIDATE") == "$NEW_IMAGE" ]] || fail 'Candidate tag no longer maps to original image.'
python3 - "$STAGE" "$EVIDENCE" "$NEW_IMAGE" "$TARGET" "$TREE" <<'PYIMAGE'
import json,pathlib,sys
old,new=map(pathlib.Path,sys.argv[1:3]);a=json.loads((old/'candidate-image.private.json').read_text());b=json.loads((new/'candidate-image.private.json').read_text())
if len(b)!=1 or b[0]['Id']!=sys.argv[3] or a[0]['Config']!=b[0]['Config'] or a[0]['RootFS']!=b[0]['RootFS']:raise SystemExit('STOP: Candidate image proof changed.')
c=b[0]['Config'];labels=c.get('Labels') or {}
if c.get('User')!='node' or labels.get('org.opencontainers.image.revision')!=sys.argv[4] or labels.get('org.opencontainers.image.source-tree')!=sys.argv[5]:raise SystemExit('STOP: Candidate labels/user mismatch.')
PYIMAGE
# Disposable non-root file reads/resolution only; no app/worker import, network or live env/mount.
timeout --kill-after=10s 60s docker run --rm --pull never --network none --read-only \
 --cap-drop ALL --security-opt no-new-privileges --memory 768m --cpus 1 --pids-limit 64 \
 --entrypoint node "$NEW_IMAGE" -e '
 const fs=require("node:fs");if(process.getuid()!==1000)throw Error("Expected node UID 1000");
 for(const p of ["package.json","next.config.mjs","prisma/schema.prisma","scripts/whatsapp-worker.mjs","scripts/reconcile-reporting.mjs",".next/BUILD_ID","/usr/local/bin/docker-entrypoint.sh"])fs.readFileSync(p);
 for(const p of ["next","@prisma/client"])require.resolve(p);
 console.log(JSON.stringify({readability:"passed",uid:process.getuid(),buildId:fs.readFileSync(".next/BUILD_ID","utf8").trim()}));
 ' > "$EVIDENCE/non-root-readability.private.json" 2> "$EVIDENCE/readability-errors.private.log"
python3 - "$STAGE" "$EVIDENCE" <<'PYREAD'
import json,pathlib,sys
old,new=map(pathlib.Path,sys.argv[1:]);a=json.loads((old/'non-root-readability.private.json').read_text());b=json.loads((new/'non-root-readability.private.json').read_text())
if a!=b or b.get('uid')!=1000 or b.get('readability')!='passed':raise SystemExit('STOP: Candidate readability/build ID differs.')
PYREAD
# Repeat all original artifact proofs after the disposable check; never overwrite old evidence.
python3 "$HERE/revalidate_stage.py" "$STAGE" > "$EVIDENCE/final-artifact-id.txt" 2> "$EVIDENCE/final-artifact-errors.private.log"
cmp -- "$EVIDENCE/candidate-id.txt" "$EVIDENCE/final-artifact-id.txt"
snapshot "$EVIDENCE/current-after.private.json"
python3 "$HERE/verify.py" runtime "$EVIDENCE/current-after.private.json"
python3 "$HERE/verify.py" after "$STAGE/before.private.json" "$EVIDENCE/current-after.private.json"
python3 "$HERE/verify.py" after "$EVIDENCE/current-before.private.json" "$EVIDENCE/current-after.private.json"
sha256sum --check --status "$EVIDENCE/original-snapshots.sha256" || fail 'Original before/after evidence changed during revalidation.'
# Exact final marker contract consumed by future phase validation; original stage preserved.
python3 - "$STAGE" "$TARGET" "$TREE" "$NEW_IMAGE" <<'PYVERIFIED'
import datetime,json,os,pathlib,sys
stage=pathlib.Path(sys.argv[1]);destination=stage/'build-verified.json'
if destination.exists() or destination.is_symlink():raise SystemExit('STOP: Success marker unexpectedly exists.')
marker={'status':'verified','stage':str(stage),'app':'crm','commit':sys.argv[2],'tree':sys.argv[3],'image':sys.argv[4],'verified_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
temporary=stage/'build-verified.json.tmp'
with temporary.open('x') as out:
 json.dump(marker,out,sort_keys=True);out.write('\n');out.flush();os.fsync(out.fileno())
os.replace(temporary,destination)
PYVERIFIED
printf '\nBUILD VERIFIED — NOT DEPLOYED; existing image reused, no rebuild.\nDirectory: %s\nSource: %s\nTree: %s\nCandidate: %s\nPrivate revalidation evidence: %s\n' "$STAGE" "$TARGET" "$TREE" "$NEW_IMAGE" "$EVIDENCE"
printf 'Original before/after evidence retained. Production services untouched. Booking build and separately reviewed backup/cutover remain pending.\n'
