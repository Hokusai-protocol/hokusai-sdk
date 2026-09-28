---
'@hokusai/costs': minor
---

Opt-in task-cost source adapters for Claude Code and Codex (HOK-3070), plus a generic event-source adapter and a Node-only session-file reader, each behind its own subpath export (`@hokusai/costs/sources/claude-code`, `.../codex`, `.../event-source`, `.../node-fs`). Adapters correlate exclusively against an explicit caller-supplied task boundary (task id, session ids, inclusive time window), deduplicate streamed/resumed source rows, prefer provider-reported deltas and cost with cumulative-baseline fallback, and fail soft with count-only diagnostics — raw prompts, transcript text, paths, and identity fields never enter the output. The package root and the generic event engine are unchanged.
