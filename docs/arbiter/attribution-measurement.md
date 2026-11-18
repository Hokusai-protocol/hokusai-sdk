# Full attribution measurement and gate proposal (HOK-2822)

The fixed-cohort measurement is complete. It does not meet the current 60%-in-six-repos requirement, and no model was evaluated. HOK-2822 remains In Progress.

## Results

The denominator is unchanged: 117,991 PRs with non-null 30-day outcomes, merged in `[2026-02-02, 2026-08-01)`, across the same 18 public repositories.

| Measurement                                           | Identified PRs | Micro coverage | Meaning                                                                                                                             |
| ----------------------------------------------------- | -------------: | -------------: | ----------------------------------------------------------------------------------------------------------------------------------- |
| Frozen audited marker baseline                        |         28,209 |         23.91% | Existing named-agent accounts, branches, commit/landing markers and body declarations                                               |
| Predeclared complete pass, protocol 1.0.0             |         28,209 |         23.91% | Adds historical explicit agent labels, structured harness/route metadata and supplied owner mappings; no additional PRs found       |
| Exploratory disclosure extension 1.1.0                |         29,333 |         24.86% | Adds 1,124 PRs with explicit generic AI declarations, affirmative checked disclosure forms, or named documentation-agent signatures |
| Incorrect counterfactual: count every bot as an agent |         30,765 |         26.07% | Includes 2,556 bot-authored PRs lacking agent evidence; not a valid attribution result                                              |

The primary pass has 22.73% macro coverage, and zero repositories reach 60%. The extension also leaves every repo below 60%. Signals overlap; all unions are deduplicated per PR. These are observable-evidence rates, not estimates of actual AI usage or detector recall.

The original protocol was committed as `4cf1035` before inspecting extended measurement results. After inspecting its fixed review sample, we found missed disclosures and recorded a separate exploratory extension as `f56f3fb` before measuring that extension's population counts. The extension is explicitly post-review, not independently validated. It does not change the primary result, frozen feature rows, training inputs, sample membership or model evaluation.

## What the complete pass checked

- Reused pinned S2/feature files and historical evidence for the same eligible PRs; no new repo selection or outcome-based rule tuning.
- Existing account, branch, commit/landing and body signals, including contributions opened under human accounts.
- Label state reconstructed at each merge. Only explicit generation/authorship/assistance labels count; bare AI/tool-topic labels do not. No qualifying labels were found under the fixed policy.
- Structured metadata reconstructed from the body at merge. No known harness metadata or head-bound executed-model metadata was found.
- Repo-specific owner mappings: none were supplied or inferred. Tool affiliation or a bot's company name alone does not establish AI involvement in a particular PR.
- Separate generic bot and dependency-bot counts. A GitHub Bot account alone is no longer counted as agent evidence by the report attribution engine; explicit owner configuration and recognized agent accounts remain supported.

All required capture batches were present, so no network fetch was necessary. Nevertheless, 111 historical body states and two label states could not be reconstructed. Those remain unavailable; today's text was not substituted. The report includes hashes of the consumed evidence and cached PR records.

There are 10,778 heuristic exact-model observations, separate from zero head-bound executed-model metadata observations. Generic agent or harness evidence must not become an exact-model claim. Existing reporting and routing suppression remains in force.

