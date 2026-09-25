---
'@hokusai/core': minor
---

Add the versioned task-cost contract (HOK-3072): `task_cost_event/v1`,
`task_cost_summary/v1`, `task_cost_ledger/v1`, and `task_cost_adapter/v1` types,
runtime validators that reject prompt/transcript/path/credential/account keys,
and `aggregateTaskCost`, a pure reference reducer defining replay,
cumulative-snapshot, and missing-vs-zero semantics. Actual provider charges are
kept distinct from token-equivalent estimates, and subscription cost basis is
explicit. Ships 15 sanitized fixtures (`taskCostFixtures`) with hand-written
expected summaries and a parity check against Wavemill's execution-economics
output. Types, validators, and fixtures only: no runtime behavior changes.
