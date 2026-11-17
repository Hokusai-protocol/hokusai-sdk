---
"@hokusai/costs": minor
---

Export `fromCodexUsage` and `CodexUsageDiagnostics` for harnesses consuming Codex CLI usage. The rollout adapter uses the same cache normalization: subtract cache reads/writes from inclusive input, clamp underflow with an optional count-only diagnostic, keep unreported counters null, and retain reasoning as an informational subset of output. The `codex/2` contract and historical golden fixtures are unchanged.
