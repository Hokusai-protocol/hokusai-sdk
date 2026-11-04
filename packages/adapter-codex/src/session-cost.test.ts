import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TechnicalTaskRouterContributionRowV4 } from '@hokusai/core';
import { routeTaskWithCodex, submitOutcomeWithCodex } from './plugin-commands.js';
import {
  codexCallSessionFromMeta,
  codexSessionBaseline,
  codexSessionsDir,
  createCodexStageMeasurer,
} from './session-cost.js';

const SESSION = '01a1a6cc-9f0a-7a03-99c4-3a63077de74c';
const TURN = '01a1a6cc-a271-7432-9a97-dc43c99521b2';
const TURN_STARTED_MS = Date.parse('2026-11-04T13:43:10.000Z');

/** The `tools/call` `_meta` codex-cli 0.166.0 sent in the HOK-3412 spike. */
const spikeMeta = {
  callId: 'exec-72a8a354-5432-4cf1-80da-6387ead05d2d',
  'x-codex-turn-metadata': {
    session_id: SESSION,
    thread_id: SESSION,
    reasoning_effort: 'low',
    turn_id: TURN,
    model: 'gpt-6.1-sol',
    thread_source: 'user',
    turn_trigger: 'exec',
    sandbox: 'seatbelt',
    sandbox_mode: 'read-only',
    turn_started_at_unix_ms: TURN_STARTED_MS,
    codex_version: '0.166.0',
  },
  threadId: SESSION,
  sessionId: SESSION,
  windowId: `${SESSION}:0`,
  progressToken: 1,
};

function tokenCount(timestamp: string, last: Record<string, number>, total: Record<string, number>): string {
  return JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: { type: 'token_count', info: { last_token_usage: last, total_token_usage: total, model_context_window: 272000 } },
  });
}

function usage(input: number, cached: number, output: number) {
  return { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output };
}

/** A 0.166-format rollout: one turn before the route, two responses after it. */
function rollout(sessionId: string, model: string): string {
  return [
    JSON.stringify({ timestamp: '2026-11-04T13:40:00.000Z', type: 'session_meta', payload: { id: sessionId, session_id: sessionId, cli_version: '0.166.0', cwd: '/Users/someone/SENTINEL_PATH', git: { branch: 'SENTINEL_BRANCH' } } }),
    JSON.stringify({ timestamp: '2026-11-04T13:40:01.000Z', type: 'turn_context', payload: { turn_id: 'turn-before', model } }),
    tokenCount('2026-11-04T13:40:05.000Z', usage(5000, 0, 100), usage(5000, 0, 100)),
    JSON.stringify({ timestamp: '2026-11-04T13:43:10.000Z', type: 'turn_context', payload: { turn_id: TURN, model } }),
    tokenCount('2026-11-04T13:43:12.000Z', usage(20000, 13312, 60), usage(25000, 13312, 160)),
    tokenCount('2026-11-04T13:43:15.000Z', usage(19258, 13312, 58), usage(44258, 26624, 218)),
  ].join('\n');
}

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function codexHome(): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'hokusai-codex-home-'));
  tempDirs.push(home);
  const day = path.join(home, 'sessions', '2026', '11', '04');
  await mkdir(day, { recursive: true });
  await writeFile(path.join(day, `rollout-2026-11-04T08-43-10-${SESSION}.jsonl`), rollout(SESSION, 'gpt-6.1-sol'));
  // Another session in the same directory: never read.
  await writeFile(
    path.join(day, 'rollout-2026-11-04T08-44-00-01a1a6cc-ffff-7fff-8fff-ffffffffffff.jsonl'),
    rollout('01a1a6cc-ffff-7fff-8fff-ffffffffffff', 'gpt-6.1-sol'),
  );
  return home;
}

describe('codexCallSessionFromMeta', () => {
  it('reads the session, turn, model and turn start from the spike _meta', () => {
    expect(codexCallSessionFromMeta(spikeMeta)).toEqual({
      sessionId: SESSION,
      turnId: TURN,
      turnStartedAt: '2026-11-04T13:43:10.000Z',
      model: 'gpt-6.1-sol',
    });
  });

  it('falls back to _meta.sessionId, then threadId', () => {
    expect(codexCallSessionFromMeta({ sessionId: SESSION })).toEqual({ sessionId: SESSION });
    expect(codexCallSessionFromMeta({ threadId: SESSION })).toEqual({ sessionId: SESSION });
  });

  it('returns undefined without a safe session id', () => {
    expect(codexCallSessionFromMeta(undefined)).toBeUndefined();
    expect(codexCallSessionFromMeta({ progressToken: 1 })).toBeUndefined();
    expect(codexCallSessionFromMeta({ sessionId: '../../etc' })).toBeUndefined();
  });

  it('becomes a local-only baseline at the route turn start', () => {
    const session = codexCallSessionFromMeta(spikeMeta);
    expect(codexSessionBaseline(session, '2026-11-04T13:43:11.000Z')).toEqual({
      baselineAt: '2026-11-04T13:43:10.000Z',
      sessionId: SESSION,
    });
    expect(codexSessionBaseline(undefined, 'x')).toBeUndefined();
  });
});

