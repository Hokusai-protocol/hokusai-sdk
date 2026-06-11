# Privacy Model

This document defines the shared privacy posture for Hokusai adapters, including Claude Code, Codex, and future harness integrations built on `@hokusai/core`.

## Shared guarantees

- API keys are env-only by default. `HOKUSAI_API_KEY` is read from environment config, explicit embedding overrides can replace it at runtime, and local plugin config stores reject any attempt to persist `apiKey`.
- Consent is split between routing and telemetry. `HOKUSAI_ROUTING_CONSENT` controls task routing, `HOKUSAI_OUTCOME_OPT_IN` controls outcome submission, both default to `false`, and normal adapter precedence is `env > stored > default`.
- Local storage keeps correlation ids, timestamps, bounded metadata, submission audit entries, and HMAC hashes only. Raw prompts, code, logs, and outcome notes are not persisted.
- Adapters expose redacted previews before network submission for both routing payloads and outcome reports.

## Consent and auth

- `resolveConsent()` defaults both routing consent and outcome opt-in to `false`.
- `canRouteWithAuth()` requires both an API key and routing consent.
- `canSubmitOutcomeWithAuth()` requires an API key, routing consent, and separate outcome opt-in.
- Supported user-facing env vars are `HOKUSAI_API_KEY`, `HOKUSAI_ROUTING_CONSENT`, `HOKUSAI_OUTCOME_OPT_IN`, and `HOKUSAI_MODEL_ALLOWLIST`.
- Truthy env values are `true`, `1`, and `yes`, case-insensitive. Any other value is treated as `false`.
- Routing and outcome submission are independently controllable, but outcome transport still depends on routing auth and consent being enabled.
- The allowlist is Anthropic-only. Unsupported or non-Anthropic recommendations are rejected with allowlisted suggestions when available.
- The Codex plugin is stricter: it reads `HOKUSAI_API_KEY` from the environment only, never persists it, and allows only OpenAI recommendations.
- For end-user plugin behavior, stored defaults can be overridden by env values. For embedding callers using `loadPluginConfig()`, explicit code-level overrides still win over env.

## API key handling

- `PluginConfigStored` intentionally excludes `apiKey`.
- `LocalStorePluginConfigStore.write()` and `FilePluginConfigStore.write()` reject configs that contain `apiKey`.
- `redactPluginConfig()` reports only `<set>` or `<unset>` plus an optional last-4 fingerprint so status and doctor output never expose the raw key.

## Local storage denylist

The local persistence layer enforces a write-time denylist for raw payload fields. Attempts to store any of the following fields raise `RawPayloadRejectedError`:

- `rawTaskText`
- `rawCode`
- `rawLog`
- `prompt`
- `rawPrompt`
- `rawContent`

This denylist applies to persisted local records. It does not mean those fields can never exist in in-memory route or outcome payload builders before redaction.

## Codex plugin posture

- Codex exposes routing and outcome reporting through an MCP stdio server plus four skills: `$hokusai-route`, `$hokusai-report`, `$hokusai-privacy`, and `$hokusai-doctor`.
- `hokusai_preview_route_payload` and outcome preview flows do not require network access or consent.
- `hokusai_submit_outcome` requires both `HOKUSAI_OUTCOME_OPT_IN=true` and an explicit approval flag before transport.

## What local state keeps

- Correlation records keep `correlationId`, `packetHash`, `createdAt`, and optional string metadata.
- Submission audit entries keep `kind`, `status`, `timestamp`, `correlationId`, and an optional redacted error string.
- Payload hash records keep only the digest, algorithm, and timestamp so users can verify what was sent without storing the original text.
- `hashPayload()` uses HMAC-SHA256 over normalized payload content.
- Redaction placeholders from `makePlaceholder()` also use HMAC-SHA256 and expose only category-tagged placeholder tokens.

## Retention and pruning

- The default local retention policy is 7 days and 200 records.
- `HOKUSAI_RETENTION_DAYS` overrides the age window only when it is a positive integer.
- Invalid `HOKUSAI_RETENTION_DAYS` values fall back to 7 days with a warning instead of disabling pruning.
- `pruneExpired(now, policy)` enforces age and record-count limits independently for correlations, payload hashes, and audit entries.
- Adapters prune lazily during privacy inspection flows, so expired records disappear on read as well as during explicit clear operations.

## Preview before send

Adapters should show the exact redacted payload before network submission at both layers:

- Route/task previews: `previewClaudeCodeTaskPacket()`, `previewCodexTaskPacket()`, and `previewRoutePayload()`
- Outcome/report previews: `previewReportOutcome()`, `previewCodexOutcomeReport()`, and CLI flows such as `hokusai-report --preview`

Previews return the redacted content that would be sent. They do not reveal original secrets, identifiers, or customer text.

## Claude Code example flows

Claude Code is one implementation of this shared policy:

- `hokusai-privacy list`, `preview`, and `audit` inspect retained local state after lazy pruning.
- `hokusai-privacy clear --all --yes` removes local Hokusai state.
- `hokusai-privacy reporting on|off|status` manages the stored default for outcome opt-in.
- `HOKUSAI_DEBUG=1` is an explicit debug opt-in that stores one truncated redacted preview for routed tasks. It still does not store raw prompts, code, or logs.

See [integration-guide.md](integration-guide.md) for integration guidance and [sdk-overview.md](sdk-overview.md) for the package surface.

## Supported redaction categories

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

- `conservative` is the default. It redacts all enabled categories and removes raw code and log blocks from the payload.
- `advanced` keeps the same detectors for secrets, credentials, identifiers, and names, but leaves raw code and log content untouched unless a future mode extends that behavior.

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
