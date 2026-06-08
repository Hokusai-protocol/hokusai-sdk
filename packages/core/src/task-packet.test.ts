import { describe, expect, it } from 'vitest';
import {
  TASK_PACKET_SCHEMA_VERSION,
  TaskPacketBuildError,
  buildTaskPacket,
  validateTaskPacket,
} from './task-packet.js';
import {
  claudeCodeTaskPacketFixture,
  codexTaskPacketFixture,
  genericTaskPacketFixture,
  wavemillTaskPacketFixture,
} from './fixtures/index.js';

describe('validateTaskPacket', () => {
  it('accepts a valid packet', () => {
    const packet = {
      schemaVersion: TASK_PACKET_SCHEMA_VERSION,
      userIntent: 'Fix a flaky test and verify the suite.',
      taskFamily: 'bugfix',
      reasoningDepth: 'standard',
      repositoryScale: 'medium',
      languageSignals: ['TypeScript'],
    };

    expect(validateTaskPacket(packet)).toEqual({
      ok: true,
      packet,
    });
  });

  it('rejects missing schemaVersion', () => {
    const result = validateTaskPacket({
      userIntent: 'Investigate a regression.',
      taskFamily: 'investigation',
      reasoningDepth: 'deep',
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContainEqual({
      path: 'schemaVersion',
      message: `Expected "schemaVersion" to be "${TASK_PACKET_SCHEMA_VERSION}".`,
    });
  });

  it('rejects the wrong schema version', () => {
    const result = validateTaskPacket({
      schemaVersion: '2.0.0',
      userIntent: 'Investigate a regression.',
      taskFamily: 'investigation',
      reasoningDepth: 'deep',
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContainEqual({
      path: 'schemaVersion',
      message: `Unsupported schema version "2.0.0". Expected "${TASK_PACKET_SCHEMA_VERSION}".`,
    });
  });

  it('rejects invalid taskFamily values with allowed values listed', () => {
    const result = validateTaskPacket({
      schemaVersion: TASK_PACKET_SCHEMA_VERSION,
      userIntent: 'Do the thing.',
      taskFamily: 'rewrite',
      reasoningDepth: 'standard',
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContainEqual({
      path: 'taskFamily',
      message:
        '"taskFamily" must be one of: bugfix, feature, refactor, test, docs, chore, investigation.',
    });
  });

  it('rejects invalid reasoningDepth and repositoryScale values', () => {
    const result = validateTaskPacket({
      schemaVersion: TASK_PACKET_SCHEMA_VERSION,
      userIntent: 'Do the thing.',
      taskFamily: 'feature',
      reasoningDepth: 'extreme',
      repositoryScale: 'huge',
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toEqual(
      expect.arrayContaining([
        {
          path: 'reasoningDepth',
          message: '"reasoningDepth" must be one of: shallow, standard, deep.',
        },
        {
          path: 'repositoryScale',
          message: '"repositoryScale" must be one of: small, medium, large, xlarge.',
        },
      ]),
    );
  });

  it('rejects unknown top-level keys', () => {
    const result = validateTaskPacket({
      schemaVersion: TASK_PACKET_SCHEMA_VERSION,
      userIntent: 'Do the thing.',
      taskFamily: 'feature',
      reasoningDepth: 'standard',
      fileTree: ['src/index.ts'],
      sourceCode: 'const x = 1;',
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toEqual(
      expect.arrayContaining([
        {
          path: 'fileTree',
          message: 'Unknown field "fileTree" is not allowed in task packets.',
        },
        {
          path: 'sourceCode',
          message: 'Unknown field "sourceCode" is not allowed in task packets.',
        },
      ]),
    );
  });

  it('rejects invalid array contents with field-level paths', () => {
    const result = validateTaskPacket({
      schemaVersion: TASK_PACKET_SCHEMA_VERSION,
      userIntent: 'Do the thing.',
      taskFamily: 'feature',
      reasoningDepth: 'standard',
      languageSignals: ['TypeScript', ''],
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContainEqual({
      path: 'languageSignals[1]',
      message: '"languageSignals" entries must be non-empty strings.',
    });
  });
});

describe('buildTaskPacket', () => {
  it('builds a valid packet from minimal context and applies defaults', () => {
    const packet = buildTaskPacket({
      userIntent: 'Document the public API change.',
      taskFamily: 'docs',
    });

    expect(packet).toEqual({
      schemaVersion: TASK_PACKET_SCHEMA_VERSION,
      userIntent: 'Document the public API change.',
      taskFamily: 'docs',
      reasoningDepth: 'standard',
    });
  });

  it('throws a TaskPacketBuildError for invalid required fields', () => {
    expect(() =>
      buildTaskPacket({
        userIntent: '',
        taskFamily: 'docs',
      }),
    ).toThrow(TaskPacketBuildError);
  });

  it('drops unknown fields from the input context', () => {
    const packet = buildTaskPacket({
      userIntent: 'Refactor the CLI integration.',
      taskFamily: 'refactor',
      reasoningDepth: 'deep',
      frameworkSignals: ['Node.js'],
      unknownField: 'ignored',
    } as typeof wavemillTaskPacketFixture & { unknownField: string });

    expect(packet).toEqual({
      schemaVersion: TASK_PACKET_SCHEMA_VERSION,
      userIntent: 'Refactor the CLI integration.',
      taskFamily: 'refactor',
      reasoningDepth: 'deep',
      frameworkSignals: ['Node.js'],
    });
    expect(packet).not.toHaveProperty('unknownField');
  });
});

describe('task packet fixtures', () => {
  it.each([
    wavemillTaskPacketFixture,
    claudeCodeTaskPacketFixture,
    codexTaskPacketFixture,
    genericTaskPacketFixture,
  ])('validates fixture %#', (fixture) => {
    expect(validateTaskPacket(fixture)).toEqual({
      ok: true,
      packet: fixture,
    });
  });
});
