---
'@hokusai/core': minor
---

Replace the legacy OutcomeReport shape (taskId/status/summary/metadata) and remove the OutcomeStatus union with a normalized schema and builder helpers (buildOutcomeReport, previewOutcomePayload). The new schema covers all completion states (succeeded/failed/abandoned/overridden/partial), coarse latency/cost/token buckets, build/test summaries, and a versioned extensions field. Notes are redacted automatically; raw-content keys are rejected.

Breaking: the legacy `OutcomeStatus` type (`'accepted' | 'completed' | 'failed'`) is no longer exported from `@hokusai/core`; outcome status now lives on `OutcomeReport.completion.status` via the richer `CompletionStatus` union. Consumers that imported `OutcomeStatus` should migrate to `CompletionStatus` (or the API-side `OutcomeResponseStatus` for the legacy response shape).
