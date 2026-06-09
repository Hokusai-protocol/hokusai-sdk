---
description: Inspect, audit, and clear Hokusai's local plugin state
argument-hint: list | preview <id> | audit | clear --all|--records|--audit --yes | reporting on|off|status
allowed-tools: Bash(hokusai-privacy:*)
---

Use `hokusai-privacy list` to show recent routing decisions and `hokusai-privacy preview <id>` to inspect one stored record. Use `hokusai-privacy audit` to review submission history.

Use `hokusai-privacy reporting status` to check whether outcome reporting is enabled, and `hokusai-privacy reporting on|off` to change the persistent default.

Use `hokusai-privacy clear --records --yes`, `--audit --yes`, or `--all --yes` only when the user explicitly asks to delete local Hokusai state. Surface that `clear --all --yes` is irreversible before running it.
