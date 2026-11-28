# Revert-signal study (HOK-3269 follow-on)

**Status:** `rs-1.0.0` scored 2026-11-19 (§7). Confirmation `rs-1.1.0` FROZEN 2026-11-19, before its draw (§9).
**Plans:** `fixtures/arbiter/corpus/hok-3269-revert-study-plan.json` (`rs-1.0.0`), `fixtures/arbiter/corpus/hok-3269-revert-confirmation-plan.json` (`rs-1.1.0`).
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

| Signal                 | True when                                                                                                                                                                                        | Expected direction |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `breakage_text`        | The revert's title or body, without quoted git trailers, names a break, failure, regression, bug, crash, panic, error, flake, leak or performance problem (the regex used on the HOK-3269 items) | defect             |
| `bot_reason_public_ci` | `revertReasonClass` is `public_ci` or `autorevert`                                                                                                                                               | defect             |
| `ci_red_after_merge`   | A check run or commit status on the original merge commit concluded `failure`                                                                                                                    | defect             |
| `linked_bug`           | The revert references an issue that carries a bug or regression label, or was opened between the merge and the revert                                                                            | defect             |
| `fast_revert`          | Reverted within 48 hours of the merge                                                                                                                                                            | defect             |
| `other_reverter`       | The revert's author differs from the original PR's author                                                                                                                                        | defect             |
| `relanded_unchanged`   | Within 60 days of the revert, a PR re-applies the original with the same files and a line diff within 10% of the original's                                                                      | non-defect         |

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

Scored 2026-11-19. Person's sheet SHA-256 prefix `516bc1f6701db0af`, scored against the frozen `signals.jsonl`.

**The audit passed.** The person got 6 of 6 hidden items right (5 needed). The person and model A agree at κ = 0.51 on the verdict, under the 0.6 floor, so the person's labels decide everything below, as planned. 41 of the 60 reverts are defect reverts (68% unweighted, 72% weighted).

| Rule                                      | Weighted precision (95% CI) | Defect reverts kept | Passes §5 |
| ----------------------------------------- | --------------------------- | ------------------- | --------- |
| `breakage_text`                           | 93.3% (82–98)               | 64.8%               | yes       |
| `bot_reason_public_ci`                    | 100% (3 of 3)               | 33.6%               | no        |
| `ci_red_after_merge` (14 of 60 have data) | 89.3% (60–100)              | 58.0%               | yes       |
| `linked_bug`                              | 100% (7 of 7)               | 1.9%                | no        |
| `fast_revert`                             | 84.5% (73–93)               | 91.8%               | yes       |
| `other_reverter`                          | 59.8% (39–82)               | 31.3%               | no        |
| not `relanded_unchanged`                  | 72.6% (45–91)               | 88.4%               | no        |
| R2 `any_breakage`                         | 94.1% (88–98)               | 87.2%               | yes       |
| R3 R2 and not relanded                    | 95.8% (92–98)               | 77.7%               | yes       |
| R4 R3 or (fast and other reverter)        | 84.2% (73–93)               | 87.0%               | yes       |
| R5 model A (comparison)                   | 89.8% (80–97)               | 98.9%               | yes       |

**The pick under §5 is `fast_revert`.** Of the passing rules built from public facts, it keeps the most defect reverts. Model A is a comparison, not a candidate definition.

**The pass is fragile, so it is reported as borderline.** The round-robin draw gave every repo 5 items. One repo holds 60% of the population weight, so the Kish effective sample size is about 13, not 60. All of that repo's fast reverts are defect reverts, and that repo alone carries `fast_revert` over the bar. Two sensitivity views, which are diagnostics and not new rules:

| Rule              | Unweighted precision / kept | Weighted, dominant repo left out |
| ----------------- | --------------------------- | -------------------------------- |
| `fast_revert`     | 77% / 73%                   | 60% / 76%                        |
| R2 `any_breakage` | 79% / 80%                   | 79% / 62%                        |
| R5 model A        | 84% / 95%                   | 73% / 96%                        |

