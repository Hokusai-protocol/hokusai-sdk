---
'@hokusai/core': minor
---

Replace the legacy OutcomeReport shape (taskId/status/summary/metadata) and remove the OutcomeStatus union with a normalized schema and builder helpers (buildOutcomeReport, previewOutcomePayload). The new schema covers all completion states (succeeded/failed/abandoned/overridden/partial), coarse latency/cost/token buckets, build/test summaries, and a versioned extensions field. Notes are redacted automatically; raw-content keys are rejected. This is a breaking change to the public OutcomeReport interface for any consumer that imported the prior shape.
