#!/usr/bin/env bash
# DRAFT: separately reviewed cutover phases; never source from untrusted directories.
set -Eeuo pipefail
umask 077
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
VERIFY_PY="$HERE/../verify.py"
fail() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
pin() { python3 "$VERIFY_PY" pin "$APP_KIND" "$1"; }
snapshot_all() {
 local ids
 ids=$(docker ps -aq --no-trunc)
 [[ -n $ids ]] || fail 'Empty container inventory.'
 # Preserve unfiltered private evidence; Docker ps negated-label filters are not portable.
 docker inspect $ids > "$1.all.private.json"
 if [[ -n ${RETAINED_FAILED_HELPER_RECORD:-} ]]; then python3 "$HERE/phase_verify.py" retained-helper "$RETAINED_FAILED_HELPER_RECORD" "$1.all.private.json"; fi
 python3 "$HERE/phase_verify.py" snapshot-filter "$1.all.private.json" > "$1"
}
protected_check() { python3 "$HERE/phase_verify.py" protected "$1" "$2" "${3:-}"; }
protected_build_check() { python3 "$HERE/phase_verify.py" protected-build "$1" "$2" "${3:-}" "${4:-}" "${5:-}" "${6:-}"; }
init() {
 python3 "$VERIFY_PY" candidate-execution-gate
 APP_KIND=$1
 POINTER="/root/maxtravel-revamp-backup-9B5326/$APP_KIND-current-cutover-path.txt"
 [[ ${APPROVED_CUTOVER:-} == 'reviewed backup and scoped cutover' ]] || fail 'Independent cutover review acknowledgement required.'
 [[ $(id -u) == 0 && $(hostname) == Apex ]] || fail 'Intended root host check failed.'
 for tool in docker git python3 sha256sum timeout flock curl; do command -v "$tool" >/dev/null || fail "Missing $tool"; done
 [[ -z ${DOCKER_HOST:-} && -z ${DOCKER_CONTEXT:-} && -z ${DOCKER_CONFIG:-} ]] || fail 'Unexpected Docker endpoint override.'
 [[ $(docker context show) == default && $(docker context inspect default --format '{{.Endpoints.docker.Host}}') == unix:///var/run/docker.sock ]] || fail 'Local default Docker socket required.'
 exec 9>/root/maxtravel-build-only.lock; flock -n 9 || fail 'Build or cutover phase already running.'
 : "${BUILD:?Exact successful build-stage directory required}" "${PEER_BUILD:?Exact other successful build-stage directory required}"
 TARGET=$(pin commit); TREE=$(pin tree); BASELINE=$(pin baseline); OLD_IMAGE=$(pin image); OLD_RELEASE=$(pin release); OLD_POINTER_RELEASE=$(pin pointer_release); LIVE=$(pin live); ENV_NAME=$(pin env)
 python3 "$HERE/phase_verify.py" stage "$APP_KIND" "$BUILD"
 local peer=booking; [[ $APP_KIND != booking ]] || peer=crm
 python3 "$HERE/phase_verify.py" stage "$peer" "$PEER_BUILD"
 for stage in "$BUILD" "$PEER_BUILD"; do
   sha256sum --check --status "$stage/source-archive.sha256"
   sha256sum --check --status "$stage/rollback-image.sha256"
   image=$(cat "$stage/candidate-image-id.txt")
   [[ $(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image") == "$(cat "$stage/source-commit.txt")" ]] || fail 'Candidate source identity differs.'
   [[ $(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.source-tree"}}' "$image") == "$(cat "$stage/source-tree-id.txt")" ]] || fail 'Candidate tree differs.'
 done
 sha256sum --check --status "$BUILD/frozen-originals.sha256" || fail 'Frozen dependencies or pointer changed.'
 CANDIDATE=$(cat "$BUILD/candidate-image-id.txt")
 docker image inspect "$OLD_IMAGE" >/dev/null
 mapfile -t FILES < "$BUILD/compose-paths.txt"
 EXPECTED_FILES=$(IFS=,; echo "${FILES[*]}")
 COMPOSE=(env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin "$(command -v docker)" --config /root/.docker compose --project-name "max-travel-$APP_KIND" --project-directory "$LIVE" --env-file "$OLD_RELEASE/$ENV_NAME" --profile '*')
 for file in "${FILES[@]}"; do COMPOSE+=(-f "$file"); done
 # Exact baseline-to-target operational policy, from the reviewed connector evidence.
 python3 "$HERE/phase_verify.py" source "$APP_KIND" "$BUILD"
 PG_IMAGE=$(python3 "$HERE/phase_verify.py" image "$BUILD/before.private.json" booking postgres)
 if [[ $APP_KIND == booking ]]; then
   : "${CRM_RELEASE:?Exact completed CRM receiver release required}"
   python3 "$HERE/phase_verify.py" crm-release "$CRM_RELEASE" "$PEER_BUILD"
   CRM_IMAGE=$(cat "$CRM_RELEASE/deployed-image.txt")
 fi
}
# Failure-only containment: never old images, dependencies, or a database restore.
# Labels+immutable image resolve candidates even when compose failed before returning an ID.
quiesce_candidate() {
 local service=$1 id image
 while IFS= read -r id; do
  [[ -n $id ]] || continue
  image=$(docker inspect -f '{{.Image}}' "$id") || continue
  [[ $image == "$CANDIDATE" ]] || continue
  docker inspect "$id" > "${RELEASE:-$BUILD}/failed-$service-$id.private.json" 2>/dev/null || true
  docker update --restart=no "$id" >/dev/null 2>&1 || printf 'WARNING: could not disable candidate restart; inspect privately.\n' >&2
  timeout 300s docker stop --timeout 260 "$id" >/dev/null 2>&1 || printf 'WARNING: candidate stop failed; inspect privately.\n' >&2
 done < <(docker ps -aq --no-trunc --filter "label=com.docker.compose.project=max-travel-$APP_KIND" --filter "label=com.docker.compose.service=$service")
}
