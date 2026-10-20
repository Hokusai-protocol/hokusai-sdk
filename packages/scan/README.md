# @hokusai/scan

The Hokusai Arbiter scanner: the **survival labeller** and the **candidate
feature extractor**, extracted from wavemill (HOK-2816) so all scanner work
lives in the Hokusai SDK. One core, three equivalent entry points that
produce byte-identical output for the same inputs:

- a **library** (`import { labelMergedPr, extractCandidateFeatures } from '@hokusai/scan'`)
- the **CLI**: `npx @hokusai/scan` → `hokusai-scan {label|extract|scan|report}`
- a one-shot **GitHub Action** (`packages/scan/action`, `workflow_dispatch`-friendly)

Wire formats stay in `@hokusai/core` (`candidate_features/v1`,
`arbiter_survival_label/v1`); this package owns execution only. It never
reads ambient state — no `gh` login sniffing, no origin-remote guessing, no
host config: every input is explicit, and `src/boundary.test.ts` enforces it
mechanically.

## Install

```sh
pnpm add @hokusai/scan
npm install @hokusai/scan
```

## Contract

```ts
import { SCAN_CONTRACT } from '@hokusai/scan';
// {
//   candidateFeatures: 'candidate_features/v1',
//   labels: 'arbiter_survival_label/v1',
//   labellerVersion: '1.0.0',
//   normalizationVersion: '1.0.0',
// }
```

Every label row carries `labeller_version` / `normalization_version` in its
reproducibility envelope. Changing labeller behaviour requires bumping those
and re-capturing the golden fixtures (`scripts/capture-scan-golden.mjs`) in
the same PR — see `docs/versioning-policy.md`.

## CLI

```
hokusai-scan label   --repo <path> --integration-branch <name>
                     [--github-repo <owner/name>] [--pr-url <url>]
                     [--horizons 14,30,60] [--max-prs <n>] [--as-of <iso>]
                     [--no-links] [--offline] [--token-env <NAME>]
                     [--out <path|->] [--debug]
hokusai-scan extract --repo <path> --pr <n> [--base-ref <ref>]
                     [--config-path <path>] [--offline] [--token-env <NAME>]
                     [--out <path|->] [--debug]
hokusai-scan scan    --repo <path> --integration-branch <name> --pr <n>
                     [all common flags]
```

- `label` walks the integration branch's first-parent history (never `main`
  — the v1.0.0 contract rejects it), emits one JSONL row per merged PR per
  horizon, PRs oldest-first. A per-repo/per-horizon base-rate summary goes to
  stderr as an `info:` line.
- `extract` emits one `candidate_features/v1` JSON object for the checkout's
  HEAD as PR `<n>`, keys sorted canonically.
- `scan` labels one PR and extracts its features, emitting a combined object
  `{ scan_contract, candidate_features, survival_labels }`.
- `report` scans a public GitHub repo URL or `owner/name`; `--repo` selects an
  existing local checkout for private or offline runs. It enumerates first-parent
  merges, enriches and labels them, then emits a validated `arbiter_report/v1`
  envelope. If the default branch is `main`, a durable promotion branch is
  detected from recent pull requests; otherwise pass `--integration-branch`.
  S2 v1.1.0 walks `main` only with `--integration-mode direct`, for repos whose
  PRs merge straight into it (most OSS repos). Rows record the mode in
  `envelope.integration_mode`; without the flag `main` is still rejected.
- Report `--state-dir` opts into local incremental caching. The CLI default is
  under the checkout's `.git/hokusai-scan/`; the Action defaults to no state.
  The cache stores only merge keys and derived report fields.
- `--contribute` validates and submits a report using the `HOKUSAI_API_KEY`
  value named by `--api-key-env`; the endpoint is experimental and pending.
  `--contribute --dry-run` writes the exact request body without posting.

Conventions:

- **stdout is data, stderr is diagnostics** — every stderr line is prefixed
  `info:`, `warn:`, or `error:`. `--out <path>` writes the data to a file and
  leaves stdout empty; `--out -` (default) streams it.
- **Tokens are never argv.** `--token-env NAME` names the environment
  variable to read (default `GITHUB_TOKEN`); the value is redacted from all
  diagnostics.
- `--as-of <iso>` pins "now" (horizon cutoffs and `computed_at`) for
  reproducible runs; goldens and replays always pin it.
