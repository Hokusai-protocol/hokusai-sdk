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

The plugin resolves the run's actual cost automatically where possible, using this precedence (first that yields a number wins):

1. `--actual-cost-usd <amount>` — an explicit dollar cost you pass, e.g. `--actual-cost-usd 0.32`.
2. `--input-tokens <n>` and `--output-tokens <n>` — priced from the resolved model's Anthropic price table.
3. **Statusline sidecar diff** — if the optional Hokusai statusline is enabled, the plugin diffs the session's cumulative cost between route time and report time to attach Claude Code's own exact number. No flags needed.
4. **Transcript best-effort** — otherwise the plugin reads the session transcript's per-turn token `usage` (numeric fields only, never message text) for turns after the route and prices them.
5. If none of the above yield a value, `actual_cost_usd` is omitted and the row is submitted as telemetry.

- Pass `--wall-clock-seconds <n>` for the run duration.
- A training-eligible contribution requires both a budget (supplied at route time via `--max-cost-usd`) and an actual cost. With the statusline enabled (or usable token counts), the actual cost is captured for you; without either, pass `--actual-cost-usd`. Do not fabricate values the user did not provide.

### Exact cost via the Hokusai statusline (optional, recommended)

Claude Code exposes cumulative cost only through the statusline. Enabling the bundled Hokusai statusline gives tier 3 above — Claude's exact per-task dollar figure — with zero flags at report time. It is opt-in because the statusline is single-slot; the plugin never installs or overwrites it. See `statusline/README.md` in the plugin for the one-line settings.json snippet. Without it, the plugin still best-effort-derives cost from the transcript (tier 4), and without either you can always pass `--actual-cost-usd`.
