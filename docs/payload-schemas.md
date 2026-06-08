# Payload Schemas

`@hokusai/core` now exposes two shared wire payloads for the Hokusai API client.

## Route request

`HokusaiClient.route()` accepts `RouteRequest`, which reuses the existing dispatch payload shape:

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

Example response:

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
  taskId: string;
  status: 'accepted' | 'completed' | 'failed';
  summary: string;
  correlationId?: string;
  metadata?: Record<string, string>;
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
