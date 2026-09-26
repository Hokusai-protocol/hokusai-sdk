---
'@hokusai/costs': minor
---

Adds opt-in Claude Code, Codex, and generic event-source task-cost adapters
under four `@hokusai/costs/sources/*` subpath imports (HOK-3070). Adapters
correlate exclusively with a caller-supplied task boundary (task id, allowed
session ids, inclusive UTC window), parse line-by-line through an allow-list
projection so raw transcript payloads, prompts, and paths never leave
parsing, and feed the existing `createTaskCostEngine` for pricing and
summaries. Codex sessions prefer `last_token_usage` and derive per-turn
deltas from cumulative counters when only totals ship. Unreadable files and
unrecognized rows produce count-only diagnostics instead of paths. The root
`@hokusai/costs` barrel is unchanged.
