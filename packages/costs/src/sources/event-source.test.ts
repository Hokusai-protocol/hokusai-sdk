/**
 * Generic event-source adapter: boundary filtering of already-normalized
 * records, without throwing on noise.
 */

import { describe, expect, it } from 'vitest';
import { createTaskCostEngine, type IngestUsageInput } from '../index.js';
import { extractEventSourceUsage } from './event-source.js';
import { boundaryFor } from './test-support.js';

function friendlyRecord(overrides: Partial<IngestUsageInput> = {}): IngestUsageInput {
  return {
    eventId: 'evt-1',
    taskId: 'task-a',
    sessionId: 'session-1',
    turnId: 'turn-1',
    sequence: 1,
    harness: 'pi',
    harnessVersion: '1.2.3',
    providerContractVersion: 'pi/1',
    observedModel: 'claude-sonnet-5',
    usage: { input_tokens: 1000, output_tokens: 500 },
    observedAt: '2026-01-01T00:01:00Z',
    ...overrides,
  };
}

describe('extractEventSourceUsage', () => {
  const boundary = boundaryFor('task-a', ['session-1']);

  it('passes through in-boundary records and feeds the engine', () => {
    const result = extractEventSourceUsage({
      boundary,
      records: [friendlyRecord()],
    });
    expect(result.inputs).toHaveLength(1);
    expect(result.diagnostics).toEqual({});
    expect(result.sourceVersions).toEqual(['1.2.3']);

    const engine = createTaskCostEngine({ taskId: 'task-a' });
    const [ingested] = engine.ingestMany(result.inputs);
    expect(ingested?.status).toBe('accepted');
  });

  it('rejects foreign-task, foreign-session, and out-of-window records without throwing', () => {
    const result = extractEventSourceUsage({
      boundary,
      records: [
        friendlyRecord(),
        friendlyRecord({ eventId: 'evt-2', taskId: 'task-b' }),
        friendlyRecord({ eventId: 'evt-3', sessionId: 'session-9' }),
        friendlyRecord({ eventId: 'evt-4', observedAt: '2027-06-01T00:00:00Z' }),
        friendlyRecord({ eventId: 'evt-5', observedAt: undefined as unknown as string }),
        'not a record',
        null,
        42,
        {},
      ],
    });
    expect(result.inputs).toHaveLength(1);
    expect(result.diagnostics).toEqual({
      foreign_task: 1,
      session_not_in_boundary: 1,
      outside_time_window: 1,
      missing_timestamp: 1,
      invalid_record: 4,
    });
  });

  it('accepts pre-built TaskCostEventV1 records by their snake_case fields', () => {
    const event = {
      schema_version: 'task_cost_event/v1',
      event_id: 'evt-pre-1',
      task_id: 'task-a',
      session_id: 'session-1',
      turn_id: 'turn-1',
      sequence: 1,
      harness: 'pi',
      harness_version: '9.9.9',
      provider_contract_version: 'pi/1',
      observed_model: 'claude-sonnet-5',
      usage_kind: 'delta',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_tokens: null,
        cache_write_tokens: null,
        reasoning_tokens: null,
      },
      usage_coverage: 'partial',
      actual_cost_usd: null,
      estimated_cost_usd: null,
      cost_source: 'none',
      cost_basis: 'per_token_api',
      pricing_source: 'none',
      observed_at: '2026-01-01T00:01:00Z',
    };
    const result = extractEventSourceUsage({ boundary, records: [event] });
    expect(result.inputs).toEqual([event]);
    expect(result.sourceVersions).toEqual(['9.9.9']);

    const engine = createTaskCostEngine({ taskId: 'task-a' });
    const [ingested] = engine.ingestMany(result.inputs);
    expect(ingested?.status).toBe('accepted');
  });
});