- `--offline` skips every network access; GitHub-derived evidence degrades
  to explicit `null`s / absent link evidence, never to guesses.
- `--github-repo` is required context for label runs; when omitted the CLI
  shell (not the core) detects it from the `origin` remote and says so.

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | success |
| 1 | unexpected internal error (`--debug` dumps the stack to stderr) |
| 2 | invalid input: missing/malformed flags, missing repo, not a git work tree, shallow clone, `main` as integration branch |
| 3 | upstream GitHub failure: auth, not found, rate limit, timeout |

## GitHub Action

`packages/scan/action` supports `report` mode in addition to label/extract/scan and is a `node20` Action running the committed bundle at
`action/dist/index.js` (rebuilt and drift-checked in CI; the runner installs
nothing). All inputs are explicit — see `action/action.yml`, and
`action/example-workflow.yml` for a `workflow_dispatch` caller. Requires
`actions/checkout` with `fetch-depth: 0`; a shallow clone fails fast with
that exact hint. Outputs: `output-path`, `contract-version`, `row-count`.

## Committed static-analysis config

The extractor's static signals (`type_errors`, `lint_errors`, `build_ok`)
honour a committed config file in the **target** repo:

```jsonc
// <repo>/.hokusai-scan.json
{
  "staticAnalysis": {
    "typecheckCommand": "npx tsc --noEmit -p tsconfig.json", // tsc-format output
    "lintCommand": "npx eslint . --format json",             // eslint JSON on stdout
    "buildCommand": "pnpm build",
    "timeoutSeconds": { "typecheck": 180, "lint": 120, "build": 300 }
  }
}
```

The legacy filename `.wavemill-config.json` is read as a fallback (with a
`warn:` diagnostic) until target repos rename; gitignored `*.local.json`
overlays are never merged — bare-checkout parity requires committed files
only. The complexity metric id stays `wavemill-cyclomatic/v1`: it is embedded
in trained models downstream, so it is a trained-model contract, not
scanner branding.

## The identical-output guarantee

`fixtures/arbiter/scan/` holds goldens captured from the pre-extraction
wavemill code at a pinned commit. CI proves, byte for byte:

1. library calls reproduce the goldens (`src/golden.test.ts`);
2. the built CLI reproduces them in a fully scrubbed environment — fresh
   HOME, no git config, minimal PATH, no `GH_*`/`GITHUB_*` variables, planted
   hostile legacy config (`src/cli.test.ts`);
3. the Action bundle reproduces the CLI's bytes.

If any leg diverges, something environment-specific leaked into the core and
the build fails. Wavemill's own adapter parity test (the fourth leg) lives in
the wavemill repo — see
`docs/arbiter/wavemill-migration-contract.md`.

## Publishing

Released with the fixed `@hokusai/*` version group by the tag-triggered
release workflow; the npm tarball carries `dist/`, `action/` (manifest +
bundle), and this README only.

## Arbiter report building

The library exports the `arbiter_report/v1` report pipeline primitives:

- `runReportScan(target, deps, options)` enumerates first-parent merges, collects GitHub metadata, attributes PRs, extracts features in a detached checkout, and labels horizons. It returns a report draft.
- `buildAggregates` and `buildCoverage` derive descriptive sections. `buildReportDraft` assembles the frozen envelope and `emitReport` applies the core suppression policy, validates the final report, and serializes deterministic JSON.
- `wilsonInterval`, `katzLogRatioInterval`, and nearest-rank quartile helpers are available for consumers that need the same aggregate definitions.
- `readScanState` and `writeScanState` store derived-only cache rows locally. The caller supplies the state directory; cache headers invalidate on scanner, labeller, normalization, config, integration-branch, or ancestry changes. Raw PR text, authors, paths, and messages are not written to the cache.
- `buildContributionPayload` validates scan origin and forbidden keys. `submitReport` is experimental because the report endpoint is pending; it requires an explicit transport, base URL, and API key.

The frozen `arbiter_report/v1` wire contract and fixture provenance are documented in [`docs/arbiter/report-contract.md`](../../docs/arbiter/report-contract.md). Report orchestration is currently exposed as a library API; the existing `label`, `extract`, and `scan` CLI commands keep their current behavior.
