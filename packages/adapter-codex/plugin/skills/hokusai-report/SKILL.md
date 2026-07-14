---
name: hokusai-report
description: >-
    Reports the outcome of a Hokusai-routed task via the `hokusai_submit_outcome`
    MCP tool, previewing the anonymized payload before anything is sent. Use when
    the user wants to report, submit, or contribute the result of a routed task,
    or runs $hokusai-report.
---

Use this skill when the user wants to report the outcome of a routed Codex task.

If `hokusai_prompt_outcome_contribution` produced a report command from a successful hook event, treat that as the user starting the normal report flow, not as approval to send.

Always call `hokusai_submit_outcome` once without `approve: true` to preview the anonymized payload first.

Only call `hokusai_submit_outcome` with `approve: true` after the user explicitly approves sending the previewed report.

Pass `actualCostUsd` — what the run actually cost in USD. The server scores it against the budget the task was routed under, and an outcome without it is stored as telemetry: it trains nothing and earns nothing. If you do not know the cost, ask the user rather than omitting it or guessing.

The outcome is submitted as a contribution row against the route it belongs to, so a task must be routed with `$hokusai-route` before its outcome can be reported.
