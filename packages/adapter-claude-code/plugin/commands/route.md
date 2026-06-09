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
- If the command fails, surface the remediation hint from stderr verbatim.
- Do not invent a routing recommendation locally.
