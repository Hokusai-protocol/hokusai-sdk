/**
 * Sanitized JSONL fixture builders for the source-adapter tests (test-only;
 * excluded from the published build).
 *
 * Every generated line is deliberately laced with `SENTINEL_*` values in the
 * fields the adapters must never read — prompts, transcript text, paths,
 * branches, account identity — so the privacy tests can assert by substring
 * that none of it survives into adapter or ledger output. No line contains
 * real transcript content.
 *
 * @module sources/test-support
 */

import type { TaskCostEventV1 } from '@hokusai/core';
import type { TaskCostBoundaryV1 } from './types.js';

/** Case-insensitive marker planted in every field that must never leak. */
export const PRIVACY_SENTINEL = /sentinel/i;

export function boundaryFor(
  taskId: string,
  sessionIds: readonly string[],
  startedAt = '2026-01-01T00:00:00Z',
  endedAt = '2026-01-02T00:00:00Z',
): TaskCostBoundaryV1 {
  return { boundaryVersion: 1, taskId, sessionIds, startedAt, endedAt };
}

// ────────────────────────────────────────────────────────────────
// Claude Code transcript lines
// ────────────────────────────────────────────────────────────────

export interface ClaudeAssistantSpec {
  sessionId: string;
  uuid: string;
  messageId?: string;
  timestamp: string;
  model?: string;
  /** Raw `message.usage` record; pass malformed values to exercise fail-soft. */
  usage?: Record<string, unknown>;
  costUSD?: unknown;
  version?: string;
  isSidechain?: boolean;
  /**
   * `requestId` on the transcript row. Real Claude Code lines always carry
   * one, but fixtures may omit it to keep composed dedupe keys equal to the
   * message id alone (e.g. golden parity tests).
   */
  requestId?: string;
}

export function claudeUsage(
  input: unknown,
  output: unknown,
  cacheRead: unknown,
  cacheWrite: unknown,
  thinking: unknown,
): Record<string, unknown> {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheWrite,
    output_tokens_details: { thinking_tokens: thinking },
  };
}

export function claudeAssistantLine(spec: ClaudeAssistantSpec): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: spec.uuid,
    parentUuid: `${spec.uuid}-parent`,
    sessionId: spec.sessionId,
    timestamp: spec.timestamp,
    version: spec.version ?? '2.1.0',
    cwd: '/Users/sentinel-user/SENTINEL_PATH/repo',
    gitBranch: 'SENTINEL_BRANCH',
    userType: 'external',
    ...(spec.requestId !== undefined ? { requestId: spec.requestId } : {}),
    ...(spec.isSidechain !== undefined ? { isSidechain: spec.isSidechain } : {}),
    ...(spec.costUSD !== undefined ? { costUSD: spec.costUSD } : {}),
    message: {
      id: spec.messageId ?? `${spec.uuid}-msg`,
      role: 'assistant',
      model: spec.model ?? 'claude-sonnet-5',
      content: [{ type: 'text', text: 'SENTINEL_TRANSCRIPT_TEXT' }],
      usage: spec.usage ?? claudeUsage(1000, 500, 0, 0, 0),
    },
  });
}

export function claudeUserLine(sessionId: string, timestamp: string): string {
  return JSON.stringify({
    type: 'user',
    uuid: `user-${timestamp}`,
    sessionId,
    timestamp,
    cwd: '/Users/sentinel-user/SENTINEL_PATH/repo',
    gitBranch: 'SENTINEL_BRANCH',
    promptSource: 'typed',
    message: { role: 'user', content: 'SENTINEL_PROMPT do the task' },
  });
}

/** A transcript line reproducing one golden `TaskCostEventV1` exactly. */
export function claudeLineFromGolden(event: TaskCostEventV1): string {
  return claudeAssistantLine({
    sessionId: event.session_id,
    uuid: `uuid-${event.sequence}`,
    messageId: event.event_id,
    timestamp: event.observed_at,
    model: event.observed_model,
    ...(event.harness_version !== undefined
      ? { version: event.harness_version }
      : {}),
    usage: claudeUsage(
      event.usage.input_tokens,
      event.usage.output_tokens,
      event.usage.cache_read_tokens,
      event.usage.cache_write_tokens,
      event.usage.reasoning_tokens,
    ),
    ...(event.actual_cost_usd !== null
      ? { costUSD: event.actual_cost_usd }
      : {}),
  });
}

// ────────────────────────────────────────────────────────────────
// Codex rollout lines
// ────────────────────────────────────────────────────────────────

export function codexUsage(
  input: unknown,
  output: unknown,
  cacheRead: unknown,
  cacheWrite: unknown,
  reasoning: unknown,
): Record<string, unknown> {
  return {
    input_tokens: input,
    output_tokens: output,
    cached_input_tokens: cacheRead,
    cache_write_input_tokens: cacheWrite,
    reasoning_output_tokens: reasoning,
  };
}

export function codexSessionMetaLine(spec: {
  id: string;
  timestamp: string;
  cliVersion?: string;
}): string {
  return JSON.stringify({
    timestamp: spec.timestamp,
    type: 'session_meta',
    payload: {
      id: spec.id,
      timestamp: spec.timestamp,
      cwd: '/Users/sentinel-user/SENTINEL_PATH/repo',
      originator: 'codex_cli_rs',
      source: 'cli',
      cli_version: spec.cliVersion ?? '0.50.0',
      instructions: 'SENTINEL_PROMPT do the task',
      git: {
        branch: 'SENTINEL_BRANCH',
        repository_url: 'https://example.com/SENTINEL_REPO.git',
      },
      user: { email: 'sentinel@example.com', account_id: 'acct_SENTINEL' },
    },
  });
}

export function codexTurnContextLine(spec: {
  turnId: string;
  model: string;
  timestamp: string;
}): string {
  return JSON.stringify({
    timestamp: spec.timestamp,
    type: 'turn_context',
    payload: {
      turn_id: spec.turnId,
      model: spec.model,
      cwd: '/Users/sentinel-user/SENTINEL_PATH/repo',
      summary: 'SENTINEL_SUMMARY',
    },
  });
}

export function codexTokenCountLine(spec: {
  timestamp: string;
  last?: Record<string, unknown>;
  total?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    timestamp: spec.timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        ...(spec.total !== undefined ? { total_token_usage: spec.total } : {}),
        ...(spec.last !== undefined ? { last_token_usage: spec.last } : {}),
      },
    },
  });
}

/** Rollout lines reproducing one golden `TaskCostEventV1` exactly. */
export function codexLinesFromGolden(event: TaskCostEventV1): string[] {
  return [
    codexTurnContextLine({
      turnId: event.event_id,
      model: event.observed_model,
      timestamp: event.observed_at,
    }),
    codexTokenCountLine({
      timestamp: event.observed_at,
      last: codexUsage(
        event.usage.input_tokens,
        event.usage.output_tokens,
        event.usage.cache_read_tokens,
        event.usage.cache_write_tokens,
        event.usage.reasoning_tokens,
      ),
    }),
  ];
}
