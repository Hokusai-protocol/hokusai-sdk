---
'@hokusai/core': minor
'@hokusai/scan': minor
---

Add the HOK-3269 calibration taxonomy to `@hokusai/core` (verdicts, cause codes, human exclusion codes) and three `hokusai-scan` commands: `corpus-calibration-sample` draws a stratified, seeded sample from the persisted corpus outputs with the evaluation slice excluded; `corpus-calibration-evidence` gathers each item's diffs, candidate fixes and related later PRs plus a blank human-audit sheet; `corpus-calibration-score` reports precision, recall, Cohen's kappa and cause distribution for two model labellers and a human audit, and decides whether the model labels stand in.
