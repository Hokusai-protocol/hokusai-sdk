---
'@hokusai/core': minor
'@hokusai/scan': minor
---

Adds `cr-0.3.0`, the defect-repair definition: repair references and regression issues only. It is reported alongside the Rework Risk target and never gates. Calibration scoring shows it as `defect_repair`, a report-only variant that the pick rules skip, so frozen plans pick as before. `corpus-calibration-sample` gains `--exclude-sample <sample.json>` (repeatable), which leaves an earlier sample's PRs out of a new draw and records that sample's SHA-256.
