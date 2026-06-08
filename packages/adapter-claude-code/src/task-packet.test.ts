import { describe, expect, it } from 'vitest';
import {
  TASK_PACKET_SCHEMA_VERSION,
  validateTaskPacket,
} from '@hokusai/core';
import {
  buildClaudeCodeTaskPacket,
  previewClaudeCodeTaskPacket,
} from './task-packet.js';

const redactionConfig = {
  salt: 'claude-code-test-salt',
  knownNames: ['Acme Health'],
  customRules: [
    {
      category: 'id' as const,
      pattern: /\bCUST-[A-Z0-9]+\b/g,
    },
  ],
};

describe('buildClaudeCodeTaskPacket', () => {
  it('builds a valid feature packet from plain task text', () => {
    const result = buildClaudeCodeTaskPacket(
      {
        taskText: 'Implement a bulk export feature for the reporting dashboard.',
        repositorySignals: {
          fileCount: 240,
          extensionCounts: {
            ts: 30,
            tsx: 12,
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
      userIntent: 'Implement a bulk export feature for the reporting dashboard.',
      taskFamily: 'feature',
      reasoningDepth: 'standard',
      repositoryScale: 'medium',
      languageSignals: ['TypeScript'],
      frameworkSignals: ['Node.js', 'React'],
    });
  });

  it('redacts private-looking input across text and constraints', () => {
    const result = buildClaudeCodeTaskPacket(
      {
        taskTitle: 'Fix Acme Health production sync issue',
        taskText: `Email ops@acme.example and use sk-1234567890abcdef.
Reach https://db-prod.internal.acme.example/debug with tok-abcdef123456.
Customer CUST-1234 is blocked.
\`\`\`ts
const password = "super-secret";
\`\`\`
2026-06-08T10:00:00Z ERROR sync failed`,
        constraints: [
          "Prefer Acme Health's internal API",
          'Notify jane.doe@acme.example when done',
        ],
      },
      { redactionConfig },
    );

    const serialized = JSON.stringify(result.packet);

    for (const secret of [
      'ops@acme.example',
      'sk-1234567890abcdef',
      'https://db-prod.internal.acme.example/debug',
      'db-prod.internal.acme.example',
      'tok-abcdef123456',
      'Acme Health',
      'CUST-1234',
      'password = "super-secret"',
      '2026-06-08T10:00:00Z ERROR sync failed',
      'jane.doe@acme.example',
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
    const result = buildClaudeCodeTaskPacket(
      {
        taskText: 'sk-1234567890abcdef',
      },
      { redactionConfig },
    );

    expect(result.packet.userIntent).toMatch(/^SECRET_/);
    expect(validateTaskPacket(result.packet)).toEqual({
      ok: true,
      packet: result.packet,
    });
  });

  it('lets caller overrides pass through unchanged', () => {
    const result = buildClaudeCodeTaskPacket(
      {
        taskText: 'Investigate the parser issue.',
        taskFamily: 'migration',
        reasoningDepth: 'deep',
      },
      { redactionConfig },
    );

    expect(result.packet.taskFamily).toBe('migration');
    expect(result.packet.reasoningDepth).toBe('deep');
  });

  it.each([
    [50, 'small'],
    [500, 'medium'],
    [5000, 'large'],
    [15000, 'xlarge'],
  ] as const)('maps %i files to %s repository scale', (fileCount, expected) => {
    const result = buildClaudeCodeTaskPacket(
      {
        taskText: 'Implement feature work.',
        repositorySignals: { fileCount },
      },
      { redactionConfig },
    );

    expect(result.packet.repositoryScale).toBe(expected);
  });

  it.each([
    ['Fix the auth regression.', 'bugfix'],
    ['Add the mobile settings feature.', 'feature'],
    ['Run the alembic migration.', 'migration'],
    ['Refactor the queue naming.', 'refactor'],
    ['Add vitest coverage.', 'test'],
    ['Update the README docs.', 'docs'],
    ['Repair the CI deploy pipeline.', 'infra'],
    ['Fix the bug and add a test.', 'mixed'],
  ] as const)('infers %s as %s', (taskText, expected) => {
    const result = buildClaudeCodeTaskPacket(
      { taskText },
      { redactionConfig },
    );

    expect(result.packet.taskFamily).toBe(expected);
  });

  it('adds latency and cost preferences to constraints', () => {
    const result = buildClaudeCodeTaskPacket(
      {
        taskText: 'Implement the router changes.',
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

  it('throws on empty task text', () => {
    expect(() =>
      buildClaudeCodeTaskPacket(
        { taskText: '   ' },
        { redactionConfig },
      ),
    ).toThrow('Expected "taskText" to be a non-empty string.');
  });
});

describe('previewClaudeCodeTaskPacket', () => {
  it('matches build output and reports raw content flags after redaction', () => {
    const input = {
      taskText: `Fix the Acme Health regression.
\`\`\`ts
console.log("debug");
\`\`\`
2026-06-08T10:00:00Z ERROR sync failed`,
      constraints: ['Contact ops@acme.example'],
    };

    const built = buildClaudeCodeTaskPacket(input, { redactionConfig });
    const previewResult = previewClaudeCodeTaskPacket(input, { redactionConfig });

    expect(previewResult.willSend).toEqual(built.packet);
    expect(previewResult.redactionSummary).toEqual(built.redactionSummary);
    expect(previewResult.hasRawCode).toBe(false);
    expect(previewResult.hasRawLogs).toBe(false);
  });
});
