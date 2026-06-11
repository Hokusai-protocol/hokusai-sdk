# Hokusai Codex Plugin

Install from an extracted release zip:

1. Verify the published checksum.
2. Run `codex plugin marketplace add <dir>`.
3. Run `codex plugin add hokusai`.

Required environment variables:

- `HOKUSAI_API_KEY`
- `HOKUSAI_ROUTING_CONSENT=true`
- `HOKUSAI_OUTCOME_OPT_IN=true` for outcome submission

Privacy posture:

- API key is read from the environment only.
- Previewing route and outcome payloads does not require a network call.
- Raw prompts, code, logs, and customer data are rejected from local state writes.
- Local state retains at most 7 days and 200 records by default.

Examples:

- `$hokusai-route Route this task through Hokusai.`
- `$hokusai-report Preview and submit the outcome for the latest route.`
- `$hokusai-privacy Show Hokusai privacy status.`
- `$hokusai-doctor Diagnose Hokusai setup problems.`
