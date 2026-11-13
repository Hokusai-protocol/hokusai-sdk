# Revert-signal study (HOK-3269 follow-on)

**Status:** FROZEN 2026-11-13, before the draw. Plan: `fixtures/arbiter/corpus/hok-3269-revert-study-plan.json` (`rs-1.0.0`).
**Owner:** Tim Ogilvie

## 1. Question

Can public facts about a revert tell a **defect revert** (it undid a change that broke something) from a **non-defect revert** (not ready for release, a workaround no longer needed, a migration split in two)?

If yes, defect reverts join the defect-repair number (`cr-0.3.0`: repair references and regression issues). If no, that number stays without reverts. Either way, the HOK-3028 target (`cr-0.2.0`, "reverted or explicitly repaired") is unchanged.

**Why a fresh draw.** In the HOK-3269 audit, 7 of 20 reverts were non-defect reverts. A breakage-words rule (75%) and model A's verdict (77%) were tried on those same 20 items, so those figures are optimistic. Nothing in this study is scored on them.

## 2. Sample

- **60 reverts**, drawn with the HOK-3269 sampler from the `revert` stratum only: accepted P1 candidates within 30 days, in development repos (the HOK-3028 evaluation slice is excluded).
- **Earlier items are excluded** (`--exclude-sample` with the HOK-3269 `sample.json`), so no PR is labelled twice.
- **Labels:** both model labellers on every item, and the same person on every item, under the §4 labelling guide of `corrective-rework-label.md` (the defect question). New hidden known-answer items are mixed in: at least 3 defect reverts and 3 non-defect reverts from public repos outside the cohort, made as in §3.5 of that doc. The pass rule is unchanged: at least 80% right.
- **Weights:** cell (repo) population weights, as in HOK-3269 §3.3. The 20 earlier reverts leave the population before the draw, which changes cell sizes negligibly.

## 3. Signals (fixed before any label is seen)

Each is computed per revert from public GitHub data and recorded as true, false or missing:

| Signal | True when | Expected direction |
| --- | --- | --- |
| `breakage_text` | The revert's title or body, without quoted git trailers, names a break, failure, regression, bug, crash, panic, error, flake, leak or performance problem (the regex used on the HOK-3269 items) | defect |
| `bot_reason_public_ci` | `revertReasonClass` is `public_ci` or `autorevert` | defect |
| `ci_red_after_merge` | A check run or commit status on the original merge commit concluded `failure` | defect |
| `linked_bug` | The revert references an issue that carries a bug or regression label, or was opened between the merge and the revert | defect |
| `fast_revert` | Reverted within 48 hours of the merge | defect |
| `other_reverter` | The revert's author differs from the original PR's author | defect |
| `relanded_unchanged` | Within 60 days of the revert, a PR re-applies the original with the same files and a line diff within 10% of the original's | non-defect |

## 4. Rules scored (fixed list; no others are tried)

1. Each signal alone.
2. `any_breakage`: `breakage_text` or `bot_reason_public_ci` or `ci_red_after_merge` or `linked_bug`.
3. `any_breakage` and not `relanded_unchanged`.
4. Rule 3, or (`fast_revert` and `other_reverter`).
5. Model A's verdict on the revert (`yes`), for comparison.

## 5. Success criterion

A rule **succeeds** when, on the person's labels, its weighted precision is ≥ 0.80 **and** it keeps ≥ 50% of the defect reverts. If several succeed, the one keeping the most defect reverts is chosen. A chosen rule becomes a new definition (defect reverts plus `cr-0.3.0`), which needs its own check on a later sample before it is reported. If none succeeds, the defect-repair number stays `cr-0.3.0`.

Intervals are reported throughout. With 60 items, a precision near 0.80 carries an interval of roughly ±10 points, so a borderline pass is reported as borderline.

## 6. Running it

1. `corpus-calibration-sample` with this plan, `--exclude-slice` and `--exclude-sample <HOK-3269 sample.json>`, then `corpus-calibration-evidence`.
2. `corpus-calibration-gold --gold gold-rs-1.0.0.json`: the study's own hidden items only, so the auditor sees none twice.
3. `node scripts/corpus/revert-signals.mjs --sample <dir>` writes `signals.jsonl`. Run it before the sheet comes back, and post its SHA-256.
4. The model labellers (`label-calibration.mjs --sheet a` and `--sheet b`), and the person's sheet.
5. `corpus-calibration-score`, then the §4 rules against the person's labels.

## 7. Results

_To be filled in once the sheet is back._

## 8. Change log

- 2026-11-13: plan `rs-1.0.0` frozen before the draw. Decided on HOK-3020 after the HOK-3269 top-up audit.
- 2026-11-13: drawn (60 reverts, 12 repos), with 6 hidden items (3 defect, 3 non-defect reverts; 3 more candidates were dropped as debatable by the blind second labeller). Signals were collected before any label existed. `ci_red_after_merge` is available for only 14 of 60 items, because GitHub no longer returns checks or statuses for most of the older merge commits. The rules that use it are scored on what is available, and the coverage is reported with them.
