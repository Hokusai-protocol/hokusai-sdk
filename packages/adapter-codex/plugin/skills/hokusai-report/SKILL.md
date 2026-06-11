Use this skill when the user wants to report the outcome of a routed Codex task.

Always call `hokusai_submit_outcome` once without `approve: true` to preview the anonymized payload first.

Only call `hokusai_submit_outcome` with `approve: true` after the user explicitly approves sending the previewed report.
