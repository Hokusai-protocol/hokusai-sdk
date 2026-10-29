# Corrective-rework label: definition and calibration (HOK-3269)

**Status:** DRAFT. The calibration plan (§3) is pre-registered when the freeze commit lands, before anyone labels an item. §5 is filled in from the scored sheets, and `cr-0.2.0` is pinned from §5 by the rule in §3.4.
**Internal.** The public excerpt is [corrective-rework-label-public.md](corrective-rework-label-public.md).

## 1. Definition

A merged PR is **corrective at horizon _h_** when someone had to do unplanned work, merged within _h_ days of the PR, to repair a defect the PR introduced. The primary horizon is 30 days; 14 and 60 are secondary.

The following are not corrective:

- planned iteration: the next step of a plan, a follow-up the PR announced, a stacked PR
- requirement changes: the PR did what was asked, and then what was asked changed
- unrelated edits that touch the same lines
- refactors with no defect behind them
- reverts made for reasons other than a defect: collateral reverts of a stack, or reverting to land the change differently

The definition is detected by the proxies, confidences and exclusion codes in [corrective-rework-contract.md](corrective-rework-contract.md):

| Proxy | Confidence (cr-0.1.0) |
| --- | --- |
| P1 `revert` | high |
| P2 `repair_reference` | high |
| P3 `szz` | medium |
| P4 `regression_issue` | medium |

`abnormal_churn` is disabled. Calibration measures how far each proxy matches a person's judgment, and `cr-0.2.0` keeps the variant that §3.4 picks.

## 2. Calibration stream

- **Separate stream.** Calibration labels are their own stream. They never become `owner_corrected` S2 rows, and they are never merge-time features (HOK-3028 §8.5).
- **Canonical codes.** The taxonomy is `packages/core/src/arbiter-calibration-label.ts` (version `1.0.0`):
  - verdict: `yes`, `no` or `unclear`
  - cause codes (HOK-3047)
  - human exclusion codes: the first six `EXCLUSION_CODES` (HOK-3048)
- **Private.** Sample IDs and labels never leave the private sample directory. Only the scorer's `calibration-table.md`, with repos pseudonymized, is shared.

## 3. Pre-registered plan

The plan is `fixtures/arbiter/corpus/hok-3269-calibration-plan.json`. Changing it after any item is labelled needs a new sample.

### 3.1 Sample

The unit is an original PR at 30 days with a base label (`corrective ≠ null`). Every unit falls in exactly one stratum:

| Stratum | Population | Drawn |
| --- | --- | --- |
| `revert` | corrective, and P1 fired | 20 |
| `repair_reference` | corrective, and P2 fired (but not P1) | 20 |
| `regression_issue` | corrective, and P4 fired (but not P1 or P2) | 15 |
| `szz_strong` | corrective on P3 alone, with ≥ 3 blamed lines | 25 |
| `szz_weak` | corrective on P3 alone, with ≤ 2 blamed lines | 25 |
| `rejected` | not corrective, but a candidate within 30 days was rejected | 25 |
| `negative` | not corrective, and no candidate at all | 40 |

That is 170 items in all.

How the draw works:

- **Spread across repos.** Within each stratum, repos take turns in seeded order until the allocation is met. Small repos are therefore represented, and per-repo estimates are possible.
- **Reweighting.** Every estimate is reweighted by the cell's population (repo × stratum) divided by the cell's decided items.
- **Double labelling.** 20% of each stratum (34 items) is labelled twice, independently.
- **Seed.** A random 32-byte seed is drawn at sample time and stored only in the private `sample.json`.
- **Evaluation slice excluded.** The HOK-3028 evaluation-slice repos are excluded entirely. The sampler reads the slice manifest only to drop those repos, and records only the manifest's SHA-256, which equals `holdout_sha256`. As in the gate's development splits, every slice repo is held out. Calibrating on slice PRs would fit the target definition to the evaluation data.

### 3.2 Agreement

