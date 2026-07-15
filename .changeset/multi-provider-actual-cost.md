---
'@hokusai/core': minor
---

Extend `actual_cost_usd` capture across providers so OpenHands / Cline / Aider /
LiteLLM host integrations can attach measured or token-derived cost through the
shared `resolveActualCostUsd` helper without duplicating pricing logic. Adds
OpenAI + Google entries to the pricing table, a `normalizeModelId` helper for
provider-prefixed and LiteLLM-style ids, and tightens host-reported validation
so a negative measured cost never passes through. Unknown or malformed ids
continue to yield `undefined` — the row degrades to telemetry, never a
fabricated value.
