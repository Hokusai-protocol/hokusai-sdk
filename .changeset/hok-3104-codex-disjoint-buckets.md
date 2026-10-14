---
'@hokusai/costs': minor
'@hokusai/core': patch
---

Fix Codex double-billing of cached input and reasoning tokens (HOK-3104). Codex `token_count` events report `cached_input_tokens` as a subset of `input_tokens` and `reasoning_output_tokens` as a subset of `output_tokens`; the SDK now normalizes to disjoint buckets on ingest and no longer adds reasoning onto output when pricing. Concretely: the Codex source adapter subtracts `cache_read + cache_write` from `input_tokens` (clamped at zero, with a new `codex_cache_exceeds_input` source diagnostic on underflow), `billableOutputTokens` returns `usage.output_tokens` for every harness, and `computeActualCostUsd` now prices OpenAI cache tokens at the shared `CACHE_READ_INPUT_MULTIPLIER` / `CACHE_WRITE_INPUT_MULTIPLIER` (Gemini stays refused). `PROVIDER_CONTRACT_VERSIONS.codex` advances `codex/1` → `codex/2`. Codex estimates decrease on cache-heavy sessions (≈6.9× on the real rollout that motivated this fix). Historical `codex/1` ledger rows keep their old interpretation — use the `provider_contract_version` field as the discriminator for any downstream re-pricing.
