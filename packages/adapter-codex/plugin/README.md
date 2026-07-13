# Hokusai Codex Plugin

Install from an extracted release zip:

1. Verify the published checksum.
2. Run `codex plugin marketplace add <dir>`.
3. Run `codex plugin add hokusai@hokusai` (the install id is
   `<plugin>@<marketplace>`; a bare `hokusai` is rejected).

Required environment variables:

- `HOKUSAI_API_KEY`
- `HOKUSAI_OUTCOME_OPT_IN=true` for outcome submission

Final verification step:

- Run `$hokusai-doctor` after setting auth.
- Continue only after it reports `Ready to use: yes`.

Privacy posture:

- API key is read from the environment only.
- Previewing route and outcome payloads does not require a network call.
- Post-run hooks only prompt for contribution after likely success and never submit outcomes directly.
- Raw prompts, code, logs, and customer data are rejected from local state writes.
- Local state retains at most 7 days and 200 records by default.

Examples:

- `$hokusai-route Route this task through Hokusai.`
- `$hokusai-report Preview and submit the outcome for the latest route.`
- `$hokusai-privacy Show Hokusai privacy status.`
- `$hokusai-doctor Diagnose Hokusai setup problems.`

Outcome prompt hooks:

- `hokusai-codex-outcome-hook` inspects Stop/PostToolUse events for likely success.
- With `HOKUSAI_OUTCOME_OPT_IN=true`, it prints a `$hokusai-report ...` prompt tied to the latest route.
- Without outcome opt-in, it prints setup remediation and does not provide a submit command.
