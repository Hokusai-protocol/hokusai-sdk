# Rework Risk example reports

Status: selection, the batch command and the automated checks are built. Scoring, rendering and publishing wait on HOK-2826 and HOK-2828. HOK-3515.

The launch needs public example reports at `hokus.ai/r/{org}/{repo}`. This is
the pipeline that makes them. Every step runs from a manifest and a command,
so the first 5 reports go through the same path as the next 500.

| Step         | What                                                    | Status                                                                   |
| ------------ | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1. Select    | Manifest plus probe; eligible or not, with reasons      | Built                                                                    |
| 2. Generate  | One batch command: scan, re-scan, score, render, review | Built; scoring (HOK-2826) and rendering (HOK-2828) are placeholder steps |
| 3. Review    | Automated honesty checks, then human sign-off           | Automated checks built                                                   |
| 4. Publish   | Batch visibility flip, opt-out, refresh                 | Not started                                                              |
| 5. Unit cost | Compute, wall time, review minutes per report           | Wall time per step recorded                                              |

## 1. Selection

- **Manifest:** `fixtures/arbiter/example-reports/manifest.json`. It lists
  candidates with a batch and a role (`primary`, `swap`, `dry_run`), and the
  thresholds. It is separate from the corpus manifests, so corpus and example
  repos never mix. Every change goes in `changes`.
- **Probe:** `node scripts/example-reports/probe.mjs [--as-of <iso>]`. It
  writes `fixtures/arbiter/example-reports/probe.json` and prints a table.
  The GitHub measurements are the cohort probe's own code
  (`scripts/corpus/lib/github-probe.mjs`), including agent attribution
  through `attributePullRequest`. The rule is `decideExample` in
  `@hokusai/scan`. The output records every failed check, not only the first.
- **Window:** the `window_days` before `as_of − horizon_days`, so the counts
  cover PRs whose 30-day outcome is already known.

### Thresholds (selection 0.2.0)

| Check                                 | Bar                                   | Why                                                                                                            |
| ------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Merged PRs per year                   | ≥ 300                                 | Enough PRs for report cells (n floor 20)                                                                       |
| PRs based on the default branch       | ≥ 50%                                 | The labels follow the default branch                                                                           |
| Default-branch commits mapped to a PR | ≥ 80%                                 | The enumerator maps PRs from commits                                                                           |
| PRs whose landing commit names them   | ≥ 25%                                 | The scanner finds a PR only by the number in its landing commit's subject; rebase merges carry none            |
| Revert PRs per year                   | ≥ 20                                  | Lower bound on reworked PRs; must be ≥ the report's retrospective floor (`min_reworked_for_retrospective`, 20) |
| Agent-authored share of sampled PRs   | ≥ 2%                                  | The report's agent segment needs some agent PRs                                                                |
| Merge convention                      | squash, merge commit, rebase or mixed | What the enumerator supports                                                                                   |
| Archived                              | no                                    |                                                                                                                |

The landing-commit screen was added after the dry run. zephyrproject-rtos/zephyr
passed the probe, with every commit mapped to a PR on GitHub, but it
rebase-merges, so no landing commit names its PR and the scan found 0 PRs.
The share is measured on the probe's PR sample. Squash repos ranged from 54% to
89% and still scanned the full 500 PRs, so the floor is set only to catch
near-zero visibility.

The revert count is a screen, not the decision. Reworked PRs under cr-0.2.0
also include explicit repairs, so a repo can clear the retrospective floor
with fewer reverts. The scan's own suppression is what decides whether a
report shows the retrospective.

### Training and holdout exclusion

A model must never be shown on a repo it trained or was evaluated on. Every
such repo is in a corpus manifest: the development repos, and the HOK-3028
evaluation slice, which is drawn from the cohort's own repos. So:

- The probe excludes any candidate found in a manifest under
  `exclude_corpus_manifests`, in any status, including alternates and
  swapped-out repos.
- The reason is always `in_training_or_holdout`. It is the same for
  development and slice repos, and the evaluation-slice manifest is never
  read, so the output does not reveal which repos are held out.
- A renamed repo is resolved to its current name first, and exclusion is
  checked under both names.
