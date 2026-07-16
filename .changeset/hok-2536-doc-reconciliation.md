---
'@hokusai/core': patch
---

Reconcile SDK docs with shipped behavior. The reference-pattern doc, the
reference-harness README, and the SDK overview described a silent registry-default
fallback for `mapRecommendation()` that the code has never performed — it throws
`ModelMappingError` with `UNKNOWN_MODEL`, `PROVIDER_NOT_ALLOWED`, or
`MODEL_UNAVAILABLE` and expects hosts to catch it and either remap from
`error.suggestions` or record a decline. The reference-harness README also
claimed OpenHands lacks a cost-signal surface, which is no longer true: OpenHands
exposes `RouterLLM` plus LLM/conversation metrics, and hosts should feed those
token counts through `computeActualCostUsd()`. Docs-only change; no runtime
behavior changed.