The four exploratory rules are limited to affirmative disclosures outside fenced code and HTML template comments. They include explicit AI-generated-change statements, agent-authored statements, named Mintlify/Inkeep creator signatures, and checked affirmative Airflow AI-coauthor disclosures naming a tool. The Mintlify agent is documented as an AI writing tool in its [official launch announcement](https://www.mintlify.com/blog/agents-launch); a Mintlify account without a declaration is still insufficient evidence for a particular PR.

## Evidence review

A deterministic, stratified sample selected up to three baseline positives, three new positives, two bot-only PRs and two unmarked PRs per repository. There were no new positives in protocol 1.0.0, so the actual sample contains 116 items. Sampling used a committed seed and no outcome values beyond the fixed non-null eligibility condition.

I inspected historical bodies, attribution contexts and commit/landing excerpts as an **AI-assisted evidence review**, not independent human ground truth:

| Original stratum           | Reviewed | Clear agent evidence | Ordinary automation | No affirmative evidence | Ambiguous direct authorship |
| -------------------------- | -------: | -------------------: | ------------------: | ----------------------: | --------------------------: |
| Baseline positives         |       54 |                   50 |                   0 |                       0 |                           4 |
| Bot without agent evidence |       26 |                    2 |                  22 |                       0 |                           2 |
| Unmarked                   |       36 |                    3 |                   0 |                      33 |                           0 |

The review found five missed affirmative disclosures: a checked Cursor disclosure, a generic AI-generated-diff statement, an agent-authored statement, and two documentation-agent creator signatures. These motivated the exploratory extension. Four baseline positives require an authorship-scope decision: one refers to an AI-written reproduction example explicitly not intended for commit, and three inherit markers through upstream subtree imports. Do not silently turn these into claims that the PR's author used an agent to write its merged changes.

The unmarked cases do not establish human authorship. The ordinary-automation category describes the observed workflow, not the origin of every line transported by codeflow or dependency updates. The sample is not self-weighting, so 50/54 must not be reported as population precision.

**Independent human precision remains pending.** A separate, unfilled human label sheet and historical-evidence packet are prepared outside git. AI verdicts are stored separately. Only aggregates and evidence hashes are committed; raw bodies, author identities, sample IDs and per-PR labels are kept private. The automated pass preserves an existing reviewer sheet on re-run.

The [auditor brief](./attribution-auditor-brief.md) defines the task and verdicts.
The handoff sheet omits detector strata and AI verdicts; those remain on the
analysis side for joining and weighting after the auditor returns labels.

## Proposed replacement for the attribution gate

Replace “≥60% attribution on six external repos” as a prerequisite for general-repo reports with the following, subject to an explicit program decision:

1. Retain the existing ≥10-repo label analysis and ≥12 genuine rendered-report requirements.
2. Measure and display attribution coverage and unknowns for every repo. A low positive-evidence fraction does not block descriptive reporting or author-agnostic scoring.
3. Require the observed agent sample to support agent-specific analysis: at least 20 identified agent PRs per displayed repo/horizon cell, with at least six qualifying external repos for the program's agent-segment validation. Fifteen of the current 18 repos have at least 20 baseline agent-marked PRs, although horizon/outcome/metric-specific suppression must still be checked. Do not substitute the all-PR count for the agent count.
4. Retain independent manual validation of attribution, reporting precision, ambiguity, sample sizes and uncertainty. Agree any new numerical quality threshold before a fresh validation pass; do not choose one to fit this AI review.
5. Preserve all existing positive-outcome, exact-model, execution-evidence and routing gates. These proposed attribution changes do not permit claims about defects, autonomous merging, model quality or model identity.

This separates product applicability from the fraction of a repo's contributors who leave AI disclosures. The observed modest increase from 23.91% to 24.86% supports measuring honest coverage rather than selecting repos to manufacture 60%. The proposal is not an adopted change, and the current gate is not marked passed.

## Reproduction and outputs

```sh
pnpm --filter @hokusai/core build
pnpm --filter @hokusai/scan build
node scripts/corpus/attribution-pass.mjs \
  --cache-dir /path/to/arbiter-corpus \
  --out /tmp/hok-2822-results \
  --private-out /tmp/hok-2822-private-review
node --test scripts/corpus/attribution-pass.test.mjs
```

The private output must be outside a git work tree. It contains `human-review.md` (prepared in this run), `review-evidence.jsonl`, `review-labels.json`, separate `ai-evidence-review.json` (reviewed in this run), and a derived per-PR inventory for further local analysis. The measurement command generates the evidence and blank sheet; it does not generate or impersonate independent review labels.

- [Predeclared protocol](../../fixtures/arbiter/corpus/hok-2822-attribution-protocol.json)
- [Exploratory extension declaration](../../fixtures/arbiter/corpus/hok-2822-attribution-extension.json)
- [Full results and per-signal contributions](../../fixtures/arbiter/corpus/hok-2822-full-attribution.md)
- [Counts and source provenance](../../fixtures/arbiter/corpus/hok-2822-full-attribution.json)
- [Aggregate AI review and limitations](../../fixtures/arbiter/corpus/hok-2822-attribution-review.json)

The next external input is independent human labels and a program decision on the proposed gate. The report-rendering work remains separate under HOK-2822.
