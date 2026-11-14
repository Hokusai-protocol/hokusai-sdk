/**
 * Codex session capture and measurement for v4 contribution rows (HOK-3412).
 *
 * Codex passes the session to MCP servers on every `tools/call` in `_meta`
 * (verified on codex-cli 0.166.0): `_meta.sessionId` / `_meta.threadId`, and
 * `_meta["x-codex-turn-metadata"]` with `session_id`, `turn_id`, `model` and
 * `turn_started_at_unix_ms`. `hokusai_route` stores the session id and the
 * route turn's start as a local-only baseline (never sent to Hokusai);
 * `hokusai_submit_outcome` measures exactly that session's rollout
 * (`$CODEX_HOME/sessions/**\/rollout-*-<sessionId>.jsonl`) with
 * `@hokusai/costs`. No `_meta` session id means the stage is reported
 * unmeasured: never "the newest rollout".
 *
 * @module session-cost
 */

import os from 'node:os';
import path from 'node:path';
import type {
  CostBaselineSnapshot,
  MeasureStage,
  StageCostInput,
} from '@hokusai/core';
import { measureTask } from '@hokusai/costs';

/** What Codex told the MCP server about the calling session. */
export interface CodexCallSession {
  sessionId: string;
  turnId?: string;
  /** ISO start of the turn that made the call. */
  turnStartedAt?: string;
  model?: string;
}

const SAFE_ID = /^[A-Za-z0-9._-]{1,200}$/;

function safeId(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_ID.test(value) && !value.startsWith('.') ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Read the calling session from a `tools/call` request's `_meta`. */
export function codexCallSessionFromMeta(meta: unknown): CodexCallSession | undefined {
  const record = asRecord(meta);
  if (!record) return undefined;
  const turn = asRecord(record['x-codex-turn-metadata']);
  const sessionId =
    safeId(turn?.session_id) ?? safeId(record.sessionId) ?? safeId(turn?.thread_id) ?? safeId(record.threadId);
  if (!sessionId) return undefined;
  const startedMs = turn?.turn_started_at_unix_ms;
  const turnStartedAt =
    typeof startedMs === 'number' && Number.isFinite(startedMs) && startedMs > 0
      ? new Date(startedMs).toISOString()
      : undefined;
  const turnId = safeId(turn?.turn_id);
  const model = typeof turn?.model === 'string' && turn.model.trim() ? turn.model.trim() : undefined;
  return {
    sessionId,
    ...(turnId ? { turnId } : {}),
    ...(turnStartedAt ? { turnStartedAt } : {}),
    ...(model ? { model } : {}),
  };
}

/** The local-only baseline `hokusai_route` stores for this session. */
export function codexSessionBaseline(
  session: CodexCallSession | undefined,
  nowIso: string,
): CostBaselineSnapshot | undefined {
  return session ? { baselineAt: session.turnStartedAt ?? nowIso, sessionId: session.sessionId } : undefined;
}

/** `$CODEX_HOME/sessions`, defaulting to `~/.codex/sessions`. */
export function codexSessionsDir(env: NodeJS.ProcessEnv | undefined, homedir = os.homedir()): string {
  const home = (env ?? process.env).CODEX_HOME?.trim();
  return path.join(home || path.join(homedir, '.codex'), 'sessions');
}

export interface CodexStageMeasurerOptions {
  homedir?: string;
}

/** The Codex `MeasureStage`. Never throws. */
export function createCodexStageMeasurer(options: CodexStageMeasurerOptions = {}): MeasureStage {
  return async (input): Promise<StageCostInput | undefined> => {
    try {
      const sessionId = input.routeContext?.sessionId;
      const startedAt = input.routeContext?.baselineAt;
      if (!sessionId || !startedAt) {
        return undefined;
      }
      const { cost } = await measureTask(
        {
          taskId: input.taskId,
          harness: 'codex',
          sessionFiles: {
            harness: 'codex',
            sessionIds: [sessionId],
            roots: [codexSessionsDir(input.env, options.homedir)],
            window: { startedAt, endedAt: input.endedAt },
          },
        },
        () => undefined,
      );
      return cost;
    } catch {
      return undefined;
    }
  };
}

export const measureCodexStage: MeasureStage = createCodexStageMeasurer();
