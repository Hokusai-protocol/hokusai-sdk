# Survival Check — shadow-mode install (Arbiter P2.S1, HOK-2820)

Step 1 of the Check's launch discipline: **score silently, calibrate for 30
days per repo, tell nobody.** Flag mode comes only in Phase 3, once Model A
beats the blinded judge on held-out data (plan-of-record §15.4).

## What ships, and where

Shadow mode is the existing `@hokusai/scan` machinery run on a schedule
(§15.3: the private-repo shape *is* this Action run once — "install" is
literally "make it scheduled"). Three concerns, one repo at a time:

| Concern | hokusai-sdk (first cohort repo) | Any other repo |
| --- | --- | --- |
| Per-PR feature extraction | `.github/workflows/hokusai-scan-pr.yml` | `shadow-extract` job of the template |
| Nightly survival backfill | `.github/workflows/hokusai-scan-nightly.yml` | `shadow-label` job of the template |
| Weekly calibration report | `.github/workflows/hokusai-scan-report.yml` | `shadow-report` job of the template |

The template is `packages/scan/action/shadow-mode-workflow.yml` — a single
copy-pasteable file, so each additional repo is a one-file install PR plus a
committed `.hokusai-scan.json`.

Accumulated output lives in two places, both inside the scanned repo's own
GitHub org (Arbiter S5: derived features or nothing leave the repo):

- **Workflow artifacts**, 90-day retention (covers the 60-day horizon plus
  the report window): `hokusai-scan-pr-<n>-…` feature blobs and
  `hokusai-scan-labels-<date>-…` label JSONL.
- **The `arbiter/shadow-state` branch**, written by the scheduled jobs:
  `last-seen-merge.txt` (the incremental bound) and `last-report.md` /
  `last-report.json` (the latest aggregation, visible in the GitHub UI
  without downloading anything).

## What "silent" means, checked mechanically

Nothing a contributor can see may ever appear on a PR — advisory by design
and forever (§8, §15.2). This is not a convention; it is enforced by
`scripts/check-scan-workflow-surfaces.mjs`, which runs in CI via
`pnpm check:boundaries` and fails the build when any `hokusai-scan-*`
workflow (or shipped template):

- grants `checks: write`, `pull-requests: write`, `statuses: write`,
  `issues: write`, or `deployments: write`;
- calls a comment/check-run/commit-status API (REST or `gh`);
- emits an `::error` / `::warning` / `::notice` annotation directive;
- omits an explicit `permissions:` block;
- has a `pull_request` trigger without the fork guard or without
  `continue-on-error: true` on the scan step;
- uses `pull_request_target`.

Two more guarantees the guard cannot grep for, kept by review:

1. **Never a required check.** The scan workflows are separate files from
   `ci.yml` and must never be added to branch-protection required checks.
2. **`contents: write` is state-branch-only.** The scheduled jobs hold it
   solely to push derived state to `arbiter/shadow-state`; pushing a branch
   is not a PR surface (comments, check runs, and statuses each need their
   own scope, which stays absent).

## Per-repo install steps

1. Copy `packages/scan/action/shadow-mode-workflow.yml` to
   `.github/workflows/hokusai-scan-shadow.yml` in the target repo.
2. Replace `auto/integration` with the repo's integration branch. `main` is
   rejected by the `arbiter_survival_label/v1` contract — squash-promotion
   repos must point at the branch PRs actually merge to.
3. Pin `@vX.Y.Z` on every `uses:` line to a published hokusai-sdk release
   tag.
4. Commit a `.hokusai-scan.json` at the repo root (see the
   [`@hokusai/scan` README](../../packages/scan/README.md)) with the repo's
   typecheck / lint / build commands, and fill in the template's
   dependency-install step so those commands can run. Skipping this is
   allowed: static signals then degrade to explicit nulls.
5. Optionally create the state branch up front (the nightly job creates it
   on its first successful run otherwise):

   ```sh
   git switch --orphan arbiter/shadow-state
   git commit --allow-empty -m "shadow-state: init"
   git push origin arbiter/shadow-state
   git switch -
   ```

6. After the first PR triggers a run, confirm on the Actions tab that an
   artifact was produced — and confirm on the PR itself that **nothing**
   appeared: no check run from the scan workflow, no comment, no annotation.

## Reading the weekly report

`last-report.md` on `arbiter/shadow-state` (also the report run's summary)
gives, per repo:

- **PRs seen / labelled** — coverage of the accumulation so far.
- **Outcomes at the horizon** — deduplicated `report_outcome` counts
  (dedupe key is `(prUrl, horizon)`, latest `computed_at` wins, so outcomes
  refresh nightly as horizons elapse).
- **N-day survival rate** — survived / known outcomes.
- **Would-be flags / flag rate** — what the Check *would* have flagged.
  Until Model A ships this is the transparent placeholder rule
  `placeholder-untested-risky-change/v1` (risk_level ∈ {medium, high} ∧
  requires_tests ∧ ¬tests_changed), and every line says
  "placeholder rule, no trained model yet".
- **Would-be precision** — TP / (TP + FP), where a true positive is a
  flagged PR whose outcome was reworked (anything other than `survived`).
  **Suppression floor:** precision is withheld until the repo has ≥ 5
  reworked PRs at the horizon (§13.3 / §20 governance) — below that the
  number would not be honest to quote.

The same numbers are machine-readable in `last-report.json`
(`shadow_repo_report/v1`), which is what Phase 3 calibration consumes.

Ad-hoc reruns: `hokusai-scan report --inputs <dir> [--horizon 30]
[--as-of <iso>] [--format markdown|json]` over any directory of downloaded
artifacts reproduces the report byte-for-byte.

## Uninstall

1. Delete the repo's `hokusai-scan-*` workflow file(s).
2. Delete the `arbiter/shadow-state` branch.
3. Optionally delete `hokusai-scan-*` artifacts from the Actions tab (they
   expire on their own after 90 days) and remove `.hokusai-scan.json`.

Nothing else was ever written: no PR state, no required checks, no external
sinks (a central data-pipeline sink is Phase 3, gated on the §11.6 consent
door, and out of scope here).
