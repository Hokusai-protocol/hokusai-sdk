---
'@hokusai/core': minor
---

Add attempt identity to the task-cost contract (HOK-3372, contract `1.1.0`, `task_attempt/v1`): minted `run_id`, `pair_id`, `arm_id` and `stage_attempt_id` with typed `parent_id` / `retry_of` edges; control writes accepted only for the current, unsettled attempt and evidence writes always accepted against their own attempt; versioned evidence with stale-detection for derived results. Ships the JSON schema (`task-attempt.v1.schema.json`, `TASK_ATTEMPT_V1_JSON_SCHEMA`), validators, the `reduceTaskAttemptLog` reference reducer, eight golden fixtures (`taskAttemptFixtures`) and the Wavemill field mapping. `TaskCostEventV1` gains optional `run_id` and `stage_attempt_id`.
