# Merge-time feature leakage audit (HOK-3023)

This audit decides whether `rr-merge-features/0.4.0` can be frozen as 1.0.0. A feature leaks if
it reads anything that happened after the PR merged, or anything derived from the rework label.
The audit ran on the full feature run at commit f889ce3: 364,743 rows from 18 repos, 0 failed
rows, 3 rows with null evidence (PRs GitHub no longer resolves).

Every check below sampled only the 12 development repos. The 6 HOK-3028 evaluation-slice repos
were dropped before sampling, by the slice file whose SHA-256 is recorded in the results. Pooled
results are in `fixtures/arbiter/corpus/hok-3023-leakage-audit.json`. Per-repo and per-PR results
are kept outside git.

## Checklist

| #   | Check                                                                                                                                         | Result                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1   | Every manifest field names an `as_of` source, and the validator rejects post-merge sources, `label.*` fields and denylisted label-side fields | Pass. Conformance cases run in CI                                 |
| 2   | Replay: rows rebuilt with evidence and git cut at the merge are byte-identical to the published rows                                          | Pass. 576 of 576                                                  |
| 3   | Canary: rows are unchanged after fabricated post-merge activity                                                                               | Pass. 576 of 576                                                  |
| 4   | Control: a fabricated review just before the merge changes every row                                                                          | Pass. 576 of 576                                                  |
| 5   | Independent spot check: columns recomputed from REST and plain `git` match                                                                    | Pass. 13 exact columns at 58–60 of 60; every difference explained |
| 6   | Agent markers: hand review of detector positives and negatives                                                                                | Pass after detector fixes                                         |
| 7   | Suspicion scan: no feature predicts the label well enough to suggest leakage                                                                  | Pass. Nothing flagged                                             |
| 8   | Raw text stays out of S3 and git                                                                                                              | Pass. Row files scanned; no evidence fields or trailer text       |

## Replay and canaries

`hokusai-scan corpus-feature-replay` picks 6 cut points per development repo, at least one per
landing type, and samples up to 8 PRs that landed in the 300 positions before each cut. It
rebuilds each row three ways:

- **Replay:** git history truncated at the cut and evidence filtered to `as_of`. All 576 rows
  were byte-identical to the published rows.
- **Perturbed:** fake post-merge activity added after the latest captured event: reviews,
  dismissals of existing reviews, label adds and removals, a rename, a body edit, title and body
  set to a canary string, CI failures, and changed record fields. All 576 rows were unchanged.
- **Control:** one fake review just before the merge. All 576 rows changed, so the comparison
  would see a real change.

On 220 of the 576 PRs (38%), today's reviews or labels differ from those at merge. A feature
reading current state would have failed the replay on those PRs.

## Spot check

`scripts/corpus/spot-check-merge-features.mjs` draws 12 PRs per landing type and recomputes the
main columns without the extractor's code: reviews from `/pulls/{n}/reviews`, labels and renames
from the REST timeline, and history from `git rev-list`.

| Column                                                                                                      | Agree    | Note                                                                          |
| ----------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| hours open, approvals, changes requested, hours to first review, title hash, files, lines added and deleted | 60 of 60 |                                                                               |
| review count, distinct reviewers, GitHub label count                                                        | 60 of 60 | 48, 49 and 56 before the timeline fix                                         |
| `file_commits_90d`                                                                                          | 60 of 60 | Needs landing time, rollup ends and `--full-history`; see below               |
| `is_bot`                                                                                                    | 58 of 60 | 2 PRs found by `(#N)` reference have no author type, so the row is null       |
| `repo_commits_prior` (approximate)                                                                          | 56 of 60 | 3 where only the extractor can match the author's emails; 1 rollup off by one |
| `marker_present` (approximate)                                                                              | 59 of 60 | 1 null where the body at `as_of` could not be read                            |

The first version of the independent check used each commit's own date for the 90-day window and
agreed on 46 of 60. The extractor uses landing time, so a branch commit written 100 days ago and
merged 30 days ago is inside the window. That is the intended rule, because commit dates can be
set to anything. Measured the same way, with `--full-history` so git keeps side-branch commits,
and with a rollup member's history ending just before the rollup landed, the column matches on
all 60.

## Agent markers

A hand review of 94 detector positives found 6 false positives: release bots on `bot/` branches.
The `bot/` branch rule was removed. Of 300 negatives, 57 mentioned an agent tool, and about 30 of
those were real evidence the detector missed: mostly `Assisted-by` trailers and authorship
statements such as "Authored by Claude Code", plus organization agent accounts. The detector now
reads all three. On the 2026 development-repo rows, positives rose from 15,654 to 20,637. In
samples of the gained rows, all were real: 70 `Assisted-by`, 80 at random from the rest, and 27
commit authorship statements. 42 test cases in `agent-marker-cases.json` cover the rules and
their look-alikes.

## Suspicion scan

`scripts/corpus/audit-feature-suspicion.py` scores each feature alone against the 30-day
`corrective_rework` label: 268,475 rows, 7,596 positives. A feature is flagged at AUC 0.75 or
above, pooled or within repo, or if its null rate swings by 0.2 or more between quarters.

Nothing was flagged. The strongest features are size and review effort: lines added 0.668, LOC
touched 0.665, files touched 0.659, hours open 0.651, review count 0.628. The largest null-rate
swing is 0.033 (complexity delta). A gradient-boosted model reaches AUC 0.705 on a time split
(test from 2026-02-01) and 0.656 grouped by repo, which is the range expected without leakage.

Agent markers alone score 0.50, and adding them lowers the time-split AUC to 0.697. This is drift,
not leakage. Markers rose from 0% of PRs in 2024Q3 to 31% in 2026Q3, while the label rate fell
from 3.2% to 2.1%. Pooled, marked PRs are labelled less often (2.4% vs 2.9%), but within the
recent period `marker_present` scores 0.61: marked PRs are reworked more. HOK-3028 arms must
handle this shift; a pooled reading of the marker effect has the wrong sign.

## Findings

1. **GitHub truncates timeline events.** GraphQL returns about 310 timeline nodes per query across
   all batched PRs and silently drops the rest. 4.8% of PRs had lost label, rename or dismissal
   events. Timeline events now have their own capture step, which splits large batches; a
   900-PR check found no short PR. The 0.3.0 run was replaced.
2. **The agent detector missed common markers** (`Assisted-by`, authorship statements,
   organization agent accounts) and misread `bot/` branches. Fixed in 0.4.0.
3. **The `is_bot` null meaning is incomplete.** Null also means a PR found by a `(#N)`
   reference whose author type was not recorded. Correct the text at the 1.0.0 freeze.
4. **Slice exposure.** Pooled per-type counts let a reader infer which repos are in the evaluation
   slice, and the hand review showed development-repo identities. Per-type results stay private,
   and this audit did not build or tune HOK-3028 arms.
5. **Not covered here.** A model trained on public code may have seen these PRs or their fixes.
   That is a model-memory risk for HOK-3028 to assess, separate from feature leakage.

## Sign-off

The manifest can be frozen as `rr-merge-features/1.0.0` once finding 3 is corrected.

- Auditor: Claude Code, 2026-11-11, on commit f889ce3 data
- Owner: **********\_\_********** Date: ****\_\_****
