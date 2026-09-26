---
'@hokusai/scan': patch
'@hokusai/core': patch
---

HOK-2816 (Arbiter S4): extract the survival labeller and candidate feature
extractor out of wavemill into the new `@hokusai/scan` package, with a
`hokusai-scan` CLI and a one-shot `workflow_dispatch` GitHub Action sharing the
same core. `@hokusai/core` gains the frozen `arbiter_survival_label/v1` wire
contract (S2, HOK-2803) — types, thresholds, `buildArbiterSurvivalLabel`,
canonical hashing, JSON Schema, and fixture builders. `@hokusai/scan` joins the
fixed version group at the group's current version.
