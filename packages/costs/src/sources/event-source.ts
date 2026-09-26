/**
 * Generic event-source adapter (`@hokusai/costs/sources/event-source`) for
 * harnesses that already emit normalized usage records.
 *
 * Records may be friendly `IngestUsageInput` shapes or pre-built
 * `TaskCostEventV1` records. Each is checked against the explicit task
 * boundary; invalid or out-of-boundary records are counted and dropped,
 * never thrown on. Deep schema validation stays where it lives — in the
 * engine and the contract validators — so a record accepted here can still
 * be rejected at ingest without ever entering the ledger.
 *
 * @module sources/event-source
 */

import {
  TASK_COST_EVENT_SCHEMA_VERSION,
  type TaskCostEventV1,
} from '@hokusai/core';
import type { IngestUsageInput } from '../engine.js';
import { inBoundaryWindow, resolveTaskBoundary } from './correlation.js';
import { asRecord, timestampOrNull, versionOrNull } from './sanitize.js';
import {
  countDiagnostic,
  type TaskCostBoundaryV1,
  type TaskCostSourceDiagnostics,
  type TaskCostSourceResult,
} from './types.js';

export interface ExtractEventSourceUsageOptions {
  /** Explicit task boundary; the only correlation signal used. */
  boundary: TaskCostBoundaryV1;
  /** Candidate records: `IngestUsageInput`, `TaskCostEventV1`, or noise. */
  records: readonly unknown[];
}

/**
 * Filter already-normalized records down to the ones that belong to the
 * boundary. Never throws on a bad record; a misconfigured boundary throws
 * `TypeError`.
 */
export function extractEventSourceUsage(
  options: ExtractEventSourceUsageOptions,
): TaskCostSourceResult {
  const boundary = resolveTaskBoundary(options.boundary);
  const diagnostics: TaskCostSourceDiagnostics = {};
  const inputs: (IngestUsageInput | TaskCostEventV1)[] = [];
  const sourceVersions: string[] = [];

  for (const candidate of options.records) {
    const record = asRecord(candidate);
    if (record === null) {
      countDiagnostic(diagnostics, 'invalid_record');
      continue;
    }
    const prebuilt = record.schema_version === TASK_COST_EVENT_SCHEMA_VERSION;
    const taskId = prebuilt ? record.task_id : record.taskId;
    const sessionId = prebuilt ? record.session_id : record.sessionId;
    const observedAt = prebuilt ? record.observed_at : record.observedAt;
    const eventId = prebuilt ? record.event_id : record.eventId;

    if (typeof eventId !== 'string' || eventId.length === 0) {
      countDiagnostic(diagnostics, 'invalid_record');
      continue;
    }
    if (taskId !== boundary.taskId) {
      countDiagnostic(diagnostics, 'foreign_task');
      continue;
    }
    if (typeof sessionId !== 'string' || !boundary.sessionIds.has(sessionId)) {
      countDiagnostic(diagnostics, 'session_not_in_boundary');
      continue;
    }
    const timestamp = timestampOrNull(observedAt);
    if (timestamp === null) {
      countDiagnostic(diagnostics, 'missing_timestamp');
      continue;
    }
    if (!inBoundaryWindow(boundary, timestamp.ms)) {
      countDiagnostic(diagnostics, 'outside_time_window');
      continue;
    }

    const version = versionOrNull(
      prebuilt ? record.harness_version : record.harnessVersion,
    );
    if (version !== null && !sourceVersions.includes(version)) {
      sourceVersions.push(version);
    }
    inputs.push(candidate as IngestUsageInput | TaskCostEventV1);
  }

  return { inputs, diagnostics, sourceVersions };
}

export {
  TASK_COST_SOURCE_DIAGNOSTIC_CODES,
  type TaskCostBoundaryV1,
  type TaskCostSourceDiagnosticCode,
  type TaskCostSourceDiagnostics,
  type TaskCostSourceResult,
} from './types.js';
