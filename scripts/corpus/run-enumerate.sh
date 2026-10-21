#!/usr/bin/env bash
# Enumerate cohort repos into the local corpus cache, N at a time (HOK-3265).
#
# Usage: scripts/corpus/run-enumerate.sh <cache-dir> <parallelism> owner/name [owner/name ...]
# Per repo: <cache-dir>/logs/<owner>_<name>.{out,err}; one "<repo> exit=<code>" line on stdout.
# Requires `pnpm --filter @hokusai/scan build` and `gh` auth. Safe to re-run: GraphQL slices are cached.
set -uo pipefail

cache_dir=$1
parallelism=$2
shift 2
root=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$cache_dir/logs"

run_one() {
  local repo=$1 log
  log="$cache_dir/logs/${repo//\//_}"
  node "$root/packages/scan/dist/cli.js" corpus-enumerate \
    --manifest "$root/fixtures/arbiter/corpus/hok-3022-cohort.json" \
    --cache-dir "$cache_dir" --repo "$repo" >"$log.out" 2>"$log.err"
  echo "$repo exit=$?"
}

for repo in "$@"; do
  while [ "$(jobs -rp | wc -l)" -ge "$parallelism" ]; do sleep 5; done
  run_one "$repo" &
done
wait