- **Floor:** κ ≥ 0.6 (Cohen's), per code, one-vs-rest, and overall, on the double-labelled subset.
- **Corrective verdict:** if the verdict's κ is below the floor, the calibration is invalid. The guide (§4) is revised and a fresh sample is labelled.
- **Cause and exclusion codes:**
  - A code below the floor is merged into its nearest code or retired, with a note. A taxonomy that misses the floor is never used to train a customer-facing cause classifier.
  - A code neither labeller used is kept, but flagged as `not_observed`.
- **Primary labels.** Sheet A is the primary label. Disagreements are reported, not adjudicated into it, so agreement is measured on the labels the estimates use.

### 3.3 Estimates

| Estimate | Definition | Interval |
| --- | --- | --- |
| Precision of a proxy or definition | Weighted share of `yes` among the items it marks corrective | Stratified bootstrap 95% (2,000 resamples) |
| Recall | Weighted share of `yes` items it catches | Stratified bootstrap 95% (2,000 resamples) |
| Per-stratum yes rate | Unweighted | Wilson 95% |
| Wrongly rejected | Share of the `rejected` stratum labelled `yes` | Wilson 95% |

- **Unclear labels** are left out of every rate and counted separately.
- **Recall is bounded by the negatives.** Each sampled negative stands for thousands of PRs, so one `yes` among the negatives moves recall a long way. The recall interval is reported as it comes out and is not narrowed after the fact.

### 3.4 Picking cr-0.2.0

The scorer evaluates five definition variants:

| Variant | Positives |
| --- | --- |
| `cr-0.1.0` | P1–P4 |
| `high_precision` | P1 and P2 only |
| `szz_min_3` | P3 links need ≥ 3 blamed lines |
| `no_internal_build` | P1 reverts for internal-build breakage are dropped |
| `szz_min_3+no_internal_build` | both of the above |

`cr-0.2.0` is the variant with the highest estimated recall among those whose estimated precision is **≥ 0.80**. On ties, the earlier variant in the list wins.

- **No variant qualifies.** Then no `cr-0.2.0` is pinned. HOK-3020 decides whether to fix the pipeline or redefine the target. HOK-3028 §6 (label-noise diagnostic) treats precision < 0.80 as "labels too noisy".
- **Confidence tiers.** A proxy whose precision interval lies wholly at or above 0.90 becomes `high`. Every other admitted proxy is `medium`.

## 4. Labelling guide

For each row of the sheet, open the PR and every URL in `candidate_fixes`. The fixes are every candidate within 30 days, accepted or rejected. The sheet doesn't say which proxy proposed a fix, or whether it was accepted. An empty `candidate_fixes` means no proxy found anything.

**Time box:** about 5 minutes per item. If you can't tell by then, answer `unclear`; that is a legitimate answer.

### corrective

Ask: within 30 days of this PR merging, did someone do unplanned work to repair a defect it introduced?

- **`yes`:** a fix within 30 days repairs a defect this PR introduced. Reverting the PR because it broke something counts, including builds or tests you can't see.
- **`no`:** nothing within 30 days was a repair of this PR. This includes when the candidate fixes are planned follow-ups, requirement changes, unrelated, refactors, or non-defect reverts.
- **`unclear`:** you can't tell within the time box.

**Rows with no candidate fixes:** check the PR's timeline for cross-references, reverts and linked issues within 30 days of merge. If you find a fix the proxies missed, answer `yes` and paste its URL into `notes`. Those rows are what the recall estimate rests on.

### cause_code (for `yes`)

Pick the first code that fits, in this order:

1. `dependency_drift`: the fix is in lockfiles or config, and the original code is barely touched.
2. `blast_radius`: the breakage was in files this PR never touched but which depend on it.
3. `missing_context`: the fix touches files the PR didn't, which existed at merge and sit next to what it changed.
4. `test_gap`: CI was green at merge, and the fix adds or changes tests on paths this PR touched.
5. `plan_error`: the fix rewrites the approach rather than patching it.
6. `local_generation_error`: a small, local fix in the same function; most of the PR's lines survive.
7. `review_gap`: none of the above, and the PR merged with no review or a cursory one.
8. `unclear`: no code fits.

Leave `cause_code` blank for `no` (it becomes `not_rework`) and for `unclear`.

### exclusion_code (for `no`, when there are candidate fixes)

Pick the reason the candidate fixes are not repairs:

- `planned_iteration`
- `requirement_change`
- `unrelated_edit`
- `refactor`
- `revert_non_defect`
- `linkage_error`: the fix has nothing to do with this PR, because the link itself is wrong.

If several apply, pick the one for the fix closest to being a repair.

### Independence

- The second labeller labels `sheet-b.csv` without seeing `sheet-a.csv`. Don't discuss items until both sheets are done.
- Keep `notes` short and factual.
- Never paste labels, item IDs or PR URLs from the sample into Linear, Slack or a PR.

### Running it

1. **Draw the sample** (owner, once, after the plan freeze):

   ```sh
   node packages/scan/dist/cli.js corpus-calibration-sample \
     --manifest fixtures/arbiter/corpus/hok-3022-cohort.json \
     --cache-dir ~/hokusai-data/arbiter-corpus \
     --plan fixtures/arbiter/corpus/hok-3269-calibration-plan.json \
     --exclude-slice ~/.hokusai-private/hok-3028-slice.json \
     --out ~/.hokusai-private/hok-3269-sample
   ```

   - The output directory must be outside any git work tree, and an existing sample is never overwritten.
   - stdout shows only aggregate counts and the sample's SHA-256. Post that hash on HOK-3269 so the draw is committed.
2. **Label.** Labeller A fills in `sheet-a.csv`, and labeller B fills in `sheet-b.csv`.
3. **Score:**

   ```sh
   node packages/scan/dist/cli.js corpus-calibration-score --sample ~/.hokusai-private/hok-3269-sample
   ```

   - Invalid labels exit 2 and list the item IDs.
   - Partial sheets still score, but the table is marked INCOMPLETE.
   - Post `calibration-table.md` on HOK-3269. Keep `calibration-results.json` private, because it has repo names.

## 5. Results

_To be filled in from `calibration-table.md` once labelling is complete._

- Validation table: precision and recall per proxy, per definition variant and per repo (pseudonymized).
- Agreement: κ for the verdict, cause codes and exclusion codes, and what happened to each code below the floor.
- Cause distribution, with counts.
- Rejections: the wrongly-rejected rate and the automatic-versus-human exclusion-code table. Also the `linkage_error` rate per proxy, reported separately.
- The `cr-0.2.0` pick under §3.4, and the target-pin commit for HOK-3028 §2.

## 6. Change log

- 2026-10-29: first draft. The plan's defaults (allocation, 20% double labelling, κ ≥ 0.6, precision floor 0.80, SZZ split at 3 lines) await owner confirmation before the freeze.
