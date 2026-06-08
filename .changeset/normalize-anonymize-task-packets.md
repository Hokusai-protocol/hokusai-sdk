---
'@hokusai/core': minor
'@hokusai/adapter-claude-code': minor
---

Add task-packet normalization and anonymization for Claude Code

**`@hokusai/core`**
- Extend `TaskFamily` union with `bug`, `migration`, `infra`, `mixed` (additive; existing values unchanged)
- Add `anonymizeTaskPacket(packet, config)` helper that applies a `RedactionConfig` to all free-text fields and returns `{ packet, redactions }`
- Export `AnonymizeTaskPacketResult` type

**`@hokusai/adapter-claude-code`**
- Add `buildTaskPacket(input, options?)` — converts a `ClaudeCodeTaskInput` into an anonymized, validated `TaskPacket`
- Add `previewTaskPacket(input, options?)` — returns the same packet plus a redaction summary and deterministic JSON string without any network calls
- Export input/output types: `ClaudeCodeFileSummary`, `ClaudeCodeConstraintsInput`, `ClaudeCodeTaskInput`, `ClaudeCodeBuilderOptions`, `ClaudeCodeTaskPacketPreview`
- Export heuristic helpers (also useful for testing): `classifyTaskFamily`, `bucketRepositoryScale`, `deriveLanguageSignals`, `deriveFrameworkSignals`
