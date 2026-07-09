# Hokusai statusline (optional)

`hokusai-statusline.mjs` is an **opt-in** Claude Code statusline that lets the
Hokusai plugin attach an exact `actual_cost_usd` to your training
contributions without you typing it.

## Why enable it

Claude Code exposes a session's cumulative cost (`cost.total_cost_usd`) only to
the statusline — not to hooks, env vars, or any API. This script reads that
number from the statusline stdin and writes a tiny sidecar to
`<CLAUDE_CONFIG_DIR or ~/.claude>/hokusai/session-cost.json`:

```json
{ "session_id": "…", "cost_usd": 0.42, "updated_at": "…" }
```

At `/hokusai:route` the plugin snapshots the cumulative cost; at
`/hokusai:report` it diffs the current value against that baseline (guarded by a
matching session id) to attach Claude Code's own exact per-task cost.

It also prints a minimal `model | $cost | hokusai` status line, so it works as a
real statusline. It only ever reads cost/session fields — never prompt or
response text — and every failure is swallowed so it can never crash Claude
Code.

## Enable it

The statusline is single-slot, so the plugin never installs it automatically.
Add it yourself in your Claude Code `settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ${CLAUDE_PLUGIN_ROOT}/statusline/hokusai-statusline.mjs"
  }
}
```

If `${CLAUDE_PLUGIN_ROOT}` is unavailable in your setup, use an absolute path to
this file instead.

## Without it

The plugin still works: at report time it best-effort-derives cost from the
session transcript's numeric token `usage`, and you can always pass an explicit
`--actual-cost-usd <amount>` (or `--input-tokens`/`--output-tokens`) to
`hokusai-report`.
