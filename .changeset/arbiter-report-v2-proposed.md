---
'@hokusai/core': minor
---

Propose `arbiter_report/v2` (HOK-2826 step 1): types, a closed JSON Schema, `validateArbiterReportV2`, and `deriveRetrospectiveCounts`, the single definition of a retrospective result's counts. v2 carries results per target, horizon, calibration and segment, artifact and calibration provenance, and per-PR targets and predictions. Validation recomputes every result from the PR rows. No scanner emits v2 yet; `arbiter_report/v1` is unchanged.
