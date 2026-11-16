# Provider execution evidence

Router row v4 accepts optional `stage_executions[].provider_executions` and `failure`. Existing rows remain valid. The core types, runtime validators and `schemas/provider-execution.v1.schema.json` own this additive contract. Hosts should use `StageExecutionProjection.providerExecutions` and `failure` with the existing canonical builder.

Each observation joins a stage's task-cost session to its recorded launch attempt IDs and an optional provider response ID. `observationId` supports idempotent replay when a response ID is absent. All identifiers must be pseudonymous before contribution egress. Request restrictions and pricing snapshots describe request intent; `generation` describes observed OpenRouter lookup results. A display name does not verify quantization, deployment, region, or service tier. Those identities remain unknown.

A billed zero is `generation.totalCostUsd: 0`; an unavailable charge is null. Optional token facts preserve unavailable counters as null. Pricing snapshots explicitly distinguish `model` reference prices from `endpoint` prices. No prompt, transcript, payload or arbitrary metadata is allowed. Duplicate provider responses/observations and observations outside the stage's cost sessions are rejected.

`failure.fault_class` carries the existing model/provider/harness/selection/unknown taxonomy. The host's broader circuit eligibility is not a model-quality label. Canonical ingestion preserves infrastructure economics while leaving model success unknown for non-model faults.

Deploy compatible ingestion before enabling an emitting host. Preserve reported charges with their contributor-reported trust: receiving the host's lookup facts is not independent invoice verification. Unbilled observations use existing pricing primitives and explicitly scoped endpoint estimates where available. Partial evidence cannot establish a complete stage total. Provider qualification and selection policies are separate from this contract.
