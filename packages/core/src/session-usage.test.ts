import { describe, expect, it } from 'vitest';
import { buildHarnessOutcomeRow } from './contribution/index.js';
import {
  captureCostBaseline,
  computeTranscriptCostUsd,
  encodeProjectDirKey,
  locateSessionTranscript,
  parseTranscriptUsageTotals,
  readSessionCostSidecar,
  resolveActualCostUsd,
  resolveClaudeConfigDir,
  resolveSidecarCostDiff,
  sessionCostSidecarPath,
  sessionTranscriptDir,
  type SessionUsageFileSystem,
} from './session-usage.js';

/**
 * In-memory filesystem so every test stays off the real `~/.claude`.
 * `files` maps absolute path -> { content, mtimeMs }; `dirs` maps directory ->
 * child entry names.
 */
function makeFs(
  files: Record<string, { content?: string; mtimeMs?: number }>,
  dirs: Record<string, string[]> = {},
): SessionUsageFileSystem {
  const enoent = (message: string): NodeJS.ErrnoException => {
    const error = new Error(message) as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    return error;
  };

  return {
    readFileSync(filePath) {
      const entry = files[filePath];
      if (!entry || entry.content === undefined) {
        throw enoent(`ENOENT: ${filePath}`);
      }
      return entry.content;
    },
    readdirSync(dirPath) {
      const entries = dirs[dirPath];
      if (!entries) {
        throw enoent(`ENOENT: ${dirPath}`);
      }
      return entries;
    },
    statSync(filePath) {
      const entry = files[filePath];
      if (!entry) {
        throw enoent(`ENOENT: ${filePath}`);
      }
      return { mtimeMs: entry.mtimeMs ?? 0 };
    },
  };
}

const CONFIG_DIR = '/fake/.claude';
const ENV: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: CONFIG_DIR };

describe('encodeProjectDirKey', () => {
  it('replaces every non-alphanumeric character with a dash', () => {
    expect(encodeProjectDirKey('/Users/tim/my_proj.v2')).toBe('-Users-tim-my-proj-v2');
  });
});

describe('resolveClaudeConfigDir', () => {
  it('prefers CLAUDE_CONFIG_DIR when set', () => {
    expect(resolveClaudeConfigDir({ env: ENV, homedir: '/home/x' })).toBe(CONFIG_DIR);
  });

  it('falls back to <home>/.claude', () => {
    expect(
      resolveClaudeConfigDir({ env: {}, homedir: '/home/x' }),
    ).toBe('/home/x/.claude');
  });
});

describe('readSessionCostSidecar', () => {
  const sidecarPath = sessionCostSidecarPath(CONFIG_DIR);

  it('reads a well-formed sidecar', () => {
    const fs = makeFs({
      [sidecarPath]: {
        content: JSON.stringify({
          session_id: 'sess-1',
          cost_usd: 0.42,
          updated_at: '2026-07-08T00:00:00.000Z',
          input_tokens: 10,
          output_tokens: 5,
        }),
      },
    });
    expect(readSessionCostSidecar(sidecarPath, fs)).toEqual({
      session_id: 'sess-1',
      cost_usd: 0.42,
      updated_at: '2026-07-08T00:00:00.000Z',
      input_tokens: 10,
      output_tokens: 5,
    });
  });

  it('returns undefined when the file is absent', () => {
    expect(readSessionCostSidecar(sidecarPath, makeFs({}))).toBeUndefined();
  });

  it('returns undefined for malformed JSON', () => {
    const fs = makeFs({ [sidecarPath]: { content: '{not json' } });
    expect(readSessionCostSidecar(sidecarPath, fs)).toBeUndefined();
  });

  it('returns undefined when required fields are missing or invalid', () => {
    const missingSession = makeFs({ [sidecarPath]: { content: JSON.stringify({ cost_usd: 1 }) } });
    expect(readSessionCostSidecar(sidecarPath, missingSession)).toBeUndefined();

    const badCost = makeFs({
      [sidecarPath]: { content: JSON.stringify({ session_id: 's', cost_usd: 'x' }) },
    });
    expect(readSessionCostSidecar(sidecarPath, badCost)).toBeUndefined();
  });
});

