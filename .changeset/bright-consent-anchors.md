---
'@hokusai/core': minor
---

Add shared consent, retention, payload preview, and local-state abstractions: `ConsentConfig` with independent routing and outcome scopes, `HokusaiApiConfig`, `RetentionPolicy`, `PayloadPreviewSettings`, and a `LocalStore` interface with `InMemoryLocalStore` and `FsLocalStore` implementations covering correlation records, payload hashes, and submission audit entries. Raw task text, code, logs, and prompts are rejected at write time, and filesystem identifiers are validated to prevent path traversal.
