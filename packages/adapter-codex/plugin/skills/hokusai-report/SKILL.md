Use this skill when the user wants to report the outcome of a routed Codex task.

If `hokusai_prompt_outcome_contribution` produced a report command from a successful hook event, treat that as the user starting the normal report flow, not as approval to send.

Always call `hokusai_submit_outcome` once without `approve: true` to preview the anonymized payload first.

Only call `hokusai_submit_outcome` with `approve: true` after the user explicitly approves sending the previewed report.
