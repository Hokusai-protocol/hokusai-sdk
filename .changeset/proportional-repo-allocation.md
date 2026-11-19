---
'@hokusai/scan': minor
---

Calibration plans gain an optional `repo_allocation: { mode: 'proportional', min_per_repo }`. Each repo first gets the floor, and the rest of a stratum's allocation is split by population. Without the field, draws stay round-robin, so frozen plans draw as before. Used by the revert-signal confirmation plan `rs-1.1.0`.
