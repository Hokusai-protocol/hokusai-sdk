---
'@hokusai/core': minor
---

Add normalized OutcomeReport schema and buildOutcomeReport/previewOutcomePayload builder helpers. Schema covers all completion states (succeeded/failed/abandoned/overridden/partial), coarse latency/cost/token buckets, build/test summaries, and a versioned extensions field. Notes are redacted automatically; raw-content keys are rejected.
