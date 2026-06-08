# Privacy Model

The scaffold assumes privacy is enforced by explicit contracts rather than hidden harness behavior.

## Current guarantees

- Consent is represented as typed configuration and validated before dispatch payload creation.
- Prompt anonymization is deterministic and offline.
- Correlation storage is abstracted behind an interface; the default test/example implementation is in-memory only.

## Non-goals

- No telemetry backend is configured.
- No private registry, secret store, or Wavemill runtime state is required.
- No adapter performs network I/O in this scaffold.
