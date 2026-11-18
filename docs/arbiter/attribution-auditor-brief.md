# Attribution audit: instructions for the reviewer

## Question

For each sampled PR, what evidence available at merge time shows that an AI agent
helped author at least part of the merged change?

This is separate from the rework audit. Do not assess whether the PR was correct,
needed repair, or should have merged. The sample does not use its later rework
outcome, and this audit must not change those outcome labels.

## Materials

- A historical-evidence packet for 116 PRs from 18 repositories.
- An unfilled label sheet with item IDs and PR links. Return those IDs unchanged.
- This brief. AI-generated verdicts are kept separately and should not be included
  in the handoff or used as an answer key.

The packet contains the historical body, branch, labels and commit/landing
excerpts. The local `review-evidence.jsonl` retains full captured commit evidence
for cases where the excerpt is insufficient. Current GitHub text can have changed
since merge; do not use a later edit as historical evidence.

## Verdicts

| Verdict               | Use when                                                                                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent_evidence`      | An affirmative authorship/assistance disclosure, agent co-author or generation signature, attributable agent session, or recognized agent account/branch supports involvement in the merged change. Record what supports it. |
| `ordinary_automation` | The visible evidence supports dependency updates, releases, merge/CI automation or mechanical codeflow, without affirmative agent authorship evidence. This does not prove all transported code was human-written.           |
| `no_evidence`         | The available historical evidence contains no affirmative authorship signal. This does not mean the PR was human-authored.                                                                                                   |
| `ambiguous`           | Evidence conflicts, historical evidence is unavailable, or its scope does not establish agent authorship of the merged change. Explain the uncertainty.                                                                      |

## Important distinctions

- A bot account is not enough: dependency and release bots are ordinary automation.
- If a bot's PR also contains genuine agent authorship evidence, record
  `agent_evidence`; the bot identity does not cancel that evidence.
- A PR implementing an AI feature or mentioning Claude/Copilot is not an AI
  authorship disclosure. Generic tool-topic labels do not establish authorship.
- A checked “yes, AI co-authored this PR” disclosure is evidence; an unchecked
  template is not.
- An AI-written reproduction example that was not committed does not establish
  authorship of the merged change. Use `ambiguous` if that is the only signal.
- Imported upstream/subtree markers establish something about upstream work,
  but may not establish how this PR was authored. Flag the inherited scope.
- Distinguish agent/tool involvement from exact-model identity. Do not infer a
  model version or executed route from a tool name.

## Return format

Fill `verdict`, `reviewer`, `note` and, where useful, `evidence_scope` in the
unfilled sheet. Use one of the four verdicts above and a short evidence-based
note. Suggested scope values are `direct_merged_change`, `inherited_upstream`,
`nonmerged_example`, and `unknown`. An uncertainty is a useful result; do not
force it into a positive or a negative.

Do not inspect or optimize toward a desired coverage or precision percentage.
Do not change sample membership or the original rework judgments. Return the
completed sheet without copying PR text into the aggregate report.

The analysis will join the returned IDs to their sampling strata, retain
ambiguities, and account for unequal sampling probabilities. Raw sample
percentages must not be treated as population precision. Independent human
validation remains pending until the returned sheet is checked.