describe('createCodexStageMeasurer', () => {
  it('measures only the routed session from the route turn onward', async () => {
    const home = await codexHome();
    const cost = await createCodexStageMeasurer()({
      taskId: 'task-codex',
      executedModel: 'gpt-6.1-sol',
      routeContext: {
        taskDescriptor: { task_type: 'bugfix' },
        allowedModels: ['gpt-6.1-sol'],
        sessionId: SESSION,
        baselineAt: '2026-11-04T13:43:10.000Z',
      },
      endedAt: '2026-11-04T14:00:00.000Z',
      env: { CODEX_HOME: home },
    });
    const summary = cost?.summaries[0];
    expect(cost?.summaries).toHaveLength(1);
    expect(summary?.session_ids).toEqual([SESSION]);
    expect(summary?.harness).toBe('codex');
    expect(summary?.models).toEqual(['gpt-6.1-sol']);
    // Disjoint buckets (codex/2): cached input is subtracted from input.
    expect(summary?.usage).toMatchObject({
      input_tokens: 20000 - 13312 + (19258 - 13312),
      cache_read_tokens: 26624,
      output_tokens: 118,
    });
    expect(JSON.stringify(cost)).not.toMatch(/sentinel/i);
  });

  it('returns undefined without a stored session', async () => {
    await expect(
      createCodexStageMeasurer()({
        taskId: 't',
        executedModel: 'gpt-6.1-sol',
        routeContext: { taskDescriptor: {}, allowedModels: [] },
        endedAt: '2026-11-04T14:00:00.000Z',
      }),
    ).resolves.toBeUndefined();
  });

  it('defaults to ~/.codex/sessions and honours CODEX_HOME', () => {
    expect(codexSessionsDir({}, '/home/me')).toBe('/home/me/.codex/sessions');
    expect(codexSessionsDir({ CODEX_HOME: '/opt/codex' }, '/home/me')).toBe('/opt/codex/sessions');
  });
});

describe('route → submit with a Codex session (end to end)', () => {
  it('submits a v4 row whose coding stage is the measured rollout', async () => {
    const home = await codexHome();
    const configDir = await mkdtemp(path.join(os.tmpdir(), 'hokusai-codex-plugin-'));
    tempDirs.push(configDir);
    const env = {
      HOKUSAI_CONFIG_DIR: configDir,
      HOKUSAI_API_KEY: 'hk_test',
      HOKUSAI_OUTCOME_OPT_IN: 'true',
      CODEX_HOME: home,
    };
    const bodies: { url: string; body: unknown }[] = [];
    const transport = (url: string, init?: { body?: unknown }) => {
      bodies.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      const payload = url.includes('contribution')
        ? { accepted: true, rowsAccepted: 1 }
        : {
            routeId: 'route-codex',
            taskId: 'task-codex',
            status: 'accepted',
            recommendation: { model: 'gpt-5-codex', reason: 'Best fit.', confidence: 0.9 },
          };
      return Promise.resolve({
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify(payload)),
      });
    };
    const clock = () => new Date('2026-11-04T13:43:11.000Z');

    const routed = await routeTaskWithCodex(
      { task: 'Fix the flaky test.', taskId: 'task-codex', maxCostUsd: 5 },
      { env, transport, clock, session: codexCallSessionFromMeta(spikeMeta) },
    );
    expect(routed.ok).toBe(true);
    // The session id stays local: it is not in the route request.
    expect(JSON.stringify(bodies[0]?.body)).not.toContain(SESSION);

    const submitted = await submitOutcomeWithCodex(
      {
        taskId: 'task-codex',
        actualModel: 'gpt-5-codex',
        recommendationAccepted: true,
        completionStatus: 'succeeded',
        latencyBucket: 'low',
        costBucket: 'low',
        tokenBucket: 'low',
        approve: true,
      },
      { env, transport, clock: () => new Date('2026-11-04T14:00:00.000Z') },
    );
    expect(submitted.ok).toBe(true);

    const contribution = bodies.find((entry) => entry.url.includes('contribution'))?.body as {
      rows: TechnicalTaskRouterContributionRowV4[];
    };
    const row = contribution.rows[0]!;
    expect(row.schema_version).toBe('technical_task_router_row/v4');
    expect(row.task_id).toBe('task-codex');
    expect(row.stage_executions).toHaveLength(1);
    const [stage] = row.stage_executions;
    // The rollout says gpt-6.1-sol ran, not the reported gpt-5-codex: the
    // session wins, and the departure from the recommendation is an override.
    expect(stage).toMatchObject({
      stage: 'coding',
      harness: 'codex',
      executed_model: 'gpt-6.1-sol',
      model_evidence: 'session_telemetry',
    });
    expect(row.selected_models).toEqual({ coder: 'gpt-6.1-sol', reviewer: 'gpt-6.1-sol' });
    expect(row.overrides).toEqual(
      (['coder', 'reviewer'] as const).map((role) => ({
        role,
        source: 'observed',
        from: 'gpt-5-codex',
        to: 'gpt-6.1-sol',
        reason: 'session_model_differs',
      })),
    );
    expect(stage?.task_cost.session_ids).toEqual([SESSION]);
    expect(stage?.task_cost.usage.output_tokens).toBe(118);
    expect(row.sdk_version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
