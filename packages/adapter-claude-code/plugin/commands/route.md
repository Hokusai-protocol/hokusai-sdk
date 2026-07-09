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

## Budget (optional, recommended)

If the user states a cost ceiling for the run, pass it as a budget so the
contribution can become **training-eligible** rather than telemetry-only:

```
hokusai-route --json --max-cost-usd 0.50 --task "$ARGUMENTS"
```

- `--max-cost-usd` takes a dollar amount (e.g. `0.50`). It is persisted with the
  routing decision as the budget and later compared against the actual cost.
- A training-eligible contribution needs both a budget (here) and an actual cost
  at report time. Without a budget, the outcome is still recorded, but only as
  telemetry. Do not invent a budget the user did not give.
- Routing also snapshots a cost baseline so the report step can auto-fill the
  actual cost. For an exact figure, enable the optional Hokusai statusline (see
  `statusline/README.md`); otherwise the plugin best-effort-derives cost from the
  session transcript at report time.

## Applying the result

The user invoked this command to route their task, so **accept the
recommendation automatically** — do not ask them to confirm. Requesting the
route *is* the opt-in, and Claude Code already lets them override the model with
`/model` if they disagree.

- If the command succeeds, read the JSON result and:
  1. Apply the handoff immediately. For the manual mechanism, output the
     handoff slash command (e.g. `/model claude-sonnet-4-6`) as a fenced code
     block on its own line so the model switches, then proceed.
  2. Briefly note what you routed to and why — the recommended Anthropic model,
     the concise reason, and confidence when present. Keep it to a line or two;
     this is a status note, not a prompt for approval.
  3. Retain the correlation id for later outcome reporting.
  4. Carry out the user's task directly under the recommended model.
- Only record a decline if the user *explicitly* asks for a different model
  after the fact: call `hokusai-route --decline --correlation-id <id> --reason
  "<short reason>"` and confirm the decline was recorded locally.
- If the command fails, surface the remediation hint from stderr verbatim. Exit
  code 2 means the API key is missing; relay the hint rather than guessing at
  other invocations.
- Do not invent a routing recommendation locally.
