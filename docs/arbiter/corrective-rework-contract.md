# Corrective-rework contract (cr-0.1.0)

An S2 survival label records that a PR's lines were touched again within a horizon. This contract adds whether that later work was a **fix**: some change that repaired the original. It was introduced by HOK-3267. The definition `cr-0.1.0` is HOK-3020 (R7)'s starting proposal. The HOK-3269 calibration will validate or revise it.

- **Schema:** `packages/core/schemas/arbiter-corrective-rework.schema.json`. It is mirrored as `ARBITER_CORRECTIVE_REWORK_V1_JSON_SCHEMA`, and a contract test fails if the two differ.
- **Types and derivation:** `packages/core/src/arbiter-corrective-rework.ts`.
- **Producer:** the `@hokusai/scan` corrective labeller.

## Records

One schema covers three record types, told apart by `record_type`. Every record has `schema_version` and an `envelope` containing:

- `schema_version`
- `definition_version`
- `labeller_version`
- `integration_branch`
- `as_of`
- `computed_at`

| `record_type` | One per | Purpose |
|---|---|---|
| `candidate` | Proposed (original, fix, proxy) link | A link a proxy proposed, kept whether it was accepted or rejected. A rejected candidate has an `exclusion_code`, so false positives can be counted. |
| `repair_pair` | Accepted candidate | The original→fix pair and the difference between the two changes. |
| `corrective` | (`prUrl`, `horizon_days`) | Whether an accepted fix merged within the horizon. It links to the S2 row through `base_label_hash` and never modifies S2. |

`candidate_id` is `correctiveCandidateId(original, fix, proxy)`: a SHA-256 over the original PR URL, the fix's identity (its PR URL, or its SHA if it has no PR) and the proxy. The same link gets the same ID across runs and across definition versions. A repair pair uses its candidate's `candidate_id`.

### Candidate

| Field | Meaning |
|---|---|
| `original` | `pr_url`, `merge_sha` (as in the S2 envelope) and `merged_at`. |
| `fix` | `pr_url` (null for a direct push), `sha` (the integration-branch commit that landed it) and `merged_at`. |
| `lag_seconds` | `fix.merged_at − original.merged_at`. Always ≥ 1. |
| `proxy`, `confidence` | See [Proxies](#proxies). |
| `evidence[]` | At least one typed `{kind, ref, count}` item. `ref` is a URL, a SHA or a label name. It is never free text. |
| `status` | `accepted` or `rejected`. |
| `exclusion_code` | Null if and only if `status` is `accepted`. |

### Repair pair

The repair pair repeats the candidate's identity fields and adds:

- **`files`:** five path lists: `original`, `fix`, `fix_only` (fix − original), `original_only` (original − fix) and `fix_preexisting` (fix files that already existed at `original.merge_sha`). The lists are kept even when `graph_distance` is unavailable.
- **`line_survival`:** the fraction of the original's added lines still present in the fix's parent tree. A high value means the original was patched; a low value means it was rewritten. Null if it can't be measured.
- **`fix_tests`:** counts of test files the fix added, modified and deleted.
- **`original_review`:** `reviewed`, `review_count`, `reviewer_count` and `first_review_latency_seconds`. A null field means the value wasn't collected, not that it was zero.
- **`graph_distance`:** null until it can be filled from a structural index. That fill reads the stored `files` lists and doesn't need candidate detection to run again.

### Corrective label

`deriveCorrectiveLabel()` is the only way corrective rows are produced. The rule is:

- **`corrective: null`:** the S2 base label is missing (its `report_outcome` is null). Then `reason_codes` is `['base_label_missing']`, and a value is never imputed.
- **`corrective: true`:** at least one accepted repair pair uses an admitted proxy and has `0 < lag_seconds ≤ horizon_days × 86400`. Its fix merged in the interval (merge, merge + H].
  - `repair_pair_ids` holds those pairs' IDs, sorted.
  - `confidence` is the highest among them.
  - `reason_codes` lists their proxies in precision order.
- **`corrective: false`:** neither of the above. Then `reason_codes` is `['no_accepted_fix']`.

The label is monotone across horizons: if a row is true at 14 days, it is also true at 30 and 60.

## Proxies

| Tier | `proxy` | Fires when | Confidence | Admitted in cr-0.1.0 |
|---|---|---|---|---|
| P1 | `revert` | The fix reverts the original, in whole or in part: a `This reverts commit <sha>` message, `Reverts owner/repo#N`, or revert metadata from a bot. Revert commits pushed without a PR count too; they are read from the branch's first-parent history. | high | yes |
| P2 | `repair_reference` | The fix cites the original by PR, URL or SHA in regression wording just before the citation: a regression word followed by a preposition (`Regression in <sha>`, `broken by #N`, `failing since #N`), `caused by` or `introduced in/by`. "Regression tests for #N" does not count. The other route is a fix-shaped change (fix title or label) that closes an issue which cited the original after it merged and which cites at most 3 originals; issues citing more are trackers. A fix label or `fix:` title on its own is only supporting evidence. | high | yes |
| P3 | `szz` | The fix closes a bug or regression issue, and blame on the lines it deletes or modifies lands in the original. | medium | yes |
| P4 | `regression_issue` | A regression or incident issue links the fix and the original. | medium | yes |
| P5 | `abnormal_churn` | Churn is abnormally high. | low | no: such candidates are recorded with the `proxy_disabled` exclusion code |

## Exclusion codes

These six codes are shared with the human calibration pass (HOK-3269), and a human's `not_rework` verdict resolves to one of them:

- `planned_iteration`
- `requirement_change`
- `unrelated_edit`
- `refactor`
- `revert_non_defect`
- `linkage_error`

The labeller applies these codes automatically, before acceptance:

- `backport`: a backport or cherry-pick.
- `revert_of_revert`: a revert of a revert.
- `dependency_bot`: a PR from a dependency bot. These are counted separately.
- `fix_too_large`: the fix exceeds the SZZ size cap.
- `proxy_disabled`

The labeller also applies `revert_non_defect` itself when a merge bot records a collateral or process reason for the revert, for example a merge conflict, reverting a dependent PR, or a land race. Reverts for broken CI or internal builds stay accepted, and calibration decides whether they belong in the target.

The `linkage_error` rate is reported separately, because it measures how good the linkage is.

## Fix sources

Fixes can land after the cohort window closes. So the labeller also enumerates PRs merged between the window's end and `as_of`, writing them to `fix-prs.jsonl`, a local-only cache of raw PR text. They are used only as fixes, never as originals.

## Privacy

Records contain only:

- typed codes
- URLs
- SHAs
- repo paths
- label names
- counts

Titles, bodies, comments and diffs are read on the machine running the labeller, never written to any record (decision-record §4.3), and the schema rejects unknown properties.

## Versioning

- **Changes to fields or their meaning:** bump `ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION`.
- **Changes to the definition:** bump `CORRECTIVE_REWORK_DEFINITION_VERSION` (`cr-x.y.z`). This covers which proxies are admitted and their confidence tiers.

Records are append-only. For each key, the newest `computed_at` wins.

## Corpus layout

The labeller writes these files next to each repo's `s2.jsonl.gz` and uploads them under `as-of=<date>/<owner>__<repo>/`:

- `candidates.jsonl.gz`
- `repair_pairs.jsonl.gz`
- `corrective.jsonl.gz`

HOK-3268 aggregates these files and HOK-3269 samples them. Neither reads the corpus again.
