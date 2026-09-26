/**
 * Generic event-source adapter. Consumes already-normalized harness records —
 * either friendly `IngestUsageInput` objects or fully-priced
 * `TaskCostEventV1` values — applies the caller boundary, and feeds the
 * shared task cost engine.
 *
 * Purely additive: adapters that already speak the contract (harnesses that
 * emit `TaskCostEventV1` directly, or callers who prefer to prepare inputs
 * themselves) can share the same boundary/dedupe/summary machinery without
 * writing a parser.
 *
 * @module sources/event-source
 */

import type { TaskCostEventV1, TaskCostSummaryV1 } from '@hokusai/core';
import { TASK_COST_EVENT_SCHEMA_VERSION } from '@hokusai/core';
import { createTaskCostEngine, type IngestUsageInput } from '../engine.js';
import type { HostPriceOverride } from '../pricing-resolver.js';
import {
  DiagnosticTally,
  buildBoundaryContext,
  matchesBoundary,
} from './correlation.js';
import type {
  SourceDiagnostic,
  TaskBoundary,
  TaskCostSourceResult,
} from './types.js';

export interface EventSourceInput {
  /** Already-normalized records: friendly inputs or pre-built contract events. */
  records: readonly (IngestUsageInput | TaskCostEventV1)[];
  boundary: TaskBoundary;
  priceOverrides?: readonly HostPriceOverride[];
  pricingRevision?: string;
}

export type EventSourceResult = TaskCostSourceResult<
  TaskCostEventV1,
  TaskCostSummaryV1
>;

export {
  SOURCE_DIAGNOSTIC_CODES,
  type SourceDiagnostic,
  type SourceDiagnosticCode,
  type TaskBoundary,
  type TaskCostSourceResult,
} from './types.js';

function isPrebuiltEvent(
  input: IngestUsageInput | TaskCostEventV1,
): input is TaskCostEventV1 {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input as { schema_version?: unknown }).schema_version ===
      TASK_COST_EVENT_SCHEMA_VERSION
  );
}

type Eligibility = {
  sessionId: string;
  observedAt: string;
  taskId: string;
};

function isRecordEligible(
  input: IngestUsageInput | TaskCostEventV1,
): { kind: 'malformed' } | { kind: 'invalid' } | { kind: 'ok'; value: Eligibility } {
  // Non-object records (nulls, primitives, arrays) are corrupt inputs — count
  // them under `malformed_json`, don't dereference them.
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { kind: 'malformed' };
  }
  if (isPrebuiltEvent(input)) {
    return {
      kind: 'ok',
      value: {
        sessionId: input.session_id,
        observedAt: input.observed_at,
        taskId: input.task_id,
      },
    };
  }
  const record = input as unknown as Record<string, unknown>;
  const sessionId = record['sessionId'];
  const observedAt = record['observedAt'];
  const taskId = record['taskId'];
  if (
    typeof sessionId !== 'string' ||
    typeof observedAt !== 'string' ||
    typeof taskId !== 'string'
  ) {
    return { kind: 'invalid' };
  }
  return { kind: 'ok', value: { sessionId, observedAt, taskId } };
}

export function runEventSourceAdapter(
  input: EventSourceInput,
): EventSourceResult {
  const boundary = buildBoundaryContext(input.boundary);
  const tally = new DiagnosticTally();
  const engine = createTaskCostEngine({
    taskId: boundary.taskId,
    ...(input.priceOverrides !== undefined
      ? { priceOverrides: input.priceOverrides }
      : {}),
    ...(input.pricingRevision !== undefined
      ? { pricingRevision: input.pricingRevision }
      : {}),
  });

  for (const record of input.records) {
    const eligibility = isRecordEligible(record);
    if (eligibility.kind === 'malformed') {
      tally.bump('malformed_json');
      continue;
    }
    if (eligibility.kind === 'invalid') {
      tally.bump('missing_required_field');
      continue;
    }
    if (eligibility.value.taskId !== boundary.taskId) {
      tally.bump('record_out_of_boundary');
      continue;
    }
    if (
      !matchesBoundary(
        boundary,
        eligibility.value.sessionId,
        eligibility.value.observedAt,
      )
    ) {
      tally.bump('record_out_of_boundary');
      continue;
    }
    const result = engine.ingest(record);
    if (result.status === 'rejected') {
      tally.bump('invalid_usage');
    } else if (result.status === 'duplicate') {
      tally.bump('duplicate_record');
    }
  }

  const events = engine.events();
  const diagnostics: SourceDiagnostic[] = tally.toArray();
  const summary = events.length > 0 ? engine.snapshot() : null;
  return { events, diagnostics, summary };
}
