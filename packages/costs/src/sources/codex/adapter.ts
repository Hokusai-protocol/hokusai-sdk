/**
 * Codex task-cost source adapter.
 *
 * Consumes raw rollout contents, correlates `token_count` observations
 * against an explicit task boundary, prefers per-event `last_token_usage`
 * deltas, and falls back to baseline-diffed cumulative counters (never
 * inferring a missing counter as zero, and skipping observations across a
 * counter reset). Model transitions from `turn_context` rows are carried
 * per event, so the engine prices each segment with the model in force.
 *
 * @module sources/codex/adapter
 */

import type { TaskCostTokenUsage } from '@hokusai/core';
import type { IngestUsageInput } from '../../engine.js';
import { assembleInputs, type AcceptedUsageRow } from '../assemble.js';
import {
  CumulativeUsageTracker,
  inBoundaryWindow,
  resolveTaskBoundary,
} from '../correlation.js';
import type { ParseJsonlOptions } from '../jsonl.js';
import {
  countDiagnostic,
  type TaskCostBoundaryV1,
  type TaskCostSourceDiagnostics,
  type TaskCostSourceResult,
} from '../types.js';
import { CODEX_PROVIDER_CONTRACT_VERSION, parseCodexRollout } from './parser.js';

export interface ExtractCodexUsageOptions {
  /** Explicit task boundary; the only correlation signal used. */
  boundary: TaskCostBoundaryV1;
  /** Raw rollout JSONL contents, one per session file. Order-insensitive. */
  files: readonly string[];
  parseOptions?: ParseJsonlOptions;
}

/**
 * Extract normalized per-turn usage for one task from Codex rollouts. Never
 * throws on malformed input; a misconfigured boundary throws `TypeError`.
 */
export function extractCodexUsage(
  options: ExtractCodexUsageOptions,
): TaskCostSourceResult<IngestUsageInput> {
  const boundary = resolveTaskBoundary(options.boundary);
  const diagnostics: TaskCostSourceDiagnostics = {};
  const byIdentity = new Map<string, AcceptedUsageRow>();

  for (const content of options.files) {
    const session = parseCodexRollout(content, diagnostics, options.parseOptions);
    if (session.sessionId === null) {
      countDiagnostic(diagnostics, 'missing_session_id');
      continue;
    }
    const sessionId = session.sessionId;
    if (!boundary.sessionIds.has(sessionId)) {
      countDiagnostic(diagnostics, 'session_not_in_boundary');
      continue;
    }

    // Cumulative baselines are per rollout file: counters restart with the
    // file, and observations before the boundary window still advance the
    // baseline so a mid-session window never absorbs earlier usage.
    const tracker = new CumulativeUsageTracker();
    const turnOrdinals = new Map<string, number>();
    let orphanCount = 0;

    for (const observation of session.observations) {
      let usage: Partial<TaskCostTokenUsage> | null = observation.delta;
      if (observation.cumulative !== null) {
        const derived = tracker.next(observation.cumulative);
        if (derived.reset) {
          countDiagnostic(diagnostics, 'cumulative_counter_reset');
          // The provider-reported delta (when present) survives a total
          // counter reset; a derived delta does not.
          if (usage === null) continue;
        } else if (usage === null) {
          usage = derived.usage;
        }
      }
      if (usage === null) continue;

      // Identity is assigned before any window filtering so event ids stay
      // stable for a given rollout regardless of the boundary supplied.
      let eventId: string;
      let turnId: string;
      if (observation.turnId !== null) {
        const ordinal = turnOrdinals.get(observation.turnId) ?? 0;
        turnOrdinals.set(observation.turnId, ordinal + 1);
        turnId = observation.turnId;
        eventId =
          ordinal === 0 ? observation.turnId : `${observation.turnId}.${ordinal + 1}`;
      } else {
        orphanCount += 1;
        turnId = `${sessionId}.tc${orphanCount}`;
        eventId = turnId;
      }

      if (observation.observedMs === null || observation.observedAt === null) {
        countDiagnostic(diagnostics, 'missing_timestamp');
        continue;
      }
      if (!inBoundaryWindow(boundary, observation.observedMs)) {
        countDiagnostic(diagnostics, 'outside_time_window');
        continue;
      }
      if (byIdentity.has(eventId)) {
        countDiagnostic(diagnostics, 'duplicate_row');
      }
      byIdentity.set(eventId, {
        eventId,
        sessionId,
        turnId,
        observedAt: observation.observedAt,
        observedMs: observation.observedMs,
        observedModel: observation.observedModel,
        usage,
        actualCostUsd: null,
        harnessVersion: session.harnessVersion,
        usageInvalid: observation.usageInvalid,
      });
    }
  }

  const { inputs, sourceVersions } = assembleInputs(
    boundary.taskId,
    'codex',
    CODEX_PROVIDER_CONTRACT_VERSION,
    [...byIdentity.values()],
  );
  return { inputs, diagnostics, sourceVersions };
}