describe('captureCostBaseline', () => {
  const nowIso = '2026-07-08T12:00:00.000Z';

  it('adopts a fresh sidecar cost and session id', () => {
    const fs = makeFs({
      [sessionCostSidecarPath(CONFIG_DIR)]: {
        content: JSON.stringify({
          session_id: 'sess-1',
          cost_usd: 0.5,
          updated_at: '2026-07-08T11:59:00.000Z',
        }),
      },
    });
    expect(
      captureCostBaseline({ cwd: '/repo', nowIso, env: ENV, fs }),
    ).toEqual({
      baselineAt: nowIso,
      projectDirKey: '-repo',
      costBaselineUsd: 0.5,
      sessionId: 'sess-1',
    });
  });

  it('records only baselineAt/projectDirKey when no sidecar exists', () => {
    expect(
      captureCostBaseline({ cwd: '/repo', nowIso, env: ENV, fs: makeFs({}) }),
    ).toEqual({ baselineAt: nowIso, projectDirKey: '-repo' });
  });

  it('ignores a stale sidecar cost (outside the freshness window)', () => {
    const fs = makeFs({
      [sessionCostSidecarPath(CONFIG_DIR)]: {
        content: JSON.stringify({
          session_id: 'old',
          cost_usd: 9,
          updated_at: '2020-01-01T00:00:00.000Z',
        }),
      },
    });
    expect(captureCostBaseline({ cwd: '/repo', nowIso, env: ENV, fs })).toEqual({
      baselineAt: nowIso,
      projectDirKey: '-repo',
    });
  });
});

describe('resolveSidecarCostDiff', () => {
  it('diffs against the baseline when the session matches', () => {
    expect(
      resolveSidecarCostDiff({
        sidecar: { session_id: 'sess-1', cost_usd: 1.25 },
        baselineSessionId: 'sess-1',
        costBaselineUsd: 0.25,
      }),
    ).toBe(1);
  });

  it('clamps a negative diff to zero', () => {
    expect(
      resolveSidecarCostDiff({
        sidecar: { session_id: 'sess-1', cost_usd: 0.1 },
        baselineSessionId: 'sess-1',
        costBaselineUsd: 0.5,
      }),
    ).toBe(0);
  });

  it('returns undefined on a session mismatch', () => {
    expect(
      resolveSidecarCostDiff({
        sidecar: { session_id: 'sess-2', cost_usd: 5 },
        baselineSessionId: 'sess-1',
        costBaselineUsd: 1,
      }),
    ).toBeUndefined();
  });

  it('returns undefined without a sidecar or baseline cost', () => {
    expect(
      resolveSidecarCostDiff({
        sidecar: undefined,
        baselineSessionId: 'sess-1',
        costBaselineUsd: 1,
      }),
    ).toBeUndefined();
    expect(
      resolveSidecarCostDiff({
        sidecar: { session_id: 'sess-1', cost_usd: 5 },
        baselineSessionId: 'sess-1',
        costBaselineUsd: undefined,
      }),
    ).toBeUndefined();
  });
});

describe('parseTranscriptUsageTotals', () => {
  it('sums usage across turns, folding cache tokens into input', () => {
    const contents = [
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-07-08T12:01:00.000Z',
        message: {
          role: 'assistant',
          usage: {
            input_tokens: 100,
            output_tokens: 40,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 5,
          },
        },
      }),
      JSON.stringify({
        timestamp: '2026-07-08T12:02:00.000Z',
        usage: { input_tokens: 20, output_tokens: 8 },
      }),
    ].join('\n');

    expect(parseTranscriptUsageTotals({ contents })).toEqual({
      inputTokens: 100 + 20,
      cacheCreationTokens: 10,
      cacheReadTokens: 5,
      outputTokens: 40 + 8,
      turns: 2,
    });
  });

  it('skips malformed lines and lines without usage', () => {
    const contents = [
      '{not json',
      JSON.stringify({ type: 'user', message: { role: 'user' } }),
      '',
      JSON.stringify({
        message: { usage: { input_tokens: 7, output_tokens: 3 } },
      }),
    ].join('\n');

    expect(parseTranscriptUsageTotals({ contents })).toEqual({
      inputTokens: 7,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 3,
      turns: 1,
    });
  });

  it('only counts turns strictly after the baseline timestamp', () => {
    const contents = [
      JSON.stringify({
        timestamp: '2026-07-08T11:59:00.000Z',
        message: { usage: { input_tokens: 999, output_tokens: 999 } },
      }),
      JSON.stringify({
        timestamp: '2026-07-08T12:00:00.000Z',
        message: { usage: { input_tokens: 500, output_tokens: 500 } },
      }),
      JSON.stringify({
        timestamp: '2026-07-08T12:05:00.000Z',
        message: { usage: { input_tokens: 10, output_tokens: 4 } },
      }),
    ].join('\n');

    expect(
      parseTranscriptUsageTotals({ contents, afterIso: '2026-07-08T12:00:00.000Z' }),
    ).toEqual({
      inputTokens: 10,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 4,
      turns: 1,
    });
  });
});

