---
'@hokusai/core': minor
'@hokusai/costs': minor
---

Price OpenAI Fast-mode usage. `computeActualCostUsd` accepts `serviceTier: 'fast'` and bills 2x Standard for the models in `OPENAI_FAST_TIER_MODELS`; any other model yields no cost. The Codex source now prices responses recorded with `service_tier: "priority"` (Fast mode) at Fast rates instead of leaving them unpriced. Other tier values are still left unpriced with `unpriced_service_tier`.
