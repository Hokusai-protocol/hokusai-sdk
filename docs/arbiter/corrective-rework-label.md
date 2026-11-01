# Corrective-rework label: definition and calibration (HOK-3269)

**Status:** Plan FROZEN on 2026-10-29, before the sample was drawn. The calibration plan (§3) and `hok-3269-calibration-plan.json` change only with a new `plan_version` and a change-log entry. §6 is filled in from the scored sheets, and `cr-0.2.0` is pinned from §6 by the rule in §3.4.
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

- **Three labellers.**
  - **A:** model labeller (`claude-opus-5-5`), every item.
  - **B:** a second model labeller (`claude-sonnet-5-5`), every item.
  - **H:** one experienced engineer, paid for a one-off job, labelling a 30% audit subset blind.
- **Why models plus a person.** Two models give agreement measurements and scale. The person is ground truth: they validate the models, and they are the human sample the HOK-3028 §6 label-noise diagnostic names. Without H, model labels would be one more unvalidated proxy.
- **Separate stream.** Calibration labels are their own stream. They never become `owner_corrected` S2 rows, and they are never merge-time features (HOK-3028 §8.5).
- **Canonical codes.** The taxonomy is `packages/core/src/arbiter-calibration-label.ts` (version `1.0.0`):
  - verdict: `yes`, `no` or `unclear`
  - cause codes (HOK-3047)
  - human exclusion codes: the first six `EXCLUSION_CODES` (HOK-3048)
- **Private.**
  - Sample IDs, evidence and labels never leave the private sample directory. Only the scorer's `calibration-table.md`, with repos pseudonymized, is shared.
  - The model labellers send the evidence to the Anthropic API: PR titles, bodies and diffs, all from public repositories.
- **Known-answer set.** The audit subset and H's labels become the known-answer set for future labelling contributions (HOK-3335).

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
- **Labellers.** Models A and B label every item (`double_label_share` 1.0). The person labels 30% of each stratum: 53 items, about 5 hours.
- **Seed.** A random 32-byte seed is drawn at sample time and stored only in the private `sample.json`.
- **Evaluation slice excluded.** The HOK-3028 evaluation-slice repos are excluded entirely. The sampler reads the slice manifest only to drop those repos, and records only the manifest's SHA-256, which equals `holdout_sha256`. As in the gate's development splits, every slice repo is held out. Calibrating on slice PRs would fit the target definition to the evaluation data.

Each item's evidence, which both models and the person read:

- the original PR's title, body and diff
- each candidate fix's title, body and diff, accepted or rejected
- the related PRs: later PRs within 30 days that touched the original's files, up to 15

Diffs over 60,000 characters are cut and marked as cut.

The related-PR list is what makes negatives labellable: a labeller reviews a short list instead of searching the repo's history.

### 3.2 Agreement, and when model labels stand in

