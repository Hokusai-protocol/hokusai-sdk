---
description: Get a Hokusai routing recommendation for the task you are about to run
argument-hint: <task description>
allowed-tools: Bash(hokusai-route:*)
---

Use `hokusai-route --json` to route the task text from `$ARGUMENTS`.

- If the command succeeds, read the JSON result and present:
  - the recommended Anthropic model
  - the concise reason
  - confidence, when present
  - alternatives, when present
  - the correlation id used for later outcome reporting
  - the handoff instruction
- Render the handoff slash command as a fenced code block so the user can copy it directly.
- Ask the user: `Accept this recommendation? (yes / no / different)`.
- If the user declines or asks for a different model, call `hokusai-route --decline --correlation-id <id> --reason "<short reason>"` and confirm that the decline was recorded locally.
- If the command fails, surface the remediation hint from stderr verbatim.
- Do not invent a routing recommendation locally.
