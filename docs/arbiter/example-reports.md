# Rework Risk example reports

Status: step 1 of 5 (selection) built. HOK-3515.

The launch needs public example reports at `hokus.ai/r/{org}/{repo}`. This is
the pipeline that makes them. Every step runs from a manifest and a command,
so the first 5 reports go through the same path as the next 500.

| Step         | What                                               | Status                   |
| ------------ | -------------------------------------------------- | ------------------------ |
| 1. Select    | Manifest plus probe; eligible or not, with reasons | Built                    |
| 2. Generate  | One batch command: scan, score, render private     | Not started              |
| 3. Review    | Automated honesty checks, then human sign-off      | Not started              |
| 4. Publish   | Batch visibility flip, opt-out, refresh            | Not started              |
| 5. Unit cost | Compute, wall time, review minutes per report      | Probe wall time recorded |

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

### Thresholds (manifest 0.1.0)

| Check                                 | Bar                                   | Why                                                                                                            |
| ------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Merged PRs per year                   | ≥ 300                                 | Enough PRs for report cells (n floor 20)                                                                       |
| PRs based on the default branch       | ≥ 50%                                 | The labels follow the default branch                                                                           |
| Default-branch commits mapped to a PR | ≥ 80%                                 | The enumerator maps PRs from commits                                                                           |
| Revert PRs per year                   | ≥ 20                                  | Lower bound on reworked PRs; must be ≥ the report's retrospective floor (`min_reworked_for_retrospective`, 20) |
| Agent-authored share of sampled PRs   | ≥ 2%                                  | The report's agent segment needs some agent PRs                                                                |
| Merge convention                      | squash, merge commit, rebase or mixed | What the enumerator supports                                                                                   |
| Archived                              | no                                    |                                                                                                                |

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
