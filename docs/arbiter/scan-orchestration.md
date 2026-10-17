# Scan report orchestration

`hokusai-scan report owner/repo` produces an `arbiter_report/v1` payload from
merged pull requests. It enumerates the selected integration branch, derives
agent/model attribution, extracts candidate features, labels survival at the
requested horizons, and calculates locally suppressed aggregate cells.

The default window is 180 days and 500 pull requests. A repository-local
checkpoint is keyed by the scan configuration and last processed merge SHA.
Compatible reruns process only new merges, while changed configuration,
rewritten integration history, or malformed checkpoint rows trigger a full
rescan. Checkpoints and emitted reports contain derived data only: they never
contain PR text, diffs, paths, commit messages, or raw identities.

Cells below the report policy's eligible-PR floor are suppressed before
emission and retain their explicit suppression reason in the payload. The
optional `--contribute` flow sends this already-suppressed, derived report;
`--dry-run` prints its contribution payload without a network request.
