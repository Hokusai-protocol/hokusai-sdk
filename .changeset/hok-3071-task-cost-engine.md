---
'@hokusai/costs': minor
---

New package: provider-neutral task cost engine (HOK-3071). `createTaskCostEngine` accepts friendly usage inputs or pre-built `TaskCostEventV1` records for one task, prices each event (host override > built-in table, with caller-supplied estimates and provider-reported charges taking their contractual precedence), stamps price provenance per row, dedupes by `event_id`, and delegates summaries to `@hokusai/core`'s `aggregateTaskCost`. Unknown prices stay `null` with diagnostics — never `$0`. Works fully offline; `@hokusai/core` behavior is unchanged.
