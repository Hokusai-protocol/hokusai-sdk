---
"@hokusai/core": minor
"@hokusai/router": minor
---

Add explicit report-only outcome submission for externally selected models and publish the launch-priority model catalog.

`@hokusai/router` now exposes `route.reportExternalOutcome()` for contribution rows where the model was chosen outside Hokusai routing. `@hokusai/core` now exports `OPENROUTER_PRIORITY_MODELS` and `PRIORITY_MODELS`, including Wavemill's launch-priority Claude, GPT, DeepSeek, Qwen, Kimi, GLM, Gemini, Llama, Mistral, and Grok model ids with OpenRouter aliases.