describe('locateSessionTranscript', () => {
  const dir = sessionTranscriptDir(CONFIG_DIR, '/repo');

  it('returns the newest-mtime jsonl file', () => {
    const fs = makeFs(
      {
        [`${dir}/a.jsonl`]: { content: '{}', mtimeMs: 100 },
        [`${dir}/b.jsonl`]: { content: '{}', mtimeMs: 300 },
        [`${dir}/c.txt`]: { content: 'x', mtimeMs: 999 },
      },
      { [dir]: ['a.jsonl', 'b.jsonl', 'c.txt'] },
    );
    expect(locateSessionTranscript({ dir, fs })).toBe(`${dir}/b.jsonl`);
  });

  it('returns undefined when the directory is missing', () => {
    expect(locateSessionTranscript({ dir, fs: makeFs({}) })).toBeUndefined();
  });
});

describe('computeTranscriptCostUsd', () => {
  it('prices summed usage via the model price table', () => {
    const contents = JSON.stringify({
      timestamp: '2026-07-08T12:05:00.000Z',
      message: { usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } },
    });
    // opus: 1M @ $5 + 1M @ $25 = 30
    expect(
      computeTranscriptCostUsd({ contents, model: 'claude-opus-4-8' }),
    ).toBe(30);
  });

  it('prices cache write/read tokens at their reduced rates, not the input rate', () => {
    const contents = JSON.stringify({
      timestamp: '2026-07-08T12:05:00.000Z',
      message: {
        usage: {
          input_tokens: 1_000_000,
          cache_creation_input_tokens: 1_000_000,
          cache_read_input_tokens: 1_000_000,
          output_tokens: 0,
        },
      },
    });
    // opus input $5/M: input 1M @ $5 + cache-write 1M @ $5*1.25 + cache-read 1M @ $5*0.1
    // = 5 + 6.25 + 0.5 = 11.75  (the old folded logic charged 3*5 = 15)
    expect(
      computeTranscriptCostUsd({ contents, model: 'claude-opus-4-8' }),
    ).toBe(11.75);
  });

  it('returns undefined when no turn carried usage', () => {
    expect(
      computeTranscriptCostUsd({ contents: '{}', model: 'claude-opus-4-8' }),
    ).toBeUndefined();
  });
});

