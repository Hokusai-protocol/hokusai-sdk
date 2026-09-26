# Shadow-mode report golden fixtures (HOK-2820)

Synthetic accumulated scan output for the `hokusai-scan report` aggregator:
12 PRs across two repos (`golden/alpha`, `golden/bravo`), mixed horizons and
reason codes, exercising every intake path (label JSONL, standalone
`…pr-<n>.json` feature blobs, combined `scan` objects) plus malformed and
unattributable inputs that must degrade to diagnostics.

- **Pinned clock (`--as-of`):** `2026-09-26T00:00:00Z` (see `inputs.json`)
- **Reporting horizon:** 30 days (the default)

| Path | Contents |
| --- | --- |
| `inputs/` | The aggregator's input tree, exactly as a report run would see downloaded artifacts |
| `inputs/alpha-nightly/` | Two nightly label JSONL files; PR 101 appears in both so latest-`computed_at` dedupe is exercised |
| `inputs/alpha-pr/`, `inputs/bravo-pr/` | Standalone candidate-feature blobs joined by the `pr-<n>` filename token |
| `inputs/bravo-scan/` | Combined `scan` objects (features + labels in one document) |
| `inputs/orphan/`, `inputs/broken/` | Unattributable features and malformed JSONL — diagnostics, never report rows |
| `expected-report.md` | Golden markdown (`--format markdown`, byte-stable) |
| `expected-report.json` | Golden `shadow_repo_report/v1` (`--format json`, byte-stable) |

Designed tallies: `golden/alpha` has 5 reworked PRs (precision quoted:
TP 2, FP 1); `golden/bravo` has 1 (precision suppressed by the 5-reworked
floor). Re-capture only in a PR that intentionally changes the aggregator's
output contract:

```sh
node packages/scan/dist/cli.js report --inputs fixtures/arbiter/shadow-report/inputs \
  --as-of 2026-09-26T00:00:00Z --out fixtures/arbiter/shadow-report/expected-report.md
node packages/scan/dist/cli.js report --inputs fixtures/arbiter/shadow-report/inputs \
  --as-of 2026-09-26T00:00:00Z --format json --out fixtures/arbiter/shadow-report/expected-report.json
```
