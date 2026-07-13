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

Return the primary model, the reason, the confidence, the alternatives, the correlation ID, and the handoff instruction from the tool response.
