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

Run cost:

- `$hokusai-route` records which Codex session made the call, using the
  session id and turn start Codex sends with every MCP tool call (`_meta`).
  It is stored locally only and is never sent to Hokusai.
- `$hokusai-report` then reads that session's rollout under
  `$CODEX_HOME/sessions` (default `~/.codex/sessions`) and reports its token
  usage per model, priced by `@hokusai/costs`. It reads only that one rollout,
  never "the newest".
- The model the rollout shows ran is reported as the executed model. If it
  differs from the model you report, the row records an `observed` override.
- Verified clients: the Codex TUI (codex-cli 0.166.0), the VS Code extension
  (0.164.0-alpha.11.1), and `codex exec`. A client that sends no session
  reports the run as unmeasured.

Examples:

- `$hokusai-route Route this task through Hokusai.`
- `$hokusai-report Preview and submit the outcome for the latest route.`
- `$hokusai-privacy Show Hokusai privacy status.`
- `$hokusai-doctor Diagnose Hokusai setup problems.`

The Codex plugin ships **no hooks**. Codex discovers `hooks/hooks.json` by
convention and trust-gates it at install, so the MVP does not ship one and never
asks you to trust a hook. Report outcomes with `$hokusai-report`.
