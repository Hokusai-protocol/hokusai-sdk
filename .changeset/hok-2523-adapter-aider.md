---
'@hokusai/adapter-aider': minor
---

Add `@hokusai/adapter-aider`, a thin Aider CLI wrapper that routes a task
through Hokusai, launches Aider with the recommended model unchanged, parses
the model/token/cost lines Aider prints, and submits one
`harness_outcome_row/v1` contribution through the shared integration path.
Unknown cost, unpriced models, and failed Aider runs degrade to telemetry-only
rows instead of fabricating an `actual_cost_usd`.
