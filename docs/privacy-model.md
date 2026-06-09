# Privacy Model

`@hokusai/core` now exposes one shared redaction engine for task and outcome payload builders.

## Consent settings

- `ConsentSettings` separates routing consent from outcome-reporting consent.
- `resolveConsent()` defaults both `routingEnabled` and `outcomeReportingEnabled` to `false`.
- `canRoute()` reads only `routingEnabled`.
- `canReportOutcome()` reads only `outcomeReportingEnabled`.
- `canRouteWithAuth()` requires both an API key and explicit routing consent.
- `canSubmitOutcomeWithAuth()` requires an API key, routing consent, and a separate outcome opt-in.

## Plugin auth and allowlist

- Plugin defaults are private: `routingConsentEnabled` and `outcomeSubmissionEnabled` both default to `false`.
- Supported env vars are `HOKUSAI_API_KEY`, `HOKUSAI_API_BASE_URL`, `HOKUSAI_ROUTING_CONSENT`, `HOKUSAI_OUTCOME_OPT_IN`, and `HOKUSAI_MODEL_ALLOWLIST`.
- Truthy env values are `true`, `1`, and `yes`, case-insensitive. Any other value is treated as `false`.
- Routing and outcome submission are independently controllable, but outcome transport still depends on routing auth and consent being enabled.
- `redactPluginConfig()` reports only `<set>` or `<unset>` for the key plus an optional last-4 fingerprint.
- Plugin config stores must not persist `apiKey`, and the doctor output never includes the raw key.
- The allowlist is Anthropic-only. Unsupported or non-Anthropic recommendations are rejected with allowlisted suggestions when available.

## Local store

- `LocalStore` defines the shared interface for correlation records, payload hashes, and submission audit logs.
- `FsLocalStore` is the default filesystem-backed implementation for harnesses that do not have their own config or state system.
- Stored files contain hashes, ids, metadata, and timestamps only. Raw task text, raw code, and raw logs are intentionally excluded.
- `RawPayloadRejectedError` is thrown if a caller attempts to persist known raw-data fields such as `rawTaskText`, `rawCode`, or `rawLog`.

## Retention and deletion

- `pruneExpired(now, policy)` enforces `maxAgeMs` and `maxRecords` independently for correlations, payload hashes, and audit entries.
- `listCorrelations()`, `listAudit()`, and `clear()` provide the primitives adapters need to implement inspect-and-purge commands for local Hokusai state.
- The Claude Code adapter defaults retention to 7 days and 200 records, with `HOKUSAI_RETENTION_DAYS` available as a positive integer override.
- The Claude Code privacy CLI prunes lazily on `list`, `preview`, and `audit`, so expired local state disappears during normal inspection.

## Claude Code local state

- Routing records store correlation ids, timestamps, recommended model ids, alternative model ids, redacted reason previews, payload hashes, and local status metadata.
- Submission audit entries store `routing` or `outcome`, `submitted` or `failed` or `skipped`, a timestamp, correlation id, and an optional redacted error string.
- Payload hash records store only the HMAC digest, algorithm, and timestamp so users can verify what was sent without storing raw text.
- `HOKUSAI_DEBUG=1` is an explicit opt-in that stores a truncated redacted payload preview for routed tasks. It does not bypass redaction and never writes raw prompts, code, or logs.

## Claude Code privacy CLI

- `hokusai-privacy list` shows recent routing decisions.
- `hokusai-privacy preview <correlation-id>` shows one stored decision and, with `--debug`, the saved redacted debug preview when present.
- `hokusai-privacy audit` shows the minimal submission log.
- `hokusai-privacy clear --records --yes`, `--audit --yes`, or `--all --yes` deletes local state.
- `hokusai-privacy reporting on|off|status` controls the persistent outcome-reporting default.

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
