#!/usr/bin/env bash
# Run a corpus command over cohort repos, N at a time (HOK-3265, HOK-3266).
#
# Usage: [CORPUS_COMMAND=corpus-label] [CORPUS_ARGS="--as-of <iso>"] \
#        scripts/corpus/run-enumerate.sh <cache-dir> <parallelism> owner/name [owner/name ...]
# CORPUS_COMMAND defaults to corpus-enumerate. Per repo: <cache-dir>/logs/<owner>_<name>[.label].{out,err};
# one "<repo> exit=<code>" line on stdout.
# Requires `pnpm --filter @hokusai/scan build` and `gh` auth. Safe to re-run: GraphQL slices are cached.
set -uo pipefail

cache_dir=$1
parallelism=$2
shift 2
root=$(cd "$(dirname "$0")/../.." && pwd)
command=${CORPUS_COMMAND:-corpus-enumerate}
suffix=""
[ "$command" = corpus-label ] && suffix=".label"
mkdir -p "$cache_dir/logs"

run_one() {
  local repo=$1 log
  log="$cache_dir/logs/${repo//\//_}$suffix"
  # shellcheck disable=SC2086 # CORPUS_ARGS is intentionally word-split
  node "$root/packages/scan/dist/cli.js" "$command" ${CORPUS_ARGS:-} \
    --manifest "$root/fixtures/arbiter/corpus/hok-3022-cohort.json" \
    --cache-dir "$cache_dir" --repo "$repo" >"$log.out" 2>"$log.err"
  echo "$repo exit=$?"
}

for repo in "$@"; do
  while [ "$(jobs -rp | wc -l)" -ge "$parallelism" ]; do sleep 5; done
  run_one "$repo" &
done
wait
