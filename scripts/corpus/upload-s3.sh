#!/usr/bin/env bash
# Upload derived corpus outputs to S3 (HOK-3266). Allowlist only: prs.jsonl
# (raw titles and bodies) and the clones never leave the machine.
#
# Usage: scripts/corpus/upload-s3.sh <cache-dir> <s3-prefix> <as-of YYYY-MM-DD> owner/name [owner/name ...]
#   e.g. scripts/corpus/upload-s3.sh ~/hokusai-data/arbiter-corpus \
#          s3://hokusai-pipeline-data-development/arbiter-corpus/hok-3022 2026-10-20 django/django
#
# Layout under <s3-prefix>:
#   cohort.json                                   cohort manifest
#   enumeration.json                              enumeration stats, all repos
#   as-of=<date>/<owner>__<name>/s2.jsonl.gz      S2 v1.1.0 rows
#   as-of=<date>/<owner>__<name>/s2.summary.json  counts, base rates, timing
#   as-of=<date>/<owner>__<name>/enumeration.json
# Each repo's rows are schema-validated first; a repo that fails is skipped.
# Requires AWS credentials for the bucket. Safe to re-run (objects are replaced; the bucket is versioned).
set -euo pipefail

cache_dir=$1
prefix=${2%/}
as_of=$3
shift 3
root=$(cd "$(dirname "$0")/../.." && pwd)
[[ $as_of =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "error: as-of must be YYYY-MM-DD" >&2; exit 2; }

cp_s3() { aws s3 cp --only-show-errors "$@"; }
cp_s3 "$root/fixtures/arbiter/corpus/hok-3022-cohort.json" "$prefix/cohort.json"
cp_s3 "$root/fixtures/arbiter/corpus/hok-3022-enumeration.json" "$prefix/enumeration.json"
cp_s3 --content-type text/markdown - "$prefix/README.md" <<'README'
# Arbiter OSS survival-label corpus (HOK-3022)

S2 survival labels (schema v1.1.0, `integration_mode: direct`) for merged PRs on the
default branch of the 18-repo cohort in `cohort.json`, merged 2024-07-01 to 2026-08-01.

- `cohort.json`: cohort manifest (repos, selection thresholds, change log)
- `enumeration.json`: per-repo enumeration stats (PR counts, recall estimates)
- `as-of=<date>/<owner>__<name>/s2.jsonl.gz`: one row per PR x horizon (14/30/60 days), labelled
  against history up to `<date>`. Gzip (concatenated members); read with `zcat` or any gzip reader.
- `as-of=<date>/<owner>__<name>/s2.summary.json`: row counts, base rates, failures, timing

Rows carry no PR titles, bodies or diffs. Schema: `packages/core/schemas/arbiter-survival-label.schema.json`
in hokusai-sdk. Produced by `hokusai-scan corpus-enumerate` / `corpus-label`; uploaded by
`scripts/corpus/upload-s3.sh`.
README

status=0
for repo in "$@"; do
  dir="$cache_dir/${repo//\//__}"
  dest="$prefix/as-of=$as_of/${repo//\//__}"
  if [ ! -f "$dir/s2.jsonl.gz" ] || [ ! -f "$dir/s2.summary.json" ]; then
    echo "$repo skipped: not labelled (no s2.jsonl.gz)"
    status=1
    continue
  fi
  if [ "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).as_of.slice(0,10))' "$dir/s2.summary.json")" != "$as_of" ]; then
    echo "$repo skipped: labelled at a different as-of"
    status=1
    continue
  fi
  if ! node "$root/scripts/corpus/validate-s2.mjs" "$dir/s2.jsonl.gz" >/dev/null; then
    echo "$repo skipped: schema validation failed"
    status=1
    continue
  fi
  cp_s3 --content-type application/gzip "$dir/s2.jsonl.gz" "$dest/s2.jsonl.gz"
  cp_s3 "$dir/s2.summary.json" "$dest/s2.summary.json"
  cp_s3 "$dir/enumeration.json" "$dest/enumeration.json"
  echo "$repo uploaded to $dest/"
done
exit $status
