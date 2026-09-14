# Payload Schemas

`@hokusai/core` exposes the SDK payloads adapters use locally and the wire payload sent to the Hokusai Technical Task Router.

## Route request

`HokusaiClient.route()` accepts `RouteRequest`, which reuses the SDK dispatch payload shape:

```ts
interface RouteRequest {
  task: {
    id: string;
    prompt: string;
    metadata?: Record<string, string>;
  };
  prompt: string;
  consent: {
    subjectId: string;
    grantedScopes: string[];
  };
  model: {
    id: string;
    provider: string;
    capabilities: string[];
  };
  correlation: {
    taskId: string;
    correlationId: string;
    createdAt: string;
  };
  redactions: Array<{
    label: string;
    value: string;
  }>;
  createdAt: string;
}
```

Before transport, the client converts that SDK payload into the published Technical Task Router prediction request:

```ts
interface TechnicalTaskRouterRequest {
  inputs: {
    task_type: string;
    language: string;
    domain: string;
    complexity: string;
    repo_size_bucket: string;
    files_touched_bucket: string;
    description_length_bucket: string;
    is_greenfield: string;
    is_migration: string;
    requires_tests: string;
    cross_service: string;
    ui_heavy: string;
    risk_level: string;
    max_cost_usd: string;
    available_planner_models: string;
    available_coder_models: string;
    available_reviewer_models: string;
    planner_model: string;
    planner_agent: string;
    coder_model: string;
    coder_agent: string;
    reviewer_model: string;
    reviewer_agent: string;
    plan_depth: string;
    code_depth: string;
    review_mode: string;
    route_source: string;
    router_mode: string;
    routing_mode: string;
    expected_success_probability: string;
    expected_cost_usd: string;
    confidence: string;
    risk_score: string;
    score: string;
    score_band: string;
    under_budget: string;
    actual_cost_usd: string;
    actual_time_seconds: string;
    intervention_count: string;
    workflow_cost_status: string;
    budget_violation: string;
    rubric_version: string;
    rubric_criterion_count: string;
    rubric_mean_score: string;
    rubric_completeness: string;
    rubric_correctness: string;
    rubric_code_quality: string;
    rubric_intervention_impact: string;
    rubric_autonomy: string;
    rubric_determinative_boundary: string;
    rubric_provenance: string;
  };
}
```

The wire endpoint is:

```text
POST https://api.hokus.ai/api/v1/models/30/predict
```

`HokusaiClient.route(..., { dryRun: true })` returns the converted `TechnicalTaskRouterRequest`.

The Codex plugin exposes this route flow over MCP as `hokusai_route` and exposes the consent-free preview path as `hokusai_preview_route_payload`.

The client normalizes the prediction response back to the SDK `RouteResponse` shape:

```json
{
  "routeId": "route_123",
  "taskId": "task-1",
  "status": "accepted",
  "requestId": "req_123"
}
```

## Outcome report

`HokusaiClient.reportOutcome()` accepts `OutcomeReport`:

```ts
interface OutcomeReport {
  schemaVersion: '1';
  correlationId: string;
  recommendedModel: string;
  actualModel: string;
  recommendationAccepted: boolean;
  completionStatus:
    | 'succeeded'
    | 'failed'
    | 'abandoned'
    | 'overridden'
    | 'partial';
  userRating?: 1 | 2 | 3 | 4 | 5;
  latencyBucket: 'low' | 'medium' | 'high';
  costBucket: 'low' | 'medium' | 'high';
  tokenBucket: 'low' | 'medium' | 'high';
  build?: {
    status: 'passed' | 'failed' | 'skipped';
    failures?: number;
  };
  test?: {
    status: 'passed' | 'failed' | 'skipped';
    failures?: number;
  };
  notes?: string;
  extensions?: {
    version: string;
    data: Record<string, unknown>;
  };
}
```

Fields:

- `schemaVersion`: required exact string literal, currently `1`
- `correlationId`: required non-empty route decision or correlation identifier
- `recommendedModel`: required non-empty model id recommended by the router
- `actualModel`: required non-empty model id actually used by the harness
- `recommendationAccepted`: required boolean indicating whether the recommendation was followed
- `completionStatus`: required outcome category, one of `succeeded`, `failed`, `abandoned`, `overridden`, or `partial`
- `userRating`: optional integer from `1` through `5`
- `latencyBucket`: required coarse latency signal, one of `low`, `medium`, `high`
- `costBucket`: required coarse cost signal, one of `low`, `medium`, `high`
- `tokenBucket`: required coarse token-usage signal, one of `low`, `medium`, `high`
- `build`: optional build summary with `status` and optional non-negative `failures`
- `test`: optional test summary with `status` and optional non-negative `failures`
- `notes`: optional redacted notes string; `buildOutcomeReport()` redacts sensitive content before submission
- `extensions`: optional versioned harness-specific metadata container

