---
name: hokusai-route
description: >-
    Gets a Hokusai routing recommendation for a coding task via the
    `hokusai_route` MCP tool, returning the model to use, the reason, and a
    correlation ID. Use when the user asks which model to run a task on, mentions
    Hokusai routing, or runs $hokusai-route.
---

Use this skill when the user wants a Hokusai routing recommendation for a Codex task.

Call the `hokusai_route` MCP tool with the user's task text. Do not invent a recommendation locally.

Pass `maxCostUsd` when the user gives a budget for the task. The eventual outcome is scored against it, and a contribution reported against a route with no budget is filed as telemetry: it trains nothing and earns nothing.

Return the primary model, the reason, the confidence, the alternatives, the correlation ID, and the handoff instruction from the tool response.
