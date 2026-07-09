---
description: Preview and optionally submit an anonymized Hokusai task outcome report
argument-hint: --correlation-id <id> --recommended-model <id> --actual-model <id> --accepted|--rejected --status <status>
allowed-tools: Bash(hokusai-report:*)
---

Run `hokusai-report --preview --json $ARGUMENTS` first.

- If preview succeeds, show the user the preview payload and explain that raw code, raw prompts, terminal logs, and customer data are excluded by default.
- Only run `hokusai-report --send --json $ARGUMENTS` after the user explicitly approves sending the previewed payload.
- If preview or send fails, surface stderr verbatim, including validation and consent remediation.
- Do not invent or modify the payload locally.

## Cost and duration (recommended)

Include the run's actual cost and wall-clock time so the contribution can become **training-eligible**:

- Pass `--actual-cost-usd <amount>` when you know the dollar cost directly, e.g. `--actual-cost-usd 0.32`.
- Otherwise pass `--input-tokens <n>` and `--output-tokens <n>` and the cost is computed from the resolved model's Anthropic price table. If the model is not in the table the cost is simply omitted.
- Pass `--wall-clock-seconds <n>` for the run duration.
- Note: a training-eligible contribution requires both a budget (supplied at route time via `--max-cost-usd`) and an actual cost here. Without a budget and actual cost, the outcome is still recorded, but only as telemetry. Do not fabricate values the user did not provide.