`extensions` contract:

- Harness-specific metadata must live under `extensions.data`.
- `extensions.version` is required whenever `extensions` is present.
- `extensions.data` must be an object.
- Additive harness changes should rev the extension version without changing the shared top-level schema.

Raw content fields are rejected. Unknown keys such as `prompt`, `code`, `logs`, or unversioned harness blobs fail validation.

Example outcome payload:

```json
{
  "schemaVersion": "1",
  "correlationId": "route-codex-001",
  "recommendedModel": "gpt-5-codex",
  "actualModel": "gpt-5-codex",
  "recommendationAccepted": true,
  "completionStatus": "succeeded",
  "userRating": 5,
  "latencyBucket": "medium",
  "costBucket": "low",
  "tokenBucket": "high",
  "build": {
    "status": "passed"
  },
  "test": {
    "status": "passed",
    "failures": 0
  },
  "notes": "Reached <redacted:id> after notifying EMAIL_1234abcd",
  "extensions": {
    "version": "1",
    "data": {
      "harness": "codex",
      "toolCalls": 12
    }
  }
}
```

Example response:

```json
{
  "taskId": "task-1",
  "status": "accepted",
  "requestId": "req_124"
}
```

`204 No Content` is also treated as success for outcome reporting and is surfaced as:

```json
{
  "taskId": "task-1",
  "status": "recorded",
  "requestId": "req_124"
}
```

## Validation errors

Both methods validate requests before any network call. Validation failures use `HokusaiValidationError` with structured `fieldErrors`:

```json
[
  {
    "path": "task.id",
    "message": "Value must not be empty.",
    "code": "required"
  }
]
```

## Task Packet Schema

`@hokusai/core` exposes a canonical `TaskPacket` contract for normalized harness-to-runtime routing context.

Fields:

- `schemaVersion`: exact string literal, currently `1.1.0`
- `userIntent`: non-empty string summarizing the requested outcome
- `taskFamily`: one of `bugfix`, `feature`, `migration`, `refactor`, `test`, `docs`, `infra`, `mixed`, `chore`, `investigation`
- `reasoningDepth`: one of `shallow`, `standard`, `deep`
- `repositoryScale`: optional, one of `small`, `medium`, `large`, `xlarge`
- `languageSignals`: optional array of non-empty strings
- `frameworkSignals`: optional array of non-empty strings
- `availableTools`: optional array of non-empty strings
- `constraints`: optional array of non-empty strings
- `modelConstraints`: optional array of non-empty strings
- `providerConstraints`: optional array of non-empty strings

The validator enforces a strict top-level shape. Unknown fields such as raw code, file trees, or other harness-specific blobs are rejected.

Claude Code adapters can also expose a dry-run preview path that returns the exact redacted `TaskPacket` payload before submission.

Version policy:

- Packets must always include `schemaVersion`.
- Validators accept only the exact exported `TASK_PACKET_SCHEMA_VERSION`.
- Additive optional fields and additive enum values should use a minor version bump.
- Required-field changes, renamed fields, or removed fields require a major version bump.

Example:

```ts
import { TASK_PACKET_SCHEMA_VERSION, type TaskPacket } from '@hokusai/core';

const packet: TaskPacket = {
  schemaVersion: TASK_PACKET_SCHEMA_VERSION,
  userIntent: 'Fix a failing integration test and verify the package.',
  taskFamily: 'bugfix',
  reasoningDepth: 'standard',
  repositoryScale: 'medium',
  languageSignals: ['TypeScript'],
  frameworkSignals: ['Node.js'],
  availableTools: ['filesystem', 'terminal', 'test runner'],
  constraints: ['Do not include raw code in the packet'],
};
```

## Candidate Feature Schema

`candidate_features/v1` is the strict, flat feature vector shared by every
Implementation Arbiter producer and consumer. `schema_version` must equal
`candidate_features/v1`; every feature key is required; every value is
nullable; and unknown keys are rejected. A zero or `false` value is an
observation. `null` is the only representation of unavailable evidence.

