# Arbiter report content contract (`arbiter_report/v2`), proposed

**Status: proposed (HOK-2826 step 1).** No scanner emits v2. `arbiter_report/v1`
([report-contract.md](report-contract.md)) stays the emitted version until the
site (HOK-2828) and the pipeline store (HOK-3217) accept v2, as the v1
versioning rule requires. Until then the field names below can still change.

- Schema: `packages/core/schemas/arbiter-report.v2.schema.json`
- Types and validator: `validateArbiterReportV2` in `@hokusai/core`
- Fixtures: `fixtures/arbiter/report-v2/`, which has its own `PROVENANCE.json`
  and is kept apart from the vendored v1 directory.
- Check: `pnpm check:arbiter-report` (checks v1 and v2)

## Why a new version

The plan of record asks for things v1 can't carry without losing meaning:

- a separate result for all PRs and for PRs that agents wrote;
- the portable prior next to the repo-calibrated number;
- the target and horizon the model was trained for;
- the cutoffs that make a time split honest.

v1 has room for only one retrospective, one provenance block and one
prediction per PR, so v2 replaces those three fields. Everything else in v1 is
unchanged in v2: repo, scan, coverage, labels, aggregates, cost and
eligibility, with the same schema and the same invariants.

## What changes from v1

| v1                                | v2                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `retrospective` (one, or null)    | `retrospective.results[]`: one per (target, horizon, calibration, segment)    |
| `model_provenance` (one, or null) | `retrospective.heads[]` and `retrospective.calibrations[]`                    |
| `prs[].prediction` (one, or null) | `prs[].predictions[]`: one per available calibration, with its eligibility    |
| none                              | `prs[].targets[]`: the outcome per (target, horizon)                          |
| none                              | `prs[].agent_at_merge`: agent attribution from evidence that existed at merge |
| `policy`                          | adds `min_local_calibration_labels` (null until HOK-2824 defines N)           |

`retrospective` itself is always present. When there's no valid artifact,
`status` is `unavailable`, `unavailable_reasons` says why, and there are no
results or predictions.

## The retrospective

**Heads** identify each scoring artifact:

- `artifact_sha256`, `artifact_format`, and the exact `feature_contract` the
  artifact declares;
- the `target` (a corrective-rework definition such as `cr-0.2.0`) and
  `horizon_days`;
- `score_direction`;
- `training` provenance: corpus, dataset version, repo count, whether this
  repo is in the training data (`repo_membership`), `split` (`leave_repo_out`
  or `time_split`), the split manifest hash, `rows_merged_before` (the latest
  training merge) and `labels_observed_by` (when training labels were read).

**Calibrations** belong to a head. Each is `portable` or `repo_calibrated`,
and either `available` (with a version and a threshold) or `unavailable` (with
typed reasons). The comparison is fixed: a PR is flagged when its score is ≥
the threshold. An available repo-calibrated result needs `fit` provenance and
`policy.min_local_calibration_labels`. While N is undefined the result is
`unavailable: local_calibration_undefined`. N is never invented.

**Per-PR rows** add three fields:

- `agent_at_merge`;
- `targets`: each with `status` mature, immature or missing, plus `positive`,
  which is null unless mature;
- `predictions`: one per available calibration, each with `status` scored,
  `not_scored` (in the cohort, but inputs are missing) or `excluded` (outside
  the cohort), a reason, and a score and flag only when scored.

**Results** carry:

- counts: eligible, scored, evaluable, flagged, positive, TP, FP, FN, TN;
- reason counts for excluded, unscored and unevaluable PRs;
- three cells with declared denominators: `precision` (n = TP + FP), `recall`
  (n = TP + FN) and `flag_rate` (n = scored, including PRs whose outcome isn't
  known yet).

## Every number is recomputed from the rows

`deriveRetrospectiveCounts` is the single definition of a result's counts.
The validator uses it, and the scanner will use it in step 4. Validation
recomputes every result from the per-PR rows and rejects any count, reason
tally, denominator or shown value that differs. The rules:

- **Agent segment:** PRs with `agent_at_merge: agent` only. Unknown attribution
  is in neither the agent segment nor counted as human.
- **Unknown outcomes:** immature or missing outcomes are never negatives. They
  count toward the flag rate but not toward precision or recall.
- **Zero denominators:** a cell with a zero denominator can't be shown.