describe('resolveActualCostUsd (layered precedence)', () => {
  const baseRouteContext = {
    costBaselineUsd: 0.25,
    sessionId: 'sess-1',
    baselineAt: '2026-07-08T12:00:00.000Z',
    projectDirKey: '-repo',
  };

  it('tier 1: explicit override wins over everything', () => {
    expect(
      resolveActualCostUsd({
        model: 'claude-opus-4-8',
        explicitActualCostUsd: 0.99,
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        routeContext: baseRouteContext,
        env: ENV,
        fs: makeFs({}),
      }),
    ).toBe(0.99);
  });

  it('tier 2: token counts win over auto sources', () => {
    expect(
      resolveActualCostUsd({
        model: 'claude-opus-4-8',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        routeContext: baseRouteContext,
        env: ENV,
        fs: makeFs({}),
      }),
    ).toBe(30);
  });

  it('tier 3: sidecar diff wins when no explicit input', () => {
    const fs = makeFs({
      [sessionCostSidecarPath(CONFIG_DIR)]: {
        content: JSON.stringify({ session_id: 'sess-1', cost_usd: 0.75 }),
      },
    });
    expect(
      resolveActualCostUsd({
        model: 'claude-opus-4-8',
        routeContext: baseRouteContext,
        env: ENV,
        fs,
      }),
    ).toBe(0.5);
  });

  it('tier 4: transcript best-effort when the sidecar is unavailable', () => {
    const dir = `${CONFIG_DIR}/projects/-repo`;
    const fs = makeFs(
      {
        [`${dir}/session.jsonl`]: {
          content: JSON.stringify({
            timestamp: '2026-07-08T12:05:00.000Z',
            message: { usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } },
          }),
          mtimeMs: 500,
        },
      },
      { [dir]: ['session.jsonl'] },
    );
    // No sidecar in fs; routeContext has no costBaselineUsd so tier 3 is skipped.
    expect(
      resolveActualCostUsd({
        model: 'claude-opus-4-8',
        routeContext: {
          baselineAt: '2026-07-08T12:00:00.000Z',
          projectDirKey: '-repo',
        },
        env: ENV,
        fs,
      }),
    ).toBe(30);
  });

  it('tier 5: omits when nothing is available', () => {
    expect(
      resolveActualCostUsd({
        model: 'claude-opus-4-8',
        env: ENV,
        fs: makeFs({}),
      }),
    ).toBeUndefined();
  });

  it('does not touch the filesystem when the routeContext carries no baseline', () => {
    const throwingFs: SessionUsageFileSystem = {
      readFileSync() {
        throw new Error('fs should not be read without a baseline');
      },
      readdirSync() {
        throw new Error('fs should not be read without a baseline');
      },
      statSync() {
        throw new Error('fs should not be read without a baseline');
      },
    };
    expect(
      resolveActualCostUsd({ model: 'claude-opus-4-8', env: ENV, fs: throwingFs }),
    ).toBeUndefined();
  });
});

describe('end-to-end: diffed cost yields a training-eligible harness row', () => {
  it('builds a row with the diffed actual_cost_usd and a budget', () => {
    const fs = makeFs({
      [sessionCostSidecarPath(CONFIG_DIR)]: {
        content: JSON.stringify({ session_id: 'sess-1', cost_usd: 0.9 }),
      },
    });
    const actualCostUsd = resolveActualCostUsd({
      model: 'claude-opus-4-8',
      routeContext: {
        costBaselineUsd: 0.4,
        sessionId: 'sess-1',
        baselineAt: '2026-07-08T12:00:00.000Z',
        projectDirKey: '-repo',
      },
      env: ENV,
      fs,
    });
    expect(actualCostUsd).toBe(0.5);

    const row = buildHarnessOutcomeRow({
      inferenceLogId: 'log-1',
      taskDescriptor: { task_type: 'feature' },
      allowedModels: ['claude-opus-4-8'],
      selectedModels: { coder: 'claude-opus-4-8', reviewer: 'claude-opus-4-8' },
      completionResult: 'success',
      harness: 'claude-code',
      budgetUsd: 1,
      actualCostUsd: actualCostUsd as number,
    });

    // Both budget and actual cost present -> the server can classify this as
    // training-eligible rather than telemetry-only.
    expect(row.budget_usd).toBe(1);
    expect(row.actual_cost_usd).toBe(0.5);
  });

  it('omits actual_cost_usd (partial/telemetry row) when no cost source exists', () => {
    const actualCostUsd = resolveActualCostUsd({
      model: 'claude-opus-4-8',
      routeContext: {
        baselineAt: '2026-07-08T12:00:00.000Z',
        projectDirKey: '-repo',
      },
      env: ENV,
      fs: makeFs({}),
    });
    expect(actualCostUsd).toBeUndefined();

    const row = buildHarnessOutcomeRow({
      inferenceLogId: 'log-1',
      taskDescriptor: { task_type: 'feature' },
      allowedModels: ['claude-opus-4-8'],
      selectedModels: { coder: 'claude-opus-4-8', reviewer: 'claude-opus-4-8' },
      completionResult: 'success',
      harness: 'claude-code',
      budgetUsd: 1,
    });
    expect(row.actual_cost_usd).toBeUndefined();
  });
});
