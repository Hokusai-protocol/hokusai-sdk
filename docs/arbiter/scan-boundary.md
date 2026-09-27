# The Scan Boundary

A two-page reader's guide to where scanner code lives and why, so the
boundary decided in Arbiter R1 and enforced since HOK-2816 does not get
re-invented. As of S4, **all scanner work lives in this repository.**

## The rule

- **`@hokusai/core` owns wire formats.** `candidate_features/v1` and
  `arbiter_survival_label/v1` — types, validators, JSON Schemas, canonical
  hashing, fixtures. Contract-only: no git, no network, no filesystem beyond
  what a schema needs. Four consumers read these (SDK, wavemill, the data
  pipeline, the website); none of them should drag in execution machinery to
  read a type.
- **`@hokusai/scan` owns execution.** The survival labeller, the candidate
  feature extractor, their git/gh shells, the CLI, and the GitHub Action.
  Scan depends on core; core never depends on scan. Adapters are invisible
  to scan and vice versa.
- **Callers own their joins.** Wavemill's `evals.jsonl` row assembly — the
  pairing of (survival label × candidate features × task descriptor ×
  outcome) — is wavemill-specific and stays in wavemill as a thin adapter
  over this package. Any other harness writes its own thin join the same
  way.

## Explicit inputs only

The scanner runs on machines we do not control (an Action on someone else's
CI runner, a laptop with no wavemill state). Everything the pre-extraction
code inherited from its home environment is therefore a typed input:

| Was implicit | Is now |
| --- | --- |
| ambient `gh` auth | `--token-env NAME` / Action `token` input, surfaced as an env var, never argv |
| `git remote get-url origin` owner/repo sniffing | `--github-repo owner/name` (CLI-shell fallback detection stays in the shell, with an `info:` line) |
| wall clock | `--as-of <iso>` / injectable `deps.now` |
| `.wavemill-config.json` in the target repo | `.hokusai-scan.json` (legacy name still read, with a `warn:`) |
| `process.cwd()` defaults | `--repo <path>` is always explicit |

Two guards keep it that way:

- `packages/scan/src/boundary.test.ts` — the core modules must not contain
  `process.env`, `process.cwd`, homedir/user probing, or references to the
  pre-extraction home beyond two frozen literals (the legacy config filename
  and the `wavemill-cyclomatic/v1` metric id, which is a trained-model
  contract).
- `scripts/core-boundaries.mjs` — core cannot import scan or adapters;
  scan cannot import adapters. Runs in CI as `pnpm check:boundaries`.

When the boundary test fires, the fix is to add the leaked dependency to the
typed inputs (`inputs.ts`, `SurvivalLabellerDeps`, `StaticFeaturesOptions`) —
never a suppression.

## The identical-output test

The labels are the unit of truth for the whole Arbiter program, so the
extraction is held to byte-identical output across every entry point:
`fixtures/arbiter/scan/` pins goldens captured from the pre-extraction code,
and CI replays them through the library, the scrubbed-environment CLI, and
the Action bundle. Do not regenerate goldens to make a failing test pass;
re-capture only in a PR that deliberately bumps the labeller/normalization
versions (see `docs/versioning-policy.md`, "The Scan Contract").

## Shadow mode

Shadow mode (HOK-2820) runs this scanner silently on a schedule against a
repo's own merged PRs, storing scores and survival outcomes on a dedicated
`arbiter-shadow` data branch — never on a PR. It reuses the labeller and
extractor unchanged through their public functions; the wire contracts live
in `packages/core/src/arbiter-shadow-record.ts` and the runners in
`packages/scan/src/shadow/`. See [shadow-mode.md](./shadow-mode.md) for the
install steps, data layout, and the never-gate guarantees.

## Where things are

- Contract modules: `packages/core/src/{candidate-features,arbiter-survival-label}.ts`
- Canonical label JSON Schema: `packages/core/schemas/arbiter-survival-label.schema.json`
- Scanner core: `packages/scan/src/{survival-labeller,candidate-features,static-features,diff-parsing}.ts`
- Ambient shells: `packages/scan/src/{default-deps,cli,cli-core,action-entry}.ts`
- Golden fixtures + capture: `fixtures/arbiter/scan/`, `scripts/capture-scan-golden.mjs`
- Wavemill's migration checklist: `docs/arbiter/wavemill-migration-contract.md`