The scanner still owns floors and suppression, as in v1. The validator checks
that payloads are consistent; it doesn't check policy.

## Honesty invariants (new in v2)

| Code                                       | Fails when                                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `retrospective_status_mismatch`            | The retrospective is available without heads, calibrations or results, or is unavailable without a reason, or is unavailable with results |
| `reference_unknown`, `reference_duplicate` | A calibration, result or prediction points at a missing reference, or a reference is reused                                               |
| `result_key_duplicate`                     | Two results share a (target, horizon, calibration, segment) key                                                                           |
| `target_mismatch`                          | A result's target or horizon differs from its head's. A head is never scored against a target it wasn't trained for                       |
| `split_membership_conflict`                | The split is leave-repo-out, but the repo is in the training data                                                                         |
| `training_cutoffs_out_of_order`            | Training rows post-date their labels, or the labels post-date `trained_at` (the same rule applies to a calibration fit)                   |
| `prediction_before_split`                  | Under a time split, an evaluated PR merged on or before `labels_observed_by`, so the model saw labels from after it merged                |
| `calibration_rows_overlap`                 | An evaluated PR is among the rows the repo calibration was fitted on                                                                      |
| `calibration_state_inconsistent`           | Available without a version or threshold, unavailable without a reason, or an unavailable calibration is used                             |
| `local_calibration_below_minimum`          | A repo calibration is available with N undefined, or with fewer fit rows than N                                                           |
| `prediction_state_inconsistent`            | A score or flag is present on an unscored row, a reason is missing, or a reason is from the wrong list                                    |
| `prediction_coverage_mismatch`             | A PR doesn't have exactly one prediction per available calibration                                                                        |
| `flag_threshold_mismatch`                  | `flagged` doesn't equal score ≥ threshold                                                                                                 |
| `target_label_inconsistent`                | A PR is missing the target a result uses, or `positive` is set on an immature or missing outcome                                          |
| `result_counts_not_reproducible`           | Counts or reason tallies differ from the rows                                                                                             |
| `result_metric_mismatch`                   | A cell's n or shown value differs from the rows                                                                                           |
| `zero_denominator_shown`                   | A cell is shown with no denominator                                                                                                       |

The v1 invariants (`suppressed_cell_has_value`, `section_status_mismatch`,
`prediction_without_provenance`, `horizon_not_declared` and the rest) still
apply, and also cover the new cells. Every new object is closed, so the same
forbidden-key tests as v1 (source, path, author, SHA and the rest) reject leaks
inside heads, calibrations, results, predictions and targets.

## Fixtures

| Fixture         | Shows                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `retrospective` | Leave-repo-out on a repo outside the training data. Both segments shown; repo calibration unavailable                    |
| `time-split`    | A repo in the training data. PRs before the split are excluded; the agent segment is suppressed below the positive floor |
| `suppressed`    | A 12-PR repo. Both results suppressed for `reworked_below_floor`; descriptive coverage still shown                       |
| `unavailable`   | No artifact: `unavailable: no_artifact`, with no predictions                                                             |

All are `data_origin: fixture`, with synthetic scores, outcomes and artifact
identity. Fixture suppression copies the proposed scanner rule: a cell needs
n ≥ `min_cell_n`, and a result needs positives ≥
`min_reworked_for_retrospective`. Each new invariant also has an invalid
fixture.

## Decisions that need agreement

These are proposals, not adopted decisions. Record each one in the Program
Decision Log once it's adopted.

1. **Flag-rate denominator:** scored PRs, including those with unknown
   outcomes. The site needs a separate, explicitly defined field if it wants a
   rate over all PRs.
2. **Time-split rule:** evaluated merges must come after the training labels
   were read (`labels_observed_by`), not just after the last training merge.
   This is stricter than a date split on features alone.
3. **Targets:** results use corrective-rework definitions only, and must match
   the head's declared target. HOK-2825 fixes the head's target and input
   contract. The fixtures' `fixture-features` contract is a placeholder.
4. **Floors:** v2 reuses v1's floors for each cell and for the result's
   positives. `min_local_calibration_labels` waits on HOK-2824.
5. **Size limits:** at most 4 heads, 8 calibrations, 64 results, and 16
   predictions per PR.
6. **Rollout:** the site and store vendor `fixtures/arbiter/report-v2/` and
   validate with the core validator. Only then does the scanner emit v2 (step
   6). v1 output stays available for consumers that only use the descriptive
   report.
