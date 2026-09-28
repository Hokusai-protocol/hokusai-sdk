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
 * The adapter never trusts caller-supplied objects wholesale: each accepted
 * record is rebuilt from an allow-list of contract-shaped fields, so extra
 * keys a friendly source might carry (prompt, cwd, transcript text, account
 * identity) have no code path into the adapter's output.
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
 * Field allow-lists mirror the two accepted input shapes. Anything not named
 * here is dropped when the adapter rebuilds a record, so no extra key on a
 * caller-supplied object survives into the adapter's output.
 */
const FRIENDLY_ALLOWED_KEYS = [
  'eventId',
  'taskId',
  'sessionId',
  'turnId',
  'sequence',
  'harness',
  'harnessVersion',
  'providerContractVersion',
  'observedModel',
  'usage',
  'usageKind',
  'actualCostUsd',
  'observedAt',
  'costBasis',
  'replayOfEventId',
  'parentEventId',
  'isSubagent',
  'diagnostics',
  'estimatedCostUsd',
  'pricingSource',
  'priceTable',
] as const;

const PREBUILT_ALLOWED_KEYS = [
  'schema_version',
  'event_id',
  'task_id',
  'session_id',
  'turn_id',
  'sequence',
  'parent_event_id',
  'is_subagent',
  'replay_of_event_id',
  'harness',
  'harness_version',
  'provider_contract_version',
  'observed_model',
  'usage_kind',
  'usage',
  'usage_coverage',
  'actual_cost_usd',
  'estimated_cost_usd',
  'cost_source',
  'cost_basis',
  'pricing_source',
  'pricing_revision',
  'price_table',
  'observed_at',
  'diagnostics',
] as const;

function projectAllowed<T>(
  source: Record<string, unknown>,
  allowed: readonly string[],
): T {
  const projected: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      projected[key] = source[key];
    }
  }
  return projected as T;
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
    if (prebuilt) {
      inputs.push(projectAllowed<TaskCostEventV1>(record, PREBUILT_ALLOWED_KEYS));
    } else {
      inputs.push(projectAllowed<IngestUsageInput>(record, FRIENDLY_ALLOWED_KEYS));
    }
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
