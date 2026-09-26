---
'@hokusai/scan': minor
---

HOK-2820 (Arbiter P2.S1): shadow-mode Survival Check. Adds the
`hokusai-scan report` subcommand and `report` Action mode (new inputs
`inputs-path`, `report-format`, `report-horizon`, plus the previously
unmapped `max-prs`): aggregates accumulated label JSONL and per-PR
candidate-feature JSON into a per-repo `shadow_repo_report/v1` — would-be
flag rate and would-be precision under a transparent placeholder rule
(`placeholder-untested-risky-change/v1`, labelled "placeholder rule, no
trained model yet" on every line), with precision suppressed below 5
reworked PRs. Ships the scheduled shadow-mode workflow template
(`action/shadow-mode-workflow.yml`; the old `example-workflow.yml` is now
`adhoc-workflow.yml`) and the library surface (`aggregateShadowScans`,
`evaluateShadowRule`, `renderShadowReportMarkdown`).
