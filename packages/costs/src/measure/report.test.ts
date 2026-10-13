import {
  MODEL_PRICING_AS_OF,
  TASK_COST_EVENT_SCHEMA_VERSION,
  type TaskCostEventV1,
} from '@hokusai/core';
import { describe, expect, it } from 'vitest';
import { buildTaskCostReport } from './report.js';

let counter = 0;

/** Hand-built contract event with sensible priced defaults. */
function event(overrides: Partial<TaskCostEventV1> = {}): TaskCostEventV1 {
  counter += 1;
  return {
    schema_version: TASK_COST_EVENT_SCHEMA_VERSION,
    event_id: `evt-${counter}`,
    task_id: 'task-report',
    session_id: 'session-1',
    turn_id: `turn-${counter}`,
    sequence: counter,
    harness: 'claude-code',
    provider_contract_version: 'claude-code/1',
    observed_model: 'claude-sonnet-4-6',
    usage_kind: 'delta',
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
    },
    usage_coverage: 'available',
    actual_cost_usd: null,
    estimated_cost_usd: 0.0105,
    cost_source: 'local_estimate',
    cost_basis: 'per_token_api',
    pricing_source: 'local_estimate',
    pricing_revision: MODEL_PRICING_AS_OF,
    price_table: 'anthropic',
    observed_at: '2026-01-01T00:01:00Z',
    ...overrides,
  };
}

function unpriced(model: string): TaskCostEventV1 {
  return event({
    observed_model: model,
    estimated_cost_usd: null,
    cost_source: 'none',
    pricing_source: 'none',
  });
}

const META = { taskId: 'task-report', sourceKind: 'manual' as const };

describe('buildTaskCostReport', () => {
  it('complete coverage: sums resolved costs and usage', () => {
    const report = buildTaskCostReport([event(), event(), event()], META);
    expect(report.coverage).toEqual({
      status: 'complete',
      pricedRecords: 3,
      unpricedRecords: 0,
      unknownModels: [],
    });
    expect(report.totalUsd).toBeCloseTo(0.0315, 9);
    expect(report.usage).toEqual({
      input: 3000,
      output: 1500,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
    });
    expect(report.pricing).toEqual({
      snapshotId: `anthropic@${MODEL_PRICING_AS_OF}`,
      effectiveDate: MODEL_PRICING_AS_OF,
      currency: 'USD',
    });
    expect(report.diagnostics).toEqual([]);
  });

  it('a provider-reported charge wins over the estimate per event', () => {
    const report = buildTaskCostReport(
      [
        event({
          actual_cost_usd: 0.05,
          cost_source: 'provider_reported',
        }),
      ],
      META,
    );
    expect(report.totalUsd).toBeCloseTo(0.05, 9);
  });

  it('partial coverage: totalUsd is a positive lower bound, never null (REQ-F4)', () => {
    const report = buildTaskCostReport(
      [event(), unpriced('mystery/model-x'), unpriced('mystery/model-x')],
      META,
    );
    expect(report.coverage.status).toBe('partial');
    expect(report.coverage.pricedRecords).toBe(1);
    expect(report.coverage.unpricedRecords).toBe(2);
    // The single trap the contract summary would fall into: under partial
    // coverage summary.total_cost_usd is null; the report sums what resolved.
    expect(report.totalUsd).toBeCloseTo(0.0105, 9);
    expect(report.coverage.unknownModels).toEqual(['mystery/model-x']);
    expect(
      report.diagnostics.filter((d) => d.code === 'UNPRICED_MODEL'),
    ).toHaveLength(1);
  });

  it('a usage gap alone makes coverage partial even when fully priced', () => {
    const report = buildTaskCostReport(
      [
        event({
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_tokens: null,
            cache_write_tokens: null,
            reasoning_tokens: null,
          },
          usage_coverage: 'partial',
        }),
      ],
      META,
    );
    expect(report.coverage.status).toBe('partial');
    expect(report.totalUsd).toBeCloseTo(0.0105, 9);
    expect(report.usage.cacheRead).toBeNull();
  });

  it('zero events: coverage none, totalUsd null, NO_USAGE_CAPTURED (REQ-F5)', () => {
    const report = buildTaskCostReport([], META);
    expect(report.totalUsd).toBeNull();
    expect(report.coverage.status).toBe('none');
    const diagnostic = report.diagnostics.find(
      (d) => d.code === 'NO_USAGE_CAPTURED',
    );
    expect(diagnostic?.message).toMatch(/usage events or session files/);
  });

  it('all-unpriced events: coverage none and totalUsd null (documented choice)', () => {
    const report = buildTaskCostReport(
      [unpriced('mystery/model-x'), unpriced('mystery/model-y')],
      META,
    );
    expect(report.coverage.status).toBe('none');
    expect(report.totalUsd).toBeNull();
    expect(report.coverage.unknownModels).toEqual([
      'mystery/model-x',
      'mystery/model-y',
    ]);
  });

  it('totalUsd equals the byModel sum within 1e-9 (REQ-F3/F4 identity)', () => {
    const events = [
      event({ estimated_cost_usd: 0.0105 }),
      event({ observed_model: 'gpt-5-codex', estimated_cost_usd: 0.021 }),
      event({ estimated_cost_usd: 0.003 }),
      unpriced('mystery/model-x'),
    ];
    const report = buildTaskCostReport(events, META);
    const byModelSum = Object.values(report.byModel).reduce(
      (sum, entry) => sum + (entry.usd ?? 0),
      0,
    );
    expect(Math.abs((report.totalUsd ?? 0) - byModelSum)).toBeLessThan(1e-9);
    const byHarnessSum = Object.values(report.byHarness).reduce(
      (sum, entry) => sum + (entry.usd ?? 0),
      0,
    );
    expect(Math.abs((report.totalUsd ?? 0) - byHarnessSum)).toBeLessThan(1e-9);
  });

  it('groups byHarness by the retained caller label, falling back to the event harness', () => {
    const first = event({ harness: 'unknown' });
    const second = event();
    const report = buildTaskCostReport([first, second], {
      ...META,
      harnessLabels: new Map([[first.event_id, 'custom']]),
    });
    expect(Object.keys(report.byHarness).sort()).toEqual([
      'claude-code',
      'custom',
    ]);
    expect(report.source.harness).toBe('mixed');
  });

  it('honors meta.sourceHarness and carries files verbatim', () => {
    const report = buildTaskCostReport([event()], {
      taskId: 'task-report',
      sourceKind: 'session-file',
      sourceHarness: 'claude-code',
      files: ['/tmp/some/session.jsonl'],
    });
    expect(report.source).toEqual({
      kind: 'session-file',
      harness: 'claude-code',
      files: ['/tmp/some/session.jsonl'],
    });
  });

  it('prepends caller-supplied diagnostics', () => {
    const report = buildTaskCostReport([], {
      ...META,
      diagnostics: [
        {
          code: 'SESSION_FILE_UNREADABLE',
          level: 'warn',
          message: '1 of 1 session file(s) could not be read',
        },
      ],
    });
    expect(report.diagnostics.map((d) => d.code)).toEqual([
      'SESSION_FILE_UNREADABLE',
      'NO_USAGE_CAPTURED',
    ]);
  });
});
