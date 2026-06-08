# Payload Schemas

`@hokusai/core` currently exposes TypeScript-first payload contracts for:

- task input
- dispatch payload
- outcome payload
- consent snapshots
- correlation records
- model definitions

The scaffold is intentionally minimal. Future tasks can harden these contracts into versioned wire schemas once the cross-harness protocol is finalized.

## Task Packet Schema

`@hokusai/core` exposes a canonical `TaskPacket` contract for normalized harness-to-runtime routing context.

Fields:

- `schemaVersion`: exact string literal, currently `1.0.0`
- `userIntent`: non-empty string summarizing the requested outcome
- `taskFamily`: one of `bugfix`, `feature`, `refactor`, `test`, `docs`, `chore`, `investigation`
- `reasoningDepth`: one of `shallow`, `standard`, `deep`
- `repositoryScale`: optional, one of `small`, `medium`, `large`, `xlarge`
- `languageSignals`: optional array of non-empty strings
- `frameworkSignals`: optional array of non-empty strings
- `availableTools`: optional array of non-empty strings
- `constraints`: optional array of non-empty strings
- `modelConstraints`: optional array of non-empty strings
- `providerConstraints`: optional array of non-empty strings

The validator enforces a strict top-level shape. Unknown fields such as raw code, file trees, or other harness-specific blobs are rejected.

Version policy:

- Packets must always include `schemaVersion`.
- Validators accept only the exact exported `TASK_PACKET_SCHEMA_VERSION`.
- Additive optional fields should use a minor or patch version bump.
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
