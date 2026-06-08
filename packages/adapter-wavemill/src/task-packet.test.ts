import { describe, expect, it } from 'vitest';
import { validateTaskPacket } from '@hokusai/core';
import {
  buildWavemillTaskPacket,
  previewWavemillTaskPacket,
} from './task-packet.js';

const redactionConfig = {
  salt: 'wavemill-test-salt',
  knownNames: ['Acme Health'],
  customRules: [
    {
      category: 'id' as const,
      pattern: /\bCUST-[A-Z0-9]+\b/g,
    },
  ],
};

describe('buildWavemillTaskPacket', () => {
  it('builds a valid packet from minimal input', () => {
    const result = buildWavemillTaskPacket(
      {
        taskText: 'Implement a bulk export feature for the reporting dashboard.',
      },
      { redactionConfig },
    );

    expect(validateTaskPacket(result.packet)).toEqual({
      ok: true,
      packet: result.packet,
    });
    expect(result.packet.availableTools).toEqual(['shell', 'git', 'test runner']);
    expect(result.packet.frameworkSignals).toEqual(['pnpm workspace']);
  });

  it('redacts customer names from intent and constraints', () => {
    const result = buildWavemillTaskPacket(
      {
        taskTitle: 'Fix Wavemill Labs sync issue',
        taskText: 'Customer Wavemill Labs is blocked by CUST-1234.',
        constraints: ['Escalate to Wavemill Labs support'],
        customerNames: ['Wavemill Labs'],
      },
      { redactionConfig },
    );

    const serialized = JSON.stringify(result.packet);

    expect(serialized).not.toContain('Wavemill Labs');
    expect(serialized).not.toContain('CUST-1234');
    expect(result.redactionSummary).toEqual(
      expect.arrayContaining([
        { category: 'id', count: 1 },
        { category: 'org', count: 3 },
      ]),
    );
  });

  it('upgrades feature and refactor work to deep reasoning by default', () => {
    const featurePacket = buildWavemillTaskPacket(
      {
        taskText: 'Implement the requested billing notification flow.',
      },
      { redactionConfig },
    );
    const refactorPacket = buildWavemillTaskPacket(
      {
        taskText:
          'Refactor the task runner module while keeping the shared adapter workflow intact.',
      },
      { redactionConfig },
    );

    expect(featurePacket.packet.reasoningDepth).toBe('deep');
    expect(refactorPacket.packet.reasoningDepth).toBe('deep');
  });

  it('passes repository inference through the shared core helpers', () => {
    const result = buildWavemillTaskPacket(
      {
        taskText: 'Investigate the parser regression.',
        repositorySignals: {
          fileCount: 5200,
          extensionCounts: {
            ts: 30,
            tsx: 12,
          },
          dependencyCategories: ['Node.js', 'React'],
        },
      },
      { redactionConfig },
    );

    expect(result.packet.repositoryScale).toBe('large');
    expect(result.packet.languageSignals).toEqual(['TypeScript']);
    expect(result.packet.frameworkSignals).toEqual(['Node.js', 'React']);
  });

  it('merges caller and customer known names without duplicates', () => {
    const result = buildWavemillTaskPacket(
      {
        taskText: 'Coordinate with Acme Health and Wavemill Labs.',
        customerNames: ['Acme Health', 'Wavemill Labs'],
      },
      { redactionConfig },
    );

    expect(result.packet.userIntent).not.toContain('Acme Health');
    expect(result.packet.userIntent).not.toContain('Wavemill Labs');
  });

  it('treats an empty customerNames list as a no-op', () => {
    const result = buildWavemillTaskPacket(
      {
        taskText: 'Coordinate with Acme Health.',
        customerNames: [],
      },
      { redactionConfig },
    );

    expect(result.packet.userIntent).not.toContain('Acme Health');
  });
});

describe('previewWavemillTaskPacket', () => {
  it('matches build output and exposes replay metadata', () => {
    const input = {
      taskText: `Fix the Wavemill Labs regression.
\`\`\`ts
console.log("debug");
\`\`\`
2026-06-08T10:00:00Z ERROR sync failed`,
      constraints: ['Contact ops@wavemill.internal'],
      customerNames: ['Wavemill Labs'],
      priorCorrelationId: 'corr-prev-1',
    };

    const built = buildWavemillTaskPacket(input, { redactionConfig });
    const previewResult = previewWavemillTaskPacket(input, { redactionConfig });

    expect(previewResult.willSend).toEqual(built.packet);
    expect(previewResult.redactionSummary).toEqual(built.redactionSummary);
    expect(previewResult.hasRawCode).toBe(false);
    expect(previewResult.hasRawLogs).toBe(false);
    expect(previewResult.replayCorrelationId).toBe('corr-prev-1');
    expect(previewResult.willSend).not.toHaveProperty('priorCorrelationId');
  });
});
