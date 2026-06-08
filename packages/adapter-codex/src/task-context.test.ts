import { describe, expect, it } from 'vitest';
import {
  TASK_PACKET_SCHEMA_VERSION,
  validateTaskPacket,
} from '@hokusai/core';
import {
  buildCodexHarnessTaskContext,
  buildCodexTaskPacket,
  previewCodexTaskPacket,
} from './task-context.js';

const redactionConfig = {
  salt: 'codex-test-salt',
  knownNames: ['OpenAI Codex'],
  customRules: [
    {
      category: 'id' as const,
      pattern: /\bCASE-[A-Z0-9]+\b/g,
    },
  ],
};

describe('buildCodexTaskPacket', () => {
  it('builds a valid task packet from codex telemetry', () => {
    const result = buildCodexTaskPacket(
      {
        taskSummary: 'Refactor a service and validate with focused tests.',
        model: 'gpt-5-codex',
        taskFamily: 'refactor',
        reasoningDepth: 'deep',
        repositorySignals: {
          fileCount: 280,
          extensionCounts: {
            ts: 30,
            py: 12,
          },
          dependencyCategories: ['React', 'Node.js'],
        },
      },
      { redactionConfig },
    );

    expect(validateTaskPacket(result.packet)).toEqual({
      ok: true,
      packet: result.packet,
    });
    expect(result.packet).toEqual({
      schemaVersion: TASK_PACKET_SCHEMA_VERSION,
      userIntent:
        'Refactor a service and validate with focused tests.\n\nRequested model: gpt-5-codex',
      taskFamily: 'refactor',
      reasoningDepth: 'deep',
      repositoryScale: 'medium',
      languageSignals: ['Python', 'TypeScript'],
      frameworkSignals: ['Node.js', 'React'],
    });
  });

  it('redacts private-looking telemetry fields', () => {
    const result = buildCodexTaskPacket(
      {
        taskTitle: 'Fix OpenAI Codex production issue',
        taskSummary: `Email ops@openai.example and use sk-1234567890abcdef.
Reach https://codex-worker.internal/debug with tok-abcdef123456.
Customer CASE-1234 is blocked.
\`\`\`ts
const password = "super-secret";
\`\`\`
2026-06-08T10:00:00Z ERROR dispatch failed`,
        constraints: [
          "Prefer OpenAI Codex's internal API",
          'Notify jane.doe@openai.example when done',
        ],
      },
      { redactionConfig },
    );

    const serialized = JSON.stringify(result.packet);

    for (const secret of [
      'ops@openai.example',
      'sk-1234567890abcdef',
      'https://codex-worker.internal/debug',
      'codex-worker.internal',
      'tok-abcdef123456',
      'OpenAI Codex',
      'CASE-1234',
      'password = "super-secret"',
      '2026-06-08T10:00:00Z ERROR dispatch failed',
      'jane.doe@openai.example',
    ]) {
      expect(serialized).not.toContain(secret);
    }

    expect(result.redactionSummary).toEqual(
      expect.arrayContaining([
        { category: 'email', count: 2 },
        { category: 'log', count: 1 },
        { category: 'org', count: 2 },
        { category: 'secret', count: 1 },
        { category: 'token', count: 1 },
        { category: 'url', count: 1 },
      ]),
    );
  });

  it('keeps placeholder-only intents valid after redaction', () => {
    const result = buildCodexTaskPacket(
      {
        taskSummary: 'sk-1234567890abcdef',
      },
      { redactionConfig },
    );

    expect(result.packet.userIntent).toMatch(/^SECRET_/);
    expect(validateTaskPacket(result.packet)).toEqual({
      ok: true,
      packet: result.packet,
    });
  });

  it.each([
    [50, 'small'],
    [500, 'medium'],
    [5000, 'large'],
    [15000, 'xlarge'],
  ] as const)('maps %i files to %s repository scale', (fileCount, expected) => {
    const result = buildCodexTaskPacket(
      {
        taskSummary: 'Implement feature work.',
        repositorySignals: { fileCount },
      },
      { redactionConfig },
    );

    expect(result.packet.repositoryScale).toBe(expected);
  });

  it.each([
    ['Fix the auth regression.', 'bugfix'],
    ['Add the mobile settings feature.', 'feature'],
    ['Run the prisma migration.', 'migration'],
    ['Refactor the queue naming.', 'refactor'],
    ['Add vitest coverage.', 'test'],
    ['Update the README docs.', 'docs'],
    ['Repair the CI deploy pipeline.', 'infra'],
    ['Fix the bug and add a test.', 'mixed'],
  ] as const)('infers %s as %s', (taskSummary, expected) => {
    const result = buildCodexTaskPacket(
      { taskSummary },
      { redactionConfig },
    );

    expect(result.packet.taskFamily).toBe(expected);
  });

  it('adds latency and cost preferences to constraints', () => {
    const result = buildCodexTaskPacket(
      {
        taskSummary: 'Implement the router changes.',
        latencyPreference: 'low-latency',
        costPreference: 'minimize-cost',
      },
      { redactionConfig },
    );

    expect(result.packet.constraints).toEqual([
      'latency:low-latency',
      'cost:minimize-cost',
    ]);
  });

  it('throws on empty task summary', () => {
    expect(() =>
      buildCodexTaskPacket(
        { taskSummary: '   ' },
        { redactionConfig },
      ),
    ).toThrow('Expected "taskSummary" to be a non-empty string.');
  });
});

describe('previewCodexTaskPacket', () => {
  it('matches build output and reports raw content flags after redaction', () => {
    const input = {
      taskSummary: `Fix the OpenAI Codex regression.
\`\`\`ts
console.log("debug");
\`\`\`
2026-06-08T10:00:00Z ERROR sync failed`,
      constraints: ['Contact ops@openai.example'],
    };

    const built = buildCodexTaskPacket(input, { redactionConfig });
    const previewResult = previewCodexTaskPacket(input, { redactionConfig });

    expect(previewResult.willSend).toEqual(built.packet);
    expect(previewResult.redactionSummary).toEqual(built.redactionSummary);
    expect(previewResult.hasRawCode).toBe(false);
    expect(previewResult.hasRawLogs).toBe(false);
  });
});

describe('buildCodexHarnessTaskContext', () => {
  it('derives a harness context from redacted telemetry', () => {
    const context = buildCodexHarnessTaskContext(
      {
        taskId: 'task-123',
        taskSummary: 'Refactor services for CASE-1234.',
        model: 'gpt-5-codex',
        cwd: '/repo',
        command: 'codex run',
        configPath: '/repo/.codex/config.json',
        metadata: {
          sessionId: 'session-1',
        },
        harnessVersion: '1.2.3',
      },
      { redactionConfig },
    );

    expect(context).toEqual({
      task: {
        id: 'task-123',
        prompt: expect.stringContaining('Refactor services'),
        metadata: expect.objectContaining({
          model: 'gpt-5-codex',
          sessionId: 'session-1',
          taskFamily: 'refactor',
        }),
      },
      harness: {
        name: 'codex',
        version: '1.2.3',
      },
      cwd: '/repo',
      command: 'codex run',
      configPath: '/repo/.codex/config.json',
      metadata: expect.objectContaining({
        model: 'gpt-5-codex',
      }),
    });
  });
});
