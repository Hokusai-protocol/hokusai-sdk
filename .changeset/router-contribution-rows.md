---
'@hokusai/router': minor
---

`route.reportOutcome()` now submits a Model 30 contribution row instead of
posting to the legacy `/outcomes` endpoint.

The old call was broken twice over. `OUTCOME_PATH` is `/v1/outcomes`, which does
not exist — the live API serves `/api/v1/outcomes` — so every report threw
`HokusaiApiError: Not Found`. And even fixed, that endpoint is the surface
`docs/reference-pattern.md` forbids for new integrations: it patches an inference
log and bypasses training and reward attribution entirely, so the router's own
README promise that reporting "trains the router and mints tokens" was false.

Outcomes are now attributed to their route through `inference_log_id` and
submitted via `submitContribution`. `reportOutcome` takes `actualCostUsd` and
`wallClockSeconds`; the coarse `latency`/`cost`/`tokens` buckets are gone, as a
contribution row has no field for them. The server's fidelity tier is returned,
and the router warns when a row is not `training_eligible` — including when
`actualCostUsd` is omitted, which silently reduces a contribution to telemetry.
