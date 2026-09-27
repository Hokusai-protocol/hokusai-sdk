# Arbiter Shadow Mode (HOK-2820)

Shadow mode is a silent, scheduled run of the Survival Check on a repo's own
merged PRs. It records what the check *would* have said — a survival-probability
score per merged PR — attaches real survival outcomes once each PR's horizon
matures, and reports the would-be flag rate, precision and false-positive rate
per repo. Nothing is ever surfaced on a PR, and nothing leaves the repo.

Why: alert fatigue kills this product faster than false positives do. Thirty
days of silent scoring per repo yields a calibrated threshold and a real
per-repo hit rate *before* anyone sees a flag, and those numbers are what make
the eventual Phase 3 comment honest.

## Never visible, never gating

The guarantees are structural, not promised, and a static guard test
(`packages/scan/src/shadow/workflow-guard.test.ts`) fails the build if any of
them is weakened:

- The workflow triggers are exactly `schedule` and `workflow_dispatch` — it
  never runs on `pull_request*`, `push` or `check_*`, so it never reports on a
  PR head SHA.
- Permissions are `contents: write` and nothing else; `checks`, `statuses`,
  `pull-requests` and `issues` are explicitly `none`. A misconfigured flag or a
  bug has no API permission to surface anything.
- Shadow code emits no workflow commands (`::error`/`::warning`/`::notice`), no
  `$GITHUB_STEP_SUMMARY`, no check runs, no comments, and no Action outputs.
- Every scan step is `continue-on-error: true`, and the CLI always exits 0 in
  shadow mode (failures print a bare `SHADOW_ERROR code=<CODE>` line).
- Data is pushed only to the dedicated orphan `arbiter-shadow` branch of the
  scanned repository. There are zero calls to the Hokusai API or any other
  non-GitHub host.

> ⚠️ **Do not mark `arbiter-shadow-never-required` as a required status
> check.** The job only ever runs on schedule, never reports on PR SHAs, and
> marking it required would leave every PR waiting forever. The job name is a
> deliberate warning.

## Install in a repo

Copy `.github/workflows/arbiter-shadow.yml` from hokusai-sdk into the repo's
default branch and change two things:

1. `INTEGRATION_BRANCH` — the branch PRs actually merge to (the labeller
   rejects `main`; hokusai-sdk uses `auto/integration`).
2. Outside hokusai-sdk, swap `uses: ./packages/scan/action` for the published
   Action: `Hokusai-protocol/hokusai-sdk/packages/scan/action@<release-tag>`.

Nothing else: no secrets (only the default `GITHUB_TOKEN`), no other files.
The schedule scores every 6 hours; the 03:17 UTC run also backfills outcomes
and writes the daily report.

## Data layout

Everything lives at the root of the orphan `arbiter-shadow` branch, appended
by the workflow as `github-actions[bot]` with `[skip ci]`:

```
state.json            # arbiter_shadow_state/v1 — cursor + last-run metadata
scores.jsonl          # arbiter_shadow_score/v1, append-only, one per merged PR
outcomes.jsonl        # arbiter_shadow_outcome/v1, append-only, one per matured PR
reports/YYYY-MM-DD.json
```

### Record schemas (wire contracts in `@hokusai/core`)

- **`arbiter_shadow_score/v1`** — `repo`, `pr_number` (or null when the merge
  subject has no PR reference), `merge_sha`, `merged_at`, `scored_at`,
  `scorer_id`/`scorer_version`, `score` (estimated survival probability in
  [0, 1]), `threshold`, `would_flag` (`score < threshold`, strictly), and
  `features` — candidate-feature v1 fields only.
- **`arbiter_shadow_outcome/v1`** — the join row: `repo`, `pr_number`,
  `merge_sha`, `horizon_days`, `labelled_at`, `survived`
  (boolean, or null when the labeller declares the label missing), and the
  survival label **without** `line_ranges` (file paths) or `owner_correction`.
- **`arbiter_shadow_state/v1`** — `last_seen_merge_sha` cursor, `last_run_at`,
  `last_run_status` (`ok`/`partial`/`error`) and `last_error_code`.

