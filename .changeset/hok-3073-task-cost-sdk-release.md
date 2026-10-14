---
'@hokusai/costs': minor
---

First public drop-in task-cost API (HOK-3073). `measureTask(options, fn)` wraps one run — capturing usage from a live emitter, an (async) iterable, or Claude Code/Codex session files behind an explicit boundary — and returns a typed `TaskCostReport`: total, per-model and per-harness breakdowns, usage, cost source/basis, pricing snapshot, coverage, diagnostics, and the raw contract summaries. `createTaskCostTracker` gives other hosts explicit `record`/`recordUsage`/`summary`/`flush`/`reset`, with `fromAnthropicUsage`/`fromOpenAIUsage` payload mappers and `toLedgerEntries` for opt-in ledger persistence.

Offline guarantee: no network calls, no `HOKUSAI_API_KEY` read, no default disk writes, nothing submitted — routing and contribution stay optional. Automatic capture requires supported usage events or session files; otherwise call `tracker.recordUsage`. An unknown model yields `null`, never `$0`. Compatibility: `resolveActualCostUsd` and `route.reportOutcome` are unchanged; bridge with `actualCostUsd: cost.totalUsd ?? undefined` (a null partial total is passed as absent, never `0`). Rollback is a revert/deprecate — the release is purely additive, and ledger files stay readable.
