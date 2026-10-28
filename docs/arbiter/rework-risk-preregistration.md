# Rework Risk backtest: pre-registered decision gate (HOK-3028)

**Status:** DRAFT. Not frozen. The ranking thresholds were decided on 2026-10-28. Values still marked **[PROPOSED]** are open for review before freeze.
**Owner:** Tim Ogilvie
**Freeze rule:** freezing happens in two dated commits, and both must land before any arm is scored on the evaluation slice (§4):

1. **Gate freeze:** sets `Status: FROZEN (gate)`. It fixes §3–§8 and the holdout hash. The commit's hash and date are the pre-registration timestamp.
2. **Target pin:** sets `definition_version` in §2 once HOK-3269 calibration is done. This is the only field that may change after the gate freeze. By then, per-repo base rates from HOK-3268 will have been seen, but no arm comparison will have been.

## 1. Question

Does Rework Risk (arm 5) predict which merged PRs need unplanned corrective work, from merge-time information only, better than a steelmanned Jev snap judgment (arm 4)? "Better" means better ranking without worse calibration.

The comparison is between two models that see the same frozen merge-time information. Arm 5 has learned from outcome history. Arm 4 has none.

## 2. Fixed inputs (data identity)

Every arm is scored on the same rows. A result is valid only if all of these are pinned in the run manifest:

| Input | Pinned to |
| --- | --- |
| Corpus | `fixtures/arbiter/corpus/hok-3022-cohort.json`, after the HOK-3268 sanity pass (repo drops recorded there, **before** any arm is scored) |
| Target | `corrective_rework`, `definition_version` pinned by the target-pin commit at the end of HOK-3269 calibration (decided 2026-10-28: wait for calibration rather than default to `cr-0.1.0`). `definition_version = <TBD at target pin>` |
| Primary horizon | 30 days. 14 and 60 days are secondary. |
| Features | HOK-3023 frozen merge-time manifest (version recorded). Every arm consumes only this set. |
| Exclusions | Dependency-bot PRs are segmented out of the primary analysis and reported separately. Rows with `corrective = null` are excluded and counted, never imputed. |

## 3. Arms

1. **Trivial:** change size, files touched, file churn history, author history.
2. **Classical JIT:** logistic regression and GBM on the engineered JIT features.
3. **Frontier chat LLM:** snap-judgment score on a fixed random sample only.
4. **Jev:** the HOK-3026 steelman question set, composed in code, on the full evaluation slice.
5. **Rework Risk:** trained on outcome labels (the HOK-3021 runner extended here).
6. **Hybrid:** arm 4's question outputs used as features for arm 5.

**Steelman rule for arm 4.** Jev's composite score gets the same treatment as arm 5. Any score-to-probability calibration (isotonic regression) is fitted on training folds only, with the same budget. Calibration results are reported both raw and recalibrated. The gate uses the recalibrated numbers, so arm 4 is judged at its best.

**Tuning budget.** No arm is tuned on the evaluation slice. The question set and composition logic for arm 4, and the hyperparameters for arm 5, are frozen before §4 scoring.

## 4. Splits

