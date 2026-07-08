---
description: Get a Hokusai routing recommendation for the task you are about to run
argument-hint: <task description>
allowed-tools: Bash(hokusai-route:*)
---

Route the user's task and present the recommendation. The task description is in `$ARGUMENTS`.

## How to call the CLI

Run this exact command, passing the task through the `--task` flag (quote it so the whole description is one argument):

```
hokusai-route --json --task "$ARGUMENTS"
```

- Pass the task text via `--task "<text>"`. A bare positional argument
  (`hokusai-route --json "the task"`) also works, but `--task` is preferred and
  unambiguous. Do not fall back to `--help` or invent other flags.
- If `$ARGUMENTS` is empty, ask the user what task they want routed instead of
  calling the CLI.

## Routing objective (optional)

Routing optimizes for **reliability** by default. If the user asks to optimize
for speed or cost — or you can clearly infer it from their request — add the
`--objective` flag:

```
hokusai-route --json --objective speed --task "$ARGUMENTS"
```

- Accepted values: `speed`, `cost`, `reliability`. Anything else exits with a
  "Unknown routing objective" error — surface it and ask which they meant.
- Do not pass `--objective` unless the user expressed a preference; the default
  already applies reliability. A persistent default can also be set via
  `HOKUSAI_OBJECTIVE` or plugin config, so avoid overriding silently.

## Presenting the result

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
- If the command fails, surface the remediation hint from stderr verbatim. Exit
  code 2 means the API key is missing, 3 means routing consent is not enabled —
  relay the hint rather than guessing at other invocations.
- Do not invent a routing recommendation locally.
