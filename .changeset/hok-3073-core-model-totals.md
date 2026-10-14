---
'@hokusai/core': minor
---

Add `aggregateTaskCostByModel` (with `TaskCostModelTotal`): per-model cost/usage totals for one task, derived from the same replay-resolved, cumulative-reconciled observations as `aggregateTaskCost`, so per-model rows partition the task summary exactly (usage, event counts, and resolved totals sum to the summary's, null-consistent). Purely additive — no contract type, validator, fixture, or `aggregateTaskCost` output changes.