* **Development:** leave-repo-out cross-validation over the development repos, with a time split inside each fold (train on PRs merged before the fold's split date). Used for every tuning decision.
* **Evaluation slice (gate):** a private held-out slice of repos and a time window, chosen and recorded privately before freeze, per decision D2. It is scored **once**, for all arms in the same run. Its identity is published only after the result.
* **How the slice is drawn:** mechanically, by `scripts/arbiter/draw-evaluation-slice.mjs` (procedure 1.0.0), so that per-repo base rates already seen cannot steer it:
  * The runnable repos are split into size terciles by enumerated PR count.
  * Each tercile is ordered by `sha256(salt ‖ repo)`, using a 32-byte random salt. The first 2 repos of each tercile, 6 in all, are the slice. The rest of each tercile's order is the replacement order if HOK-3268 drops a slice repo.
  * The time window is the last 6 months of the cohort window. It extends back 3 months at a time if the slice has fewer than 500 positives at 30 days under the labels available at draw time.
  * Development repos are the other runnable repos; slice repos are excluded from development entirely.
* **Sealed holdout commitment:** the evaluation slice's manifest (repos, time window and salt) is kept privately. Its SHA-256 is written here at freeze: `holdout_sha256 = <TBD at freeze>`. Publishing the manifest after the result lets anyone check that the slice was fixed in advance.
* **[PROPOSED] Minimum power:** the evaluation slice must contain ≥ 5 repos and ≥ 500 corrective positives at 30 days. Otherwise the gate result is **INCONCLUSIVE (underpowered)**, not a pass or a fail.

## 5. Metrics

**Primary (ranking):** top-decile capture, the share of corrective PRs that fall in the arm's top 10% of risk scores, computed per repo.

**Aggregation:** the macro-average across evaluation repos, so each repo has equal weight. Pooled numbers are reported but never gate. Without this, one large repo (llvm alone has about 74k PRs) decides the result.

**Uncertainty:** a 95% paired bootstrap CI on the arm-5-minus-arm-4 difference, resampling repos (clusters) and PRs within each repo, with 10,000 resamples.

**Secondary ranking metrics:** average precision (PR-AUC), and precision and recall at the decile threshold.

**Calibration:** Brier score and ECE (10 equal-mass bins), per repo and macro-averaged.

## 6. Decision gate

Let **Δ** = macro top-decile capture (arm 5) − macro top-decile capture (arm 4), in percentage points.

| Outcome | Condition (all must hold) | Consequence |
| --- | --- | --- |
| **COMPELLING** (thesis proven) | Δ ≥ **10 pp**, and the CI lower bound > 0, and arm 5 / arm 4 capture ≥ **1.25×**, and calibration is non-inferior (below), and arm 5 beats arms 1 and 2 (CI lower bound > 0), and Δ > 0 in ≥ **[PROPOSED] ⅔** of evaluation repos | The marquee number is publishable under the report honesty rules. Proceed to naming and copy. |
| **HALF-WIN** | Ranking conditions pass; calibration non-inferiority fails | No calibration claim, and no launch number until calibration is fixed and the gate is re-run on a *new* evaluation slice |
| **TIE** (≈ arm 4) | CI includes 0, or 0 < Δ < threshold | Run the label-noise diagnostic (below). Then either fix the pipeline, or revise the moat story toward the hybrid architecture. No launch number. |
| **LOSS** | CI upper bound < 0 | Snap judgment beats outcome training at this horizon. Revisit the thesis and re-plan the project. |
| **TABLE-STAKES FAIL** | Arm 5 does not beat arms 1 and 2 | Treat as a pipeline or leakage bug until proven otherwise. Run the HOK-3023 audit again. |

**Calibration non-inferiority [PROPOSED]:** macro Brier(arm 5) ≤ macro Brier(arm 4) + 0.002, **and** macro ECE(arm 5) ≤ macro ECE(arm 4) + 0.01, both judged on the CI upper bound of the difference.

**Label-noise diagnostic (TIE branch):** compare `corrective_rework` with the HOK-3269 human calibration sample. **[PROPOSED]** If precision against the human labels is < 0.80, the outcome is "labels too noisy": fix the pipeline and re-run on a new evaluation slice. Otherwise, the outcome is "snap judgment suffices at 30 days".

## 7. Secondary questions (reported, never gating)

* **Arm 3 vs arm 5,** on the arm-3 sample only, with the same metrics.
* **Hybrid:** if (arm 6 − max(arm 4, arm 5)) has a CI lower bound > 0, the hybrid architecture claim is supported.
* **Horizons:** 14 and 60 days.
* **Agent-authored segment** (HOK-2808 attribution): same metrics, with cells below the program floor suppressed.
* **Dependency-bot PR segment.**

## 8. Integrity rules

1. The evaluation slice is scored once. If a bug is found afterwards, every arm is re-run, and the deviation is logged with the original result kept alongside.
2. After evaluation scoring, nothing in §2–§6 changes: no target, horizon, split, metric, threshold or repo set.
3. Amendments before freeze are allowed and go in the change log below. Amendments after freeze are not allowed; they need a new pre-registration on a new evaluation slice.
4. Every result row pins the dataset, split, target, feature-manifest and arm versions (the HOK-3021 runner contract). Rows with different target versions are never pooled.
5. Only label-side fields (repair pairs, exclusion codes, cause codes) may appear as targets. Any of them appearing as a feature fails the HOK-3023 audit.

## 9. Outputs

* A results write-up with the §6 outcome stated in the first line.
* The demo line, with real numbers: "N merged PRs later needed corrective work. Rework Risk placed X in its top-risk decile. A frontier decision model with no outcome history placed Y."
* A Decision Log entry in the Arbiter Program Brief.

## Change log

* 2026-10-28: first draft (HOK-3028). Owner decisions: lift bar Δ ≥ 10 pp and ≥ 1.25×; target version pinned after HOK-3269; document lives in `hokusai-sdk/docs/arbiter/`.
* 2026-10-28: slice selection is mechanical (§4, `draw-evaluation-slice.mjs`). The draw happens after per-repo S2 and P1/P2 corrective base rates were posted on HOK-3268 and HOK-3267, but before any arm was built or scored. The seeded draw, and the published salt after the result, let anyone check that those rates did not choose the slice. Whoever builds or tunes arms does not see the manifest.
