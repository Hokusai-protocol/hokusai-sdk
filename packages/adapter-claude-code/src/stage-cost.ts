/**
 * Measure the routed Claude Code session for a v4 contribution row (HOK-3412).
 *
 * The route stored a local-only baseline (`sessionId`, `baselineAt`,
 * `projectDirKey`). At report time this reads exactly that session's
 * transcript (`<projects>/<projectDirKey>/<sessionId>.jsonl`, never "the
 * newest one") and measures the turns after `baselineAt` with
 * `@hokusai/costs`, so the row's `task_cost` is the same report any
 * `@hokusai/costs` host would produce. Streamed transcript lines repeat a
 * message's usage; the costs source de-duplicates them by message id.
 *
 * @module stage-cost
 */

import path from 'node:path';
import {
  locateSessionTranscript,
  resolveClaudeConfigDir,
  sessionTranscriptDir,
  type MeasureStage,
  type MeasureStageInput,
  type SessionUsageFileSystem,
  type StageCostInput,
} from '@hokusai/core';
import { measureTask } from '@hokusai/costs';

export interface ClaudeCodeStageMeasurerOptions {
  /** Defaults to the process working directory (used without a `projectDirKey`). */
  cwd?: string;
  homedir?: string;
  /** Injected for tests; used only to locate the transcript. */
  fs?: SessionUsageFileSystem;
}

/** Path of the route's own transcript, or `undefined` when it cannot be located. */
export function locateRouteTranscript(
  input: MeasureStageInput,
  options: ClaudeCodeStageMeasurerOptions = {},
): string | undefined {
  const sessionId = input.routeContext?.sessionId;
  if (!sessionId || !input.routeContext?.baselineAt) {
    return undefined;
  }
  const configDir = resolveClaudeConfigDir({
    ...(input.env ? { env: input.env } : {}),
    ...(options.homedir ? { homedir: options.homedir } : {}),
  });
  const dir = input.routeContext.projectDirKey
    ? path.join(configDir, 'projects', input.routeContext.projectDirKey)
    : sessionTranscriptDir(configDir, options.cwd ?? process.cwd());
  return locateSessionTranscript({ dir, sessionId, ...(options.fs ? { fs: options.fs } : {}) });
}

/**
 * The Claude Code `MeasureStage`: `undefined` when the route captured no
 * session (the stage is then reported unmeasured). Never throws.
 */
export function createClaudeCodeStageMeasurer(
  options: ClaudeCodeStageMeasurerOptions = {},
): MeasureStage {
  return async (input): Promise<StageCostInput | undefined> => {
    try {
      const transcript = locateRouteTranscript(input, options);
      const sessionId = input.routeContext?.sessionId;
      const startedAt = input.routeContext?.baselineAt;
      if (!transcript || !sessionId || !startedAt) {
        return undefined;
      }
      const { cost } = await measureTask(
        {
          taskId: input.taskId,
          harness: 'claude-code',
          sessionFiles: {
            harness: 'claude-code',
            sessionIds: [sessionId],
            paths: [transcript],
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

export const measureClaudeCodeStage: MeasureStage = createClaudeCodeStageMeasurer();
