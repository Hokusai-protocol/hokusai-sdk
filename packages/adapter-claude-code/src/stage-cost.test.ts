import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildReportContributionRow,
  encodeProjectDirKey,
  parseTranscriptUsageTotals,
  type MeasureStageInput,
  type OutcomeReport,
} from '@hokusai/core';
import { createClaudeCodeStageMeasurer, locateRouteTranscript } from './stage-cost.js';

const SESSION = '0b6f2a0e-1c1d-4a52-9b8e-2f6d3c1a7e10';
const BASELINE = '2026-11-04T10:00:00.000Z';
const ENDED = '2026-11-04T11:00:00.000Z';
const CWD = '/Users/someone/repo';

function assistant(id: string, timestamp: string, usage: Record<string, number>, requestId = `req-${id}`): string {
  return JSON.stringify({
    type: 'assistant',
    uuid: `${id}-${timestamp}`,
    sessionId: SESSION,
    timestamp,
    version: '2.1.0',
    cwd: CWD,
    gitBranch: 'SENTINEL_BRANCH',
    requestId,
    message: {
      id,
      role: 'assistant',
      model: 'claude-sonnet-5',
      content: [{ type: 'text', text: 'SENTINEL_TRANSCRIPT_TEXT' }],
      usage,
    },
  });
}

const usage = (input: number, output: number, cacheRead = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: 0,
});

/** One pre-route turn, one message streamed as two lines, one plain turn. */
const transcript = [
  assistant('msg-0', '2026-11-04T09:59:00.000Z', usage(1000, 500)),
  JSON.stringify({ type: 'user', sessionId: SESSION, timestamp: '2026-11-04T10:00:30.000Z', message: { role: 'user', content: 'SENTINEL_PROMPT' } }),
  assistant('msg-1', '2026-11-04T10:01:00.000Z', usage(2000, 400, 10000)),
  assistant('msg-1', '2026-11-04T10:01:01.000Z', usage(2000, 400, 10000)),
  assistant('msg-2', '2026-11-04T10:05:00.000Z', usage(3000, 600)),
].join('\n');

let configDir: string;
let env: NodeJS.ProcessEnv;

function input(overrides: Partial<MeasureStageInput['routeContext']> = {}): MeasureStageInput {
  return {
    taskId: 'HOK-1',
    executedModel: 'claude-sonnet-5',
    routeContext: {
      taskDescriptor: { task_type: 'bugfix' },
      allowedModels: ['claude-sonnet-5', 'claude-opus-4-8'],
      sessionId: SESSION,
      baselineAt: BASELINE,
      projectDirKey: encodeProjectDirKey(CWD),
      ...overrides,
    },
    endedAt: ENDED,
    env,
  };
}

beforeEach(() => {
  configDir = mkdtempSync(path.join(os.tmpdir(), 'hokusai-stage-cost-'));
  env = { CLAUDE_CONFIG_DIR: configDir };
  const dir = path.join(configDir, 'projects', encodeProjectDirKey(CWD));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${SESSION}.jsonl`), transcript);
  // Another session's transcript in the same project: never read.
  writeFileSync(path.join(dir, 'other-session.jsonl'), assistant('msg-x', '2026-11-04T10:02:00.000Z', usage(99999, 99999)));
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
});

describe('createClaudeCodeStageMeasurer', () => {
  const measure = createClaudeCodeStageMeasurer();

  it('measures only the route session, after the baseline, de-duplicating streamed lines', async () => {
    const cost = await measure(input());
    expect(cost?.summaries).toHaveLength(1);
    const summary = cost!.summaries[0]!;
    expect(summary.task_id).toBe('HOK-1');
    expect(summary.harness).toBe('claude-code');
    expect(summary.session_ids).toEqual([SESSION]);
    expect(summary.models).toEqual(['claude-sonnet-5']);
    expect(summary.usage).toMatchObject({ input_tokens: 5000, output_tokens: 1000, cache_read_tokens: 10000 });
    expect(summary.total_cost_usd).not.toBeNull();
    expect(JSON.stringify(cost)).not.toMatch(/sentinel/i);
  });

  it('documents why: the legacy core totals count the streamed message twice', () => {
    const legacy = parseTranscriptUsageTotals({ contents: transcript, afterIso: BASELINE });
    expect(legacy.inputTokens).toBe(7000);
    expect(legacy.cacheReadTokens).toBe(20000);
  });

  it('returns undefined without a session id or baseline (stage reported unmeasured)', async () => {
    for (const key of ['sessionId', 'baselineAt'] as const) {
      const missing = input();
      delete missing.routeContext?.[key];
      await expect(measure(missing)).resolves.toBeUndefined();
    }
    await expect(measure({ ...input(), routeContext: undefined })).resolves.toBeUndefined();
  });

  it('returns undefined when the transcript is missing', async () => {
    await expect(measure(input({ sessionId: 'no-such-session' }))).resolves.toBeUndefined();
    expect(locateRouteTranscript(input({ sessionId: '../escape' }))).toBeUndefined();
  });

  it('feeds a v4 row whose coding stage is session-measured', async () => {
    const cost = await measure(input());
    const report = {
      correlationId: 'corr-1',
      recommendedModel: 'claude-sonnet-5',
      actualModel: 'claude-sonnet-5',
      recommendationAccepted: true,
      completionStatus: 'succeeded',
    } as OutcomeReport;
    const result = buildReportContributionRow({
      report,
      routeContext: { taskDescriptor: { task_type: 'bugfix' }, allowedModels: ['claude-sonnet-5', 'claude-opus-4-8'], budgetUsd: 5 },
      inferenceLogId: 'inf-1',
      recommendedModelId: 'claude-sonnet-5',
      stageCost: cost,
      taskId: 'HOK-1',
      harness: 'claude-code',
      observedAt: ENDED,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [stage] = result.value.stage_executions;
    expect(stage?.model_evidence).toBe('session_telemetry');
    expect(stage?.task_cost).toEqual(cost!.summaries[0]);
    expect(result.value.actual_cost_usd).toBe(cost!.summaries[0]!.total_cost_usd);
    expect(result.value.success_under_budget).toBe(true);
  });
});
