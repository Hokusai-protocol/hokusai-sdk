# Privacy Model

`@hokusai/core` now exposes one shared redaction engine for task and outcome payload builders.

## Consent settings

- `ConsentSettings` separates routing consent from outcome-reporting consent.
- `resolveConsent()` defaults both `routingEnabled` and `outcomeReportingEnabled` to `false`.
- `canRoute()` reads only `routingEnabled`.
- `canReportOutcome()` reads only `outcomeReportingEnabled`.

## Local store

- `LocalStore` defines the shared interface for correlation records, payload hashes, and submission audit logs.
- `FsLocalStore` is the default filesystem-backed implementation for harnesses that do not have their own config or state system.
- Stored files contain hashes, ids, metadata, and timestamps only. Raw task text, raw code, and raw logs are intentionally excluded.
- `RawPayloadRejectedError` is thrown if a caller attempts to persist known raw-data fields such as `rawTaskText`, `rawCode`, or `rawLog`.

## Retention and deletion

- `pruneExpired(now, policy)` enforces `maxAgeMs` and `maxRecords` independently for correlations, payload hashes, and audit entries.
- `listCorrelations()`, `listAudit()`, and `clear()` provide the primitives adapters need to implement inspect-and-purge commands for local Hokusai state.

## Supported categories

- `secret`: API keys, OAuth-style secrets, GitHub and Slack tokens, and long high-entropy strings
- `token`: bearer tokens, `tok-...` tokens, and `Authorization:` header values
- `credential`: password-like and key-like assignments
- `email`: bounded email addresses
- `url`: `http` and `https` URLs
- `hostname`: bare hostnames after URL redaction
- `org`: known customer or organization names supplied by the caller
- `id`: caller-supplied custom patterns for proprietary identifiers
- `code`: fenced and indented code blocks
- `log`: timestamped log lines and level-prefixed log lines

## Modes

- `conservative` is the default. It redacts all enabled categories and removes raw code/log blocks from the payload.
- `advanced` keeps the same detectors for secrets, credentials, identifiers, and names, but leaves raw code/log content untouched unless a future mode extends that behavior.

## Deterministic placeholders

- Placeholders are generated with `HMAC-SHA256(value, salt)` and truncated to 8 hex chars.
- The placeholder shape is `CATEGORY_hash`, such as `EMAIL_a3f2c8d1`.
- A non-empty `salt` is required for both redaction and payload hashing.
- Placeholder records never store original values. Summaries expose only category, placeholder, and count.

> **Security note — salt**: `DEFAULT_REDACTION_CONFIG` ships with a public salt
> (`hokusai-default-redaction-salt`). Because this salt is published with the package,
> anyone who knows it can pre-compute HMAC tokens for common values (email addresses,
> key prefixes, etc.) and correlate them across payloads. **Always supply a private,
> application-specific salt when constructing a `RedactionConfig` for production use.**
> Spreading `DEFAULT_REDACTION_CONFIG` without overriding `salt` is safe only in
> test environments where no real sensitive data is processed.

## Payload hashing

- `hashPayload(payload, salt)` accepts strings or objects.
- Objects are recursively normalized to sorted keys before hashing.
- The output is a deterministic lowercase 64-char hex digest.

## Preview guarantees

- `preview(input, config)` returns the exact redacted payload that would be sent in `willSend`.
- `redactionSummary` includes counts only.
- No preview field includes original sensitive values.
- Task-packet builders should redact user-supplied array fields such as `constraints`, `availableTools`, and provider/model hints entry-by-entry, so customer names and internal identifiers do not survive outside free-text fields.
