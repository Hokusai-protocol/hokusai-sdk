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