- **Floor:** κ ≥ 0.6 (Cohen's), per code, one-vs-rest, and overall. 0.6 is the conventional lower bound of "substantial" agreement (Landis & Koch). A lower floor would admit codes two raters can't apply consistently; a higher one would retire most codes on a 53-item audit.
- **When model labels stand in.** Model labels stand in for the full sample only if the person and model A agree on the verdict at κ ≥ 0.6, over the audit subset.
  - **If they do,** the full-sample estimates from model A are primary.
  - **If they don't,** the human audit's own estimates are primary. Those intervals are wider, and the model results are still reported.
- **Codes.**
  - Cause and exclusion codes are judged on person-vs-model-A agreement.
  - A code below the floor is merged into its nearest code or retired, with a note. A taxonomy that misses the floor is never used to train a customer-facing cause classifier.
  - A code no labeller used is kept, but flagged as `not_observed`.
- **Also reported:** model A against model B, and the person against model B.
- **Labels as given.** Labels are scored as given. Disagreements are reported, not adjudicated.

### 3.3 Estimates

| Estimate | Definition | Interval |
| --- | --- | --- |
| Precision of a proxy or definition | Weighted share of `yes` among the items it marks corrective | Stratified bootstrap 95% (2,000 resamples) |
| Recall | Weighted share of `yes` items it catches | Stratified bootstrap 95% (2,000 resamples) |
| Per-stratum yes rate | Unweighted | Wilson 95% |
| Wrongly rejected | Share of the `rejected` stratum labelled `yes` | Wilson 95% |

- **Unclear labels** are left out of every rate and counted separately. A model that refuses an item, or gives a label that breaks the sheet's rules, leaves the item unlabelled, and the item is counted.
- **The HOK-3028 §6 label-noise diagnostic** always uses the person's labels: the precision of the picked definition (§3.4), or of `cr-0.1.0` when none qualifies.
- **Recall is bounded by the negatives.** Each sampled negative stands for about 9,000 PRs, so one `yes` among the negatives moves recall a long way. The recall interval is reported as it comes out and is not narrowed after the fact. 40 negatives is a deliberate trade: the related-PR list makes them quicker to label, but they remain the slowest items for the person.

### 3.4 Picking cr-0.2.0

The scorer evaluates five definition variants:

| Variant | Positives |
| --- | --- |
| `cr-0.1.0` | P1–P4 |
| `high_precision` | P1 and P2 only |
| `szz_min_3` | P3 links need ≥ 3 blamed lines |
| `no_internal_build` | P1 reverts for internal-build breakage are dropped |
| `szz_min_3+no_internal_build` | both of the above |

`cr-0.2.0` is the variant with the highest estimated recall among those whose estimated precision is **≥ 0.80**, computed on the primary labels (§3.2). On ties, the earlier variant in the list wins. The 0.80 is the HOK-3028 gate's own label-precision bar, so the target meets the bar the gate will check it against.

- **No variant qualifies.** Then no `cr-0.2.0` is pinned. HOK-3020 decides whether to fix the pipeline or redefine the target. HOK-3028 §6 treats precision < 0.80 as "labels too noisy".
- **Confidence tiers.** A proxy whose precision interval lies wholly at or above 0.90 becomes `high`. Every other admitted proxy is `medium`.

### 3.5 Auditor checks

The person's labels check the models, so a careless auditor, or one who pastes items into an LLM, would make the models look better validated than they are. Known-answer ("gold") items guard against that. This section was added on 2026-11-01, after the sample draw and before any labelling. It changes no plan parameter, sample item or estimate.

- **Gold items.** PRs from public repositories outside the cohort, each with an answer settled from public evidence. Each was found by one agent and confirmed by a blind second one. Items are dropped if their answer is debatable. The answer key is private (this repository is public), and its SHA-256 is posted on HOK-3269 before labelling starts.
- **Kinds.** Reverts for a defect, explicit repairs, repairs only findable in `related_prs`, non-defect reverts, planned follow-ups, links to bugs the PR didn't cause, and clean negatives.
- **Screening.** Before hiring, a candidate labels 8 screening items, a paid test of about an hour. They pass with at least 75% of verdicts right and a rationale on every row that names specific evidence.
- **Hidden items.** 10 other gold items are mixed into `sheet-h.csv` at positions keyed by the private seed. They look like sample rows. The scorer removes them before any estimate.
- **Pass rule.** The audit is accepted if at least 80% of hidden verdicts are right. `unclear` and blank count as wrong, because gold items are chosen to be clear.
  - A labeller who is right 90% of the time fails about 7% of the time.
  - One who is right 60% of the time passes about 17% of the time.
- **On failure.** Every result that uses the person's labels is void. Another auditor labels the subset. The same hidden items can be reused, because no auditor sees the answers.
- **What gold items don't catch.** An LLM that gets the gold items right passes. A mid-audit call in which the auditor walks through two of their labels is the check for that.

## 4. Labelling guide

For each row of the sheet, open the PR, every URL in `candidate_fixes`, and the PRs in `related_prs`.

- **`candidate_fixes`:** every candidate within 30 days, accepted or rejected. The sheet doesn't say which proxy proposed a fix, or whether it was accepted. An empty `candidate_fixes` means no proxy found anything.
- **`related_prs`:** later PRs within 30 days that touched the original's files.

**Time box:** about 5 minutes per item. If you can't tell by then, answer `unclear`; that is a legitimate answer.

### corrective

Ask: within 30 days of this PR merging, did someone do unplanned work to repair a defect it introduced?

- **`yes`:** a fix within 30 days repairs a defect this PR introduced. Reverting the PR because it broke something counts, including builds or tests you can't see.
- **`no`:** nothing within 30 days was a repair of this PR. This includes when the candidate fixes are planned follow-ups, requirement changes, unrelated, refactors, or non-defect reverts.
- **`unclear`:** you can't tell within the time box.

**Rows with no candidate fixes:** look through `related_prs` for a repair the proxies missed. If you find one, answer `yes` and paste its URL into `notes`. Those rows are what the recall estimate rests on.

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

- The person labels `sheet-h.csv` without opening `sheet-a.csv`, `sheet-b.csv` or `model-labels/`.
- Keep `notes` short and factual.
- Never paste labels, item IDs or PR URLs from the sample into Linear, Slack or a PR.

## 5. Running it

Every step runs on the owner's machine. Whoever builds or tunes the HOK-3028 arms must not see the sample, because its repo list would reveal the evaluation slice's repos.

1. **Draw the sample** (once, after the plan freeze):

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
2. **Gather evidence** (about 10 minutes):

   ```sh
   node --max-old-space-size=8192 packages/scan/dist/cli.js corpus-calibration-evidence \
     --manifest fixtures/arbiter/corpus/hok-3022-cohort.json \
     --cache-dir ~/hokusai-data/arbiter-corpus \
     --sample ~/.hokusai-private/hok-3269-sample
   ```

   This writes `evidence.jsonl` and the blank `sheet-h.csv`.
3. **Hide the gold items** in the audit sheet (§3.5) before it goes out:

   ```sh
   node packages/scan/dist/cli.js corpus-calibration-gold \
     --sample ~/.hokusai-private/hok-3269-sample \
     --gold ~/.hokusai-private/hok-3269-gold/gold.json
   ```

   It refuses a sheet with labels in it, or a second run. stdout gives the gold set's SHA-256: post it on HOK-3269.
4. **Screen candidate auditors.** Write the blank screening sheet once, send it with §1 and §4, and grade each returned copy:

   ```sh
   node packages/scan/dist/cli.js corpus-calibration-screen --gold ~/.hokusai-private/hok-3269-gold/gold.json --out ~/.hokusai-private/hok-3269-gold/screening.csv
   node packages/scan/dist/cli.js corpus-calibration-screen --gold ~/.hokusai-private/hok-3269-gold/gold.json --sheet <returned copy>
   ```

5. **Send `sheet-h.csv` and §1 and §4 of this doc to the hired auditor.** They label it blind.
6. **Run the model labellers.** This needs `ANTHROPIC_API_KEY` and costs about $25–40 in all. Responses are cached per item, so an interrupted run resumes free.

   ```sh
   node scripts/corpus/label-calibration.mjs --sample ~/.hokusai-private/hok-3269-sample --sheet a
   node scripts/corpus/label-calibration.mjs --sample ~/.hokusai-private/hok-3269-sample --sheet b
   ```

   `--limit 3` runs a cheap trial first.
7. **Score** once `sheet-h.csv` is back:

   ```sh
   node packages/scan/dist/cli.js corpus-calibration-score --sample ~/.hokusai-private/hok-3269-sample
   ```

   - Invalid labels exit 2 and list the item IDs.
   - Partial sheets still score, but the table is marked INCOMPLETE.
   - With gold items present, stdout and the table give the audit check, and a failed check marks the person's results void.
   - Post `calibration-table.md` on HOK-3269. Keep `calibration-results.json` private, because it has repo names.

## 6. Results

_To be filled in from `calibration-table.md` once labelling is complete._

- Whether model labels stand in, with the person-vs-model κ.
- Validation table: precision and recall per proxy, per definition variant and per repo (pseudonymized).
- Agreement: κ for the verdict, cause codes and exclusion codes, and what happened to each code below the floor.
- Cause distribution, with counts.
- Rejections: the wrongly-rejected rate and the automatic-versus-labelled exclusion-code table. Also the `linkage_error` rate per proxy, reported separately.
- The `cr-0.2.0` pick under §3.4, the §6 label precision, and the target-pin commit for HOK-3028 §2.

## 7. Change log

- 2026-10-29: first draft.
- 2026-10-29: labelling moves to two model labellers plus a paid human audit (53 items). Each item gets an evidence bundle with related PRs. Model labels stand in only if the person agrees with model A at κ ≥ 0.6. The defaults are kept and their rationale recorded: κ 0.6, precision floor 0.80 (HOK-3028's bar), 40 negatives, SZZ split at 3 lines.
- 2026-10-29: plan 1.0.0 frozen, before the sample draw.
- 2026-11-01: auditor checks added (§3.5): a screening test and 10 hidden known-answer items. This was done after the draw and before any labelling, and changes no plan parameter, sample item or estimate.