- A private set that is not in a public manifest can be passed with
  `--exclude-hashes <file>`: `{ "salt": "<hex>", "sha256": [...] }`, each
  entry `hashRepo(salt, "owner/name")`. Only the file's SHA-256 is recorded.

Known-answer audit items for HOK-3269 come from repos outside the cohort.
They were labelled by people, not trained on, so those repos stay eligible.

## 2. Generation

```
node packages/scan/dist/cli.js example-batch \
  --manifest fixtures/arbiter/example-reports/manifest.json \
  --probe fixtures/arbiter/example-reports/probe.json \
  --batch first-5 --out <dir outside the repo> [--roles primary,swap] [--repo owner/name] [--force]
```

- Runs only repos the probe marked eligible, and never a corpus repo, even
  if the probe file says otherwise. Primaries by default.
- For each repo: `report` scan, a second scan at the same `as_of`, scoring,
  rendering, then review. Outputs go to `<out>/<owner>__<name>/`.
- Resumable and safe to re-run. `<out>/batch-state.json` records each
  step's status, exit code and wall time. A finished step is skipped unless
  `--force`. One output directory holds one batch at one `as_of`.
- Rate limits: before each scan it reads `gh api rate_limit` and waits for
  the reset when fewer than 500 calls remain.
- Versions: `<out>/run.json` records the scanner, labeller and normalization
  versions, the report policy, and the manifest and probe hashes. The payload
  carries the scanner version from `SCAN_VERSION`, which `pnpm sync:versions`
  keeps equal to the package version. Model and label definition are null
  until scoring exists.
- Scoring and rendering are placeholders that record `unavailable`. The
  payload keeps a null retrospective, so review fails `retrospective_present`
  and nothing can be published by accident.

## 3. Review

`example-review --report <json> --repo <owner/name> --manifest <example manifest> [--rescan <json>] [--page <html>]`
exits 1 when any check fails. The batch runs the same checks on every report.
The checks re-derive what they can instead of trusting the payload.

| Check                      | Fails when                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `schema_valid`             | The payload breaks the `arbiter_report/v1` schema or invariants                                            |
| `real_data`                | `data_origin` is not `scan`, or the repo is a fixture                                                      |
| `repo_matches_candidate`   | The payload is for a different repo                                                                        |
| `prs_found`                | The scan found fewer PRs than the cell floor (20), e.g. a rebase-merging repo                              |
| `not_training_repo`        | The repo is in a corpus manifest, or the payload says it was trained on                                    |
| `retrospective_present`    | The predictive section is missing or suppressed                                                            |
| `out_of_sample_provenance` | No model provenance; or, under a time split, a scored PR merged on or before the split date                |
| `threshold_consistent`     | A PR's flag does not follow its score and the threshold, or `flagged_share` does not match the flagged PRs |
| `policy_is_default`        | The report's floors differ from the default policy                                                         |
| `suppression_consistent`   | Re-applying suppression changes anything: a cell below its floor was shown                                 |
| `rescan_reproduces`        | No re-scan, or the re-scan differs anywhere but `scanned_at`                                               |
| `threshold_shown`          | The rendered page does not print the threshold                                                             |
| `copy_vocabulary`          | The page breaks the positioning rules below                                                                |
| `versions_recorded`        | A version is missing or differs from the one the batch pinned                                              |

Copy rules, from the positioning guidance:

- The model predicts. Copy never says it judges, grades, evaluates or reviews.
- No "Arbiter", and no raw label names (survival, followup, substantially
  rewritten).
- No defect claims ("corrective", "defective", "caused by a bug"). The claim
  is "reverted or repaired". The one exception is the approved annotation
  "possible defect revert (lower confidence)".
- Never a gate: no blocking merges, no auto-merge.
- "Learns from outcomes" always comes with "across organizations" or
  "owned by".
- No illustrative content: "illustrative", "placeholder", "sample data",
  fixture names.

**Borderline** means the report passes but a person must read it. The
triggers are:

- fewer than 1.5× the retrospective floor of reworked PRs;
- a shown retrospective cell with n under twice the cell floor;
- agent attribution coverage within 0.1 of its floor;
- a judgement word anywhere on the page.

At the first batch every report gets human review. At scale, a sample does,
plus every borderline report.
