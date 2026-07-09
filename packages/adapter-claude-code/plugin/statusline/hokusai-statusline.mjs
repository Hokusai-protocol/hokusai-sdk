#!/usr/bin/env node
/**
 * Hokusai statusline for Claude Code (opt-in).
 *
 * Reads Claude Code's statusline JSON from stdin and writes a small sidecar to
 * `<claude-config>/hokusai/session-cost.json` recording the session's cumulative
 * cost. The Hokusai plugin diffs this between route time and report time to
 * attach an exact `actual_cost_usd` to the training contribution. It also prints
 * a minimal passthrough status line so it is usable as a real statusline.
 *
 * Dependency-free and fully defensive: any failure is swallowed so the
 * statusline never crashes Claude Code. It reads only cost/session fields and
 * never inspects prompt or response text.
 *
 * Enable it in your Claude Code settings (settings.json):
 *   {
 *     "statusLine": {
 *       "type": "command",
 *       "command": "node ${CLAUDE_PLUGIN_ROOT}/statusline/hokusai-statusline.mjs"
 *     }
 *   }
 * (or use an absolute path to this file). The statusline is single-slot, so this
 * is never installed automatically.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    try {
      process.stdin.setEncoding('utf8');
    } catch {
      resolve('');
      return;
    }
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

function resolveClaudeConfigDir() {
  const override = (process.env.CLAUDE_CONFIG_DIR || '').trim();
  if (override) {
    return override;
  }
  return path.join(homedir(), '.claude');
}

async function main() {
  const raw = await readStdin();

  let payload = {};
  try {
    payload = JSON.parse(raw) || {};
  } catch {
    payload = {};
  }

  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  const cost = payload.cost && typeof payload.cost === 'object' ? payload.cost : {};
  const costUsd = typeof cost.total_cost_usd === 'number' ? cost.total_cost_usd : undefined;
  const model = payload.model && typeof payload.model === 'object' ? payload.model : {};
  const modelName =
    typeof model.display_name === 'string'
      ? model.display_name
      : typeof model.id === 'string'
        ? model.id
        : '';

  // Persist the sidecar (best-effort; never throws out of here).
  try {
    if (sessionId && costUsd !== undefined) {
      const dir = path.join(resolveClaudeConfigDir(), 'hokusai');
      mkdirSync(dir, { recursive: true });
      const record = {
        session_id: sessionId,
        cost_usd: costUsd,
        updated_at: new Date().toISOString(),
      };
      if (typeof cost.total_input_tokens === 'number') {
        record.input_tokens = cost.total_input_tokens;
      }
      if (typeof cost.total_output_tokens === 'number') {
        record.output_tokens = cost.total_output_tokens;
      }
      writeFileSync(path.join(dir, 'session-cost.json'), JSON.stringify(record), 'utf8');
    }
  } catch {
    // Ignore: the statusline must never fail because the sidecar couldn't write.
  }

  // Minimal passthrough status line.
  const parts = [];
  if (modelName) {
    parts.push(modelName);
  }
  if (costUsd !== undefined) {
    parts.push(`$${costUsd.toFixed(2)}`);
  }
  parts.push('hokusai');
  process.stdout.write(parts.join('  |  '));
}

main().catch(() => {
  // Absolute last resort: emit a stable minimal line.
  try {
    process.stdout.write('hokusai');
  } catch {
    /* noop */
  }
});
