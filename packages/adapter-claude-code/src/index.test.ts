import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REDACTION_CONFIG,
  HokusaiClient,
  TASK_PACKET_SCHEMA_VERSION,
  TaskPacketBuildError,
  validateTaskPacket,
} from '@hokusai/core';
import {
  buildTaskPacket,
  bucketRepositoryScale,
  classifyTaskFamily,
  createClaudeCodeAdapter,
  deriveFrameworkSignals,
  deriveLanguageSignals,
  previewTaskPacket,
  type ClaudeCodeFileSummary,
  type ClaudeCodeTaskInput,
} from './index.js';

// Sensitive fixture modeled on real private-looking inputs (values are fake test data)
const SENSITIVE_INPUT: ClaudeCodeTaskInput = {
  userIntent:
    'Fix the crash for alice@acme-corp.com using AKIAIOSFODNN7EXAMPLE at https://internal.acme.local/admin for Globex Corp',
  files: [
    { extension: '.ts', count: 42 },
    { extension: '.ts', count: 18 },
    { extension: '.py', count: 10 },
    { extension: '.xyz', count: 3 },
  ],
  deps: ['package.json', 'Cargo.toml'],
  constraints: {
    latencyPreference: 'low',
    costPreference: 'low',
    reasoningDepth: 'standard',
    tools: ['filesystem', 'terminal', 'terminal'],
    modelConstraints: ['contact billing@acme-corp.com for quota'],
    providerConstraints: ['tool-use required for https://internal.acme.local/rpc'],
  },
};

const TEST_OPTIONS = {
  redaction: { ...DEFAULT_REDACTION_CONFIG, salt: 'test-salt', knownNames: ['Globex Corp'] },
};

describe('createClaudeCodeAdapter', () => {
  it('returns stable manifest and command metadata', () => {
    const apiClient = new HokusaiClient({
      apiKey: 'k_test',
      transport: () =>
        Promise.resolve({
          status: 200,
          headers: { get: () => null },
          text: () =>
            Promise.resolve(
              JSON.stringify({
                routeId: 'route-1',
                taskId: 'task-1',
                status: 'accepted',
              }),
            ),
        }),
    });

    const adapter = createClaudeCodeAdapter({
      apiClient,
      modelId: 'claude-sonnet',
      packageVersion: '0.1.0',
    });

    expect(adapter.apiClient).toBe(apiClient);
    expect(adapter.harness).toBe('claude-code');
    expect(adapter.commands[0]?.name).toBe('hokusai.run');
    expect(adapter.manifest.entrypoint).toBe('hokusai');
  });
});

// REQ-F1: built packet validates via validateTaskPacket
describe('REQ-F1: buildTaskPacket produces a valid TaskPacket', () => {
  it('validates with the core validator', () => {
    const packet = buildTaskPacket(SENSITIVE_INPUT, TEST_OPTIONS);
    const result = validateTaskPacket(packet);
    expect(result.ok).toBe(true);
  });

  it('always sets schemaVersion correctly', () => {
    const packet = buildTaskPacket({ userIntent: 'Add a new endpoint.' });
    expect(packet.schemaVersion).toBe(TASK_PACKET_SCHEMA_VERSION);
  });
});

// REQ-F2: task-family classification
describe('REQ-F2: classifyTaskFamily', () => {
  it.each([
    ['Fix the crash when user logs in', 'bug'],
    ['Add a new payment feature', 'feature'],
    ['Migrate the database schema to v3', 'migration'],
    ['Update the README and add jsdoc comments', 'docs'],
    ['Refactor the billing module', 'refactor'],
    ['Add tests for the auth service', 'test'],
    ['Deploy infra changes to production', 'infra'],
  ] as const)('classifies "%s" as %s', (intent, expected) => {
    expect(classifyTaskFamily(intent)).toBe(expected);
  });

  it('returns mixed when two signals match', () => {
    expect(classifyTaskFamily('Fix bug and add tests')).toBe('mixed');
  });

  it('returns mixed for unrecognized intent', () => {
    expect(classifyTaskFamily('xyzzy frob blort')).toBe('mixed');
  });

  it('returns mixed for empty string', () => {
    expect(classifyTaskFamily('')).toBe('mixed');
  });
});

