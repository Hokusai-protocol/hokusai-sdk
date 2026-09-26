import { describe, expect, it } from 'vitest';
import { actionFlagIsTrue, buildActionArgv, readActionInput } from './action-io.js';

function envOf(inputs: Record<string, string>) {
  return (name: string) => inputs[name];
}

describe('readActionInput', () => {
  it('reads INPUT_* variables with GitHub’s name mangling', () => {
    expect(readActionInput({ INPUT_MODE: 'label' }, 'mode')).toBe('label');
    expect(readActionInput({ 'INPUT_PR_NUMBER': '7' }, 'pr number')).toBe('7');
  });

  it('treats empty and whitespace values as absent', () => {
    expect(readActionInput({ INPUT_MODE: '  ' }, 'mode')).toBeUndefined();
    expect(readActionInput({}, 'mode')).toBeUndefined();
  });
});

describe('actionFlagIsTrue', () => {
  it('accepts true/1/yes case-insensitively', () => {
    for (const value of ['true', 'TRUE', '1', 'yes']) expect(actionFlagIsTrue(value)).toBe(true);
    for (const value of ['false', '0', 'no', '', undefined]) {
      expect(actionFlagIsTrue(value)).toBe(false);
    }
  });
});

describe('buildActionArgv', () => {
  it('maps every input to its CLI flag', () => {
    const { argv, outputPath } = buildActionArgv({
      input: envOf({
        'mode': 'scan',
        'integration-branch': 'auto/integration',
        'pr-number': '12',
        'github-repo': 'o/r',
        'as-of': '2026-01-01T00:00:00Z',
        'horizons': '14,30',
        'no-links': 'true',
        'debug': 'false',
        'output-path': 'result.jsonl',
      }),
      runnerTemp: '/tmp/runner',
      workspace: '/work/checkout',
    });
    expect(argv).toEqual([
      'scan',
      '--repo', '/work/checkout',
      '--integration-branch', 'auto/integration',
      '--pr', '12',
      '--github-repo', 'o/r',
      '--as-of', '2026-01-01T00:00:00Z',
      '--horizons', '14,30',
      '--no-links',
      '--out', '/tmp/runner/result.jsonl',
    ]);
    expect(outputPath).toBe('/tmp/runner/result.jsonl');
  });

  it('maps report mode without a --repo and with the report flags', () => {
    const { argv, outputPath } = buildActionArgv({
      input: envOf({
        'mode': 'report',
        'inputs-path': '/tmp/shadow-inputs',
        'report-format': 'json',
        'report-horizon': '30',
        'as-of': '2026-01-01T00:00:00Z',
        'output-path': 'last-report.json',
      }),
      runnerTemp: '/tmp/runner',
      workspace: '/work/checkout',
    });
    expect(argv).toEqual([
      'report',
      '--as-of', '2026-01-01T00:00:00Z',
      '--inputs', '/tmp/shadow-inputs',
      '--format', 'json',
      '--horizon', '30',
      '--out', '/tmp/runner/last-report.json',
    ]);
    expect(outputPath).toBe('/tmp/runner/last-report.json');
  });

  it('maps max-prs for label mode', () => {
    const { argv } = buildActionArgv({
      input: envOf({
        'mode': 'label',
        'integration-branch': 'auto/integration',
        'max-prs': '120',
      }),
      runnerTemp: '/tmp/runner',
      workspace: '/work/checkout',
    });
    expect(argv).toContain('--max-prs');
    expect(argv[argv.indexOf('--max-prs') + 1]).toBe('120');
  });

  it('keeps an absolute output-path as given', () => {
    const { outputPath } = buildActionArgv({
      input: envOf({ mode: 'extract', 'pr-number': '3', 'output-path': '/data/out.json' }),
      runnerTemp: '/tmp/runner',
      workspace: '/work',
    });
    expect(outputPath).toBe('/data/out.json');
  });

  it('defaults the repo to the workspace and the output into RUNNER_TEMP', () => {
    const { argv, outputPath } = buildActionArgv({
      input: envOf({ mode: 'label', 'integration-branch': 'integ' }),
      runnerTemp: '/tmp/runner',
      workspace: '/work',
    });
    expect(argv.slice(0, 3)).toEqual(['label', '--repo', '/work']);
    expect(outputPath).toBe('/tmp/runner/hokusai-scan-output.jsonl');
  });
});
