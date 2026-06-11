---
description: Diagnose Hokusai plugin setup issues
argument-hint: [--config <dir>]
allowed-tools: Bash(hokusai-doctor:*)
---

Run `hokusai-doctor $ARGUMENTS`.

- Show the doctor output directly.
- If it fails, surface stdout and stderr verbatim, including remediation lines from the doctor.
- Do not alter local Hokusai config or consent state unless the user explicitly asks.