// REQ-F3: language/framework signals
describe('REQ-F3: deriveLanguageSignals and deriveFrameworkSignals', () => {
  it('deduplicates the same extension appearing multiple times', () => {
    const files: ClaudeCodeFileSummary[] = [
      { extension: '.ts', count: 10 },
      { extension: '.ts', count: 5 },
    ];
    expect(deriveLanguageSignals(files)).toEqual(['TypeScript']);
  });

  it('drops unknown extensions', () => {
    const files: ClaudeCodeFileSummary[] = [
      { extension: '.ts', count: 3 },
      { extension: '.xyz', count: 99 },
    ];
    expect(deriveLanguageSignals(files)).toEqual(['TypeScript']);
  });

  it('maps known manifest names to framework labels', () => {
    const signals = deriveFrameworkSignals(['package.json', 'Cargo.toml', 'unknown-dep']);
    expect(signals).toContain('Node.js');
    expect(signals).toContain('Rust/Cargo');
    expect(signals).not.toContain('unknown-dep');
  });

  it('ensures packet contains no raw file paths', () => {
    const packet = buildTaskPacket(
      {
        userIntent: 'Refactor auth module.',
        files: [{ extension: '.ts', count: 5 }],
      },
      TEST_OPTIONS,
    );
    const json = JSON.stringify(packet);
    expect(json).not.toMatch(/src\//);
    expect(json).not.toMatch(/\.\/[a-z]/);
    expect(json).not.toMatch(/packages\//);
  });
});

// REQ-F4: repository scale bucketing
describe('REQ-F4: bucketRepositoryScale', () => {
  it.each([
    [5, 'small'],
    [49, 'small'],
    [50, 'medium'],
    [80, 'medium'],
    [499, 'medium'],
    [500, 'large'],
    [800, 'large'],
    [4999, 'large'],
    [5000, 'xlarge'],
    [6000, 'xlarge'],
  ] as const)('%d files → %s', (count, expected) => {
    expect(bucketRepositoryScale(count)).toBe(expected);
  });

  it('reflects scale in buildTaskPacket output', () => {
    for (const [count, expected] of [
      [5, 'small'],
      [80, 'medium'],
      [800, 'large'],
      [6000, 'xlarge'],
    ] as const) {
      const packet = buildTaskPacket(
        { userIntent: 'Scale test.', files: [{ extension: '.ts', count }] },
        TEST_OPTIONS,
      );
      expect(packet.repositoryScale).toBe(expected);
    }
  });
});

// REQ-F5: sensitive values are absent from the packet JSON
describe('REQ-F5: anonymization of sensitive values', () => {
  it('redacts email addresses', () => {
    const packet = buildTaskPacket(SENSITIVE_INPUT, TEST_OPTIONS);
    const json = JSON.stringify(packet);
    expect(json).not.toContain('alice@acme-corp.com');
  });

  it('redacts AWS access key IDs', () => {
    const packet = buildTaskPacket(SENSITIVE_INPUT, TEST_OPTIONS);
    const json = JSON.stringify(packet);
    expect(json).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('redacts internal URLs', () => {
    const packet = buildTaskPacket(SENSITIVE_INPUT, TEST_OPTIONS);
    const json = JSON.stringify(packet);
    expect(json).not.toContain('https://internal.acme.local/admin');
  });

  it('redacts known org names', () => {
    const packet = buildTaskPacket(SENSITIVE_INPUT, TEST_OPTIONS);
    const json = JSON.stringify(packet);
    expect(json).not.toContain('Globex Corp');
  });

  it('redacts sensitive values in free-text constraint arrays', () => {
    const packet = buildTaskPacket(SENSITIVE_INPUT, TEST_OPTIONS);
    const json = JSON.stringify(packet);
    expect(json).not.toContain('billing@acme-corp.com');
    expect(json).not.toContain('https://internal.acme.local/rpc');
  });

  it('produces redaction categories in preview summary', () => {
    const preview = previewTaskPacket(SENSITIVE_INPUT, TEST_OPTIONS);
    const categories = preview.redactionSummary.map((r) => r.category);
    expect(categories).toContain('email');
    expect(categories).toContain('secret');
    expect(categories).toContain('url');
  });
});

// REQ-F6: preview is byte-identical to build
describe('REQ-F6: previewTaskPacket is consistent with buildTaskPacket', () => {
  it('preview.packet deep-equals the result of buildTaskPacket', () => {
    const packet = buildTaskPacket(SENSITIVE_INPUT, TEST_OPTIONS);
    const preview = previewTaskPacket(SENSITIVE_INPUT, TEST_OPTIONS);
    expect(preview.packet).toEqual(packet);
  });

  it('preview.json is a valid JSON string of the packet', () => {
    const preview = previewTaskPacket(SENSITIVE_INPUT, TEST_OPTIONS);
    expect(() => JSON.parse(preview.json) as unknown).not.toThrow();
    expect(JSON.parse(preview.json) as unknown).toEqual(preview.packet);
  });

  it('preview.json keys are sorted for determinism', () => {
    const preview = previewTaskPacket({ userIntent: 'Add a widget.' }, TEST_OPTIONS);
    const keys = Object.keys(JSON.parse(preview.json) as Record<string, unknown>);
    expect(keys).toEqual([...keys].sort());
  });

  it('makes no network calls (transport spy is never invoked)', () => {
    let transportCalls = 0;
    const apiClient = new HokusaiClient({
      apiKey: 'k_test',
      transport: () => {
        transportCalls += 1;
        return Promise.resolve({
          status: 200,
          headers: { get: () => null },
          text: () => Promise.resolve('{}'),
        });
      },
    });
    // Construct an adapter so the client is wired up in the same way a real caller would use it.
    createClaudeCodeAdapter({ apiClient, modelId: 'claude-sonnet', packageVersion: '0.1.0' });
    previewTaskPacket(SENSITIVE_INPUT, TEST_OPTIONS);
    previewTaskPacket({ userIntent: 'Add a widget.' }, TEST_OPTIONS);
    expect(transportCalls).toBe(0);
  });
});

// REQ-F7: absent constraints omitted; present constraints populated
describe('REQ-F7: constraint field handling', () => {
  it('omits constraints when none are provided', () => {
    const packet = buildTaskPacket({ userIntent: 'Minimal input.' }, TEST_OPTIONS);
    expect(packet.constraints).toBeUndefined();
    expect(packet.availableTools).toBeUndefined();
    expect(packet.modelConstraints).toBeUndefined();
    expect(packet.providerConstraints).toBeUndefined();
  });

  it('includes latency:low and cost:low tags when specified', () => {
    const packet = buildTaskPacket(
      {
        userIntent: 'Build fast.',
        constraints: { latencyPreference: 'low', costPreference: 'low' },
      },
      TEST_OPTIONS,
    );
    expect(packet.constraints).toContain('latency:low');
    expect(packet.constraints).toContain('cost:low');
  });

  it('deduplicates and sorts availableTools', () => {
    const packet = buildTaskPacket(
      {
        userIntent: 'Run tests.',
        constraints: { tools: ['terminal', 'filesystem', 'terminal'] },
      },
      TEST_OPTIONS,
    );
    expect(packet.availableTools).toEqual(['filesystem', 'terminal']);
  });

  it('omits repositoryScale when files are not provided', () => {
    const packet = buildTaskPacket({ userIntent: 'Quick fix.' }, TEST_OPTIONS);
    expect(packet.repositoryScale).toBeUndefined();
  });
});

// REQ-F8: null/invalid input throws a typed error
describe('REQ-F8: input validation', () => {
  it('throws TaskPacketBuildError for null input', () => {
    expect(() => buildTaskPacket(null as never)).toThrow(TaskPacketBuildError);
  });

  it('throws TaskPacketBuildError for empty userIntent', () => {
    expect(() => buildTaskPacket({ userIntent: '' }, TEST_OPTIONS)).toThrow(TaskPacketBuildError);
  });
});