| Group      | Field                        | Type                    | Meaning and null semantics                                                                                              |
| ---------- | ---------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Shape      | `files_touched`              | integer ≥ 0             | Number of changed files. Null when the diff cannot be enumerated.                                                       |
| Shape      | `lines_added`                | integer ≥ 0             | Added diff lines. Null when directional diff statistics are unavailable.                                                |
| Shape      | `lines_deleted`              | integer ≥ 0             | Deleted diff lines. Null when directional diff statistics are unavailable.                                              |
| Shape      | `loc_touched`                | integer ≥ 0             | Added plus deleted lines. Null when the diff cannot be measured.                                                        |
| Shape      | `dependency_depth`           | integer ≥ 0             | Maximum dependency depth reached by changed modules. Null when no supported dependency graph can be derived.            |
| Shape      | `module_hotspot_score`       | number 0–100            | Repository-history hotspot score for changed modules. Null when sufficient history is unavailable.                      |
| Shape      | `diff_uncertain`             | boolean                 | Whether diff parsing produced suspicious measurements. Null when diff analysis was not attempted.                       |
| Static     | `type_errors`                | integer ≥ 0             | Reported type-check errors. Null when no supported type checker completes successfully.                                 |
| Static     | `lint_errors`                | integer ≥ 0             | Reported lint errors. Null when no supported linter completes successfully.                                             |
| Static     | `build_ok`                   | boolean                 | Whether the configured build completed successfully. Null when no build reaches a terminal result or collection fails.  |
| Static     | `complexity_delta`           | number                  | Candidate-minus-base change in the configured complexity metric. Null when both revisions cannot be analyzed.           |
| Test       | `tests_changed`              | boolean                 | Whether test files were added or modified. Null when test files cannot be classified from the diff.                     |
| Test       | `test_pass_rate`             | number 0–1              | Fraction of executed tests that passed. Null when no supported test result completed with a measurable rate.            |
| Test       | `test_runtime_seconds`       | number ≥ 0              | Test execution duration. Null when runtime is not reported.                                                             |
| Intent     | `task_type`                  | closed enum             | Coarse task category. Null when no category can be derived without guessing.                                            |
| Intent     | `language`                   | closed enum             | Dominant implementation language. Null when no supported dominant language can be derived.                              |
| Intent     | `domain`                     | closed enum             | Coarse engineering domain. Null when no domain evidence is available; producers must not default to backend.            |
| Intent     | `complexity`                 | number 0–10             | Normalized estimated task complexity. Null when complexity cannot be derived without a fallback.                        |
| Intent     | `repo_size_bucket`           | closed enum             | Bucketed repository size. Null when repository size cannot be measured.                                                 |
| Intent     | `files_touched_bucket`       | closed enum             | Bucketed changed-file count. Null when the diff cannot be enumerated.                                                   |
| Intent     | `description_length_bucket`  | closed enum             | Bucketed locally inspected task-description length. Null when no task description is available locally.                 |
| Intent     | `is_greenfield`              | boolean                 | Whether the task creates a new subsystem. Null when change kind cannot be classified.                                   |
| Intent     | `is_migration`               | boolean                 | Whether the task includes a schema or data migration. Null when migration intent cannot be classified.                  |
| Intent     | `requires_tests`             | boolean                 | Whether the task intent requires test work. Null when test intent cannot be classified.                                 |
| Intent     | `cross_service`              | boolean                 | Whether the task spans services or repositories. Null when service scope cannot be classified.                          |
| Intent     | `ui_heavy`                   | boolean                 | Whether UI work is substantial. Null when UI intent cannot be classified.                                               |
| Intent     | `risk_level`                 | `low \| medium \| high` | Coarse derived implementation risk. Null when risk cannot be classified from bounded signals.                           |
| Provenance | `touched_out_of_scope_files` | integer ≥ 0             | Count of changed files outside authoritative task scope. Null when scope authority is absent or the scope guard errors. |
| Provenance | `human_intervention_count`   | integer ≥ 0             | Recorded human interventions before arbitration. Null when intervention collection is unavailable.                      |
| Provenance | `review_rounds`              | integer ≥ 0             | Distinct pre-arbitration human review rounds. Null when review history is unavailable.                                  |
| Provenance | `change_requests`            | integer ≥ 0             | Pre-arbitration change-request reviews. Null when review history is unavailable.                                        |
| Provenance | `self_review_iterations`     | integer ≥ 0             | Automated self-review repair iterations. Null when self-review telemetry is unavailable.                                |
| Provenance | `agent_iterations`           | integer ≥ 0             | Recorded implementation iterations before arbitration. Null when iteration telemetry is unavailable.                    |

The exact enum values, producer mappings, and authoritative one-line
definitions are exported as `CANDIDATE_FEATURE_DEFINITIONS`. The Intent fields
reuse `HokusaiTaskDescriptor`; `deriveTaskDescriptor()` remains partial for
Model 30 callers, while `taskDescriptorToCandidateIntent()` adapts its observed
values and lets finalization encode the rest as null.

The checked-in consumer fixture is
`fixtures/arbiter/candidate_features.v1.json`. Run
`pnpm check:candidate-features` to detect schema or fixture drift and
`pnpm export:candidate-features` to regenerate it from a built core package.