No rule built from public facts clears 80% in both views. R2 is the most stable, at about 79% in both. The bootstrap resamples within repos, so its intervals don't show how much rides on 5 items.

**Consequence.** `cr-0.3.0` stays without reverts. `fast_revert` (primary, the §5 pick) and R2 (secondary, named now) go to a confirmation sample built so that no single repo decides it (§9).

## 8. Interim display (owner, 2026-11-19)

Rework Risk launches without waiting for the confirmation. Until §9 confirms a rule:

- The headline number stays `cr-0.2.0`, "reverted or explicitly repaired within 30 days". The defect-repair number stays `cr-0.3.0`, without reverts.
- A revert that meets the `rs-1.0.0` pick (`fast_revert`) may be marked **"possible defect revert (lower confidence)"**, with the fact behind it ("reverted within 48 hours"). It is an annotation. It is never counted into `cr-0.3.0` and never gates.
- The copy states the lower confidence plainly. In a 60-revert audit, about 3 in 4 such reverts undid a defect, and the rule has not been confirmed on a second sample. The copy never says "defective" without that qualifier.
- If §9 confirms a rule, the annotation becomes that rule and the qualifier is dropped. Defect reverts then join a new definition alongside `cr-0.3.0`. If §9 confirms neither, the annotation is removed.

## 9. Confirmation (`rs-1.1.0`)

Frozen 2026-11-19, before the draw.

- **Sample:** 100 reverts from the `revert` stratum: accepted P1 candidates within 30 days, development repos, evaluation slice excluded. Both earlier samples are excluded with `--exclude-sample`, so no PR is labelled twice:
  - HOK-3269, SHA-256 prefix `2b3fbc2468ed9948`;
  - `rs-1.0.0`, prefix `7be3bd3038231507`.
- **Allocation:** `repo_allocation: proportional`, with a floor of 4 per repo and the rest split by population. On the `rs-1.0.0` population, that gives a Kish effective sample size of about 74, against about 13 for round-robin.
- **Labels:** both model labellers and the person on every item, under the same guide. 6 new hidden items (3 defect, 3 non-defect reverts), made as for `rs-1.0.0`. None of them appeared before. The pass rule is unchanged: at least 5 of 6 right.
- **Signals:** collected with `scripts/corpus/revert-signals.mjs`, unchanged, before any label exists. Their SHA-256 is posted on HOK-3269.
- **Rules tested:** `fast_revert` (primary) and R2 `any_breakage` (secondary). Model A is reported for comparison. No other rule is scored.
- **Success:** the §5 criterion on this sample alone: weighted precision ≥ 0.80 and ≥ 50% of defect reverts kept.
  - If the primary passes, it is confirmed.
  - If only the secondary passes, the secondary is confirmed.
  - If both pass, the primary is used.
  - A pass whose 95% CI lower bound is under 0.70 is reported as borderline, and the §8 qualifier stays.
- **Reported alongside:** the unweighted figures and the leave-the-largest-repo-out figures from §7, as diagnostics.

## 10. Change log

- 2026-11-13: plan `rs-1.0.0` frozen before the draw. Decided on HOK-3020 after the HOK-3269 top-up audit.
- 2026-11-13: drawn (60 reverts, 12 repos), with 6 hidden items (3 defect, 3 non-defect reverts; 3 more candidates were dropped as debatable by the blind second labeller). Signals were collected before any label existed. `ci_red_after_merge` is available for only 14 of 60 items, because GitHub no longer returns checks or statuses for most of the older merge commits. The rules that use it are scored on what is available, and the coverage is reported with them.
- 2026-11-19: `rs-1.0.0` scored (§7). `fast_revert` is the §5 pick, but its pass rests on one repo's 5 items and is reported as borderline. The owner decided the interim display (§8). The confirmation plan `rs-1.1.0` was frozen before its draw (§9). It uses the sampler's new proportional repo allocation.
