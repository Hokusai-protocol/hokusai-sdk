---
'@hokusai/core': minor
'@hokusai/adapter-claude-code': minor
'@hokusai/adapter-codex': minor
'@hokusai/adapter-wavemill': minor
---

Add model registry alias resolution, availability constraints, and `mapRecommendation`
helper to `@hokusai/core`. Export `ANTHROPIC_MODELS` constant and `ModelMappingError`
with structured error codes. Wire Anthropic-only enforcement into the Claude Code adapter
and configurable model lists into the Codex and Wavemill adapters.