Validators (`validateShadowScoreRow` etc.) reject raw content at any depth:
`diff`, `patch`, `body`, `title`, `commit_message`, `author_email`,
`line_ranges`, `path`, and the core raw-content names. Only derived features,
scores and labels are ever persisted (Arbiter S5). Feature extraction runs
offline against a temporary no-checkout worktree, with static analysis
disabled — no tool execution, no network, no PR metadata lookups, and
cross-reference (`gh api`) lookups are off in shadow v0.

## Incremental scoring

Discovery walks `git log --first-parent` on the integration branch from the
stored `last_seen_merge_sha`, oldest first, capped at `max-prs` (default 200)
per run. If the cursor is missing or not an ancestor of the branch tip
(rewritten history), the run falls back to a bounded `bootstrap-days` window
(default 30), records `last_error_code: "CURSOR_RESET"`, and continues.
Re-running with no new merges appends nothing: rows are deduplicated by
`merge_sha`, which also makes a crash between the rows append and the state
write harmless.

## `baseline-v0` scorer

An interim, deterministic placeholder whose job is to exercise the pipeline
and produce a calibratable score — replacing it with a trained model is a
later task. It is a logistic over candidate-feature v1 fields; null features
contribute 0. Weights live in `BASELINE_V0_WEIGHTS`
(`packages/scan/src/shadow/scorer.ts`):

```
z = 2.0
    − 0.35·log2(1+loc_touched)/log2(1+2000)·4     (size, saturating)
    − 0.25·min(files_touched,50)/50·4
    + 0.40·(tests_changed)
    − 0.50·(diff_uncertain)
    − 0.30·min(type_errors,20)/20 − 0.30·min(lint_errors,50)/50
    − 0.60·(build_ok === false)
    − 0.20·clamp(complexity_delta,0,50)/50
    − 0.15·min(change_requests,5) − 0.05·min(review_rounds,10)
score = clamp(1/(1+e^−z), 0, 1), rounded to 6 decimal places
```

Every row records `scorer_id`/`scorer_version`, so mixed-scorer histories stay
distinguishable.

## Reading the report

`reports/YYYY-MM-DD.json` (also printed to the job's stdout) contains, per
repo, over `window-days` (default 30, keyed on `merged_at`):

- `n_scored` — score rows in the window.
- `n_matured` — scored PRs with an outcome whose `survived` is not null.
- `n_unlabelled` — outcomes where the labeller declared the label missing.
- `would_flag_rate` = flagged / n_scored.
- `precision` = (flagged ∧ ¬survived) / (flagged ∧ matured) — of the PRs the
  check would have flagged, how many actually died.
- `false_positive_rate` = (flagged ∧ survived) / (survived ∧ matured) — how
  much of the healthy work would have been flagged.
- `base_survival_rate` = survived / n_matured.
- `scorer_id`/`scorer_version` — the most frequent scorer pair in the window,
  with `scorer_mixed: true` when the window mixes more than one pair.
- `threshold_sweep` — the same metrics recomputed at thresholds 0.05…0.95 in
  steps of 0.05 (19 entries), for calibration.

Every ratio is `null` when its denominator is 0 — never 0 or NaN. A repo needs
roughly 30 days of matured outcomes before precision numbers mean anything.

## CLI

The scan CLI (`hokusai-scan`) and Action (`mode:` input) expose the same three
commands: `shadow-score`, `shadow-backfill`, `shadow-report`. Flags:
`--data-dir` (required), `--repo <path>` (default `.`),
`--github-repo <owner/name>` (default: detected from `origin`),
`--integration-branch` (required for score/backfill), `--threshold` (0.5),
`--bootstrap-days` (30), `--max-prs` (200), `--horizon-days` (14|30|60,
default 30), `--window-days` (30). Shadow commands always exit 0; failures
print `SHADOW_ERROR code=<CODE>` with no message, stack or path.

## Kill switch and uninstall

- Disable: `gh workflow disable arbiter-shadow.yml` (or delete the file).
  Nothing gates on it, so disabling has no merge impact.
- Delete the data: `git push origin --delete arbiter-shadow`. No other
  storage exists.
