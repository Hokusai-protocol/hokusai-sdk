---
'@hokusai/adapter-openhands': minor
---

Add `hokusai-openhands-example` (`@hokusai/adapter-openhands` equivalent), a
Python package that wires the OpenHands `RouterLLM` pre-call model selection
hook and the OpenHands SDK metrics (`llm.metrics`,
`conversation.conversation_stats`) into Hokusai. `HokusaiRouteResolver` maps
Hokusai recommendations to configured `llms_for_routing` keys, persists the
`routeId` as `inference_log_id`, and submits one `harness_outcome_row/v1`
contribution row per routed call through the shared integration path.
Unavailable recommendations decline by default with `ModelUnavailableError`,
or substitute a configured fallback when `unavailable_policy="fallback"`.
