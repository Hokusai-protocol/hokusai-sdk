/**
 * Shadow-mode aggregator tests (HOK-2820).
 *
 * Golden coverage runs the aggregator over
 * `fixtures/arbiter/shadow-report/inputs/` — 12 synthetic PRs across two
 * repos, mixed horizons and reason codes — and asserts:
 * (a) dedupe by (prUrl, horizon) keeps the latest computed_at,
 * (b) the suppression floor withholds precision under 5 reworked PRs,
 * (c) the placeholder rule produces the expected TP / FP / flag counts,
 * (d) markdown and JSON output are byte-stable given a pinned as-of.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CandidateFeaturesV1 } from '@hokusai/core';
import {
  DEFAULT_REPORT_HORIZON,
  PLACEHOLDER_RULE_PHRASE,
  PRECISION_SUPPRESSION_FLOOR,
  aggregateShadowScans,
  evaluateShadowRule,
  parsePrUrl,
  prNumberFromSource,
  renderShadowReportMarkdown,
  serializeShadowReport,
  type ShadowScanInput,
} from './shadow-aggregate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(__dirname, '../../../fixtures/arbiter/shadow-report');
const AS_OF = new Date('2026-09-26T00:00:00Z');

function readFixtureInputs(): ShadowScanInput[] {
  const inputsDir = join(FIXTURE_ROOT, 'inputs');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.jsonl?$/.test(entry.name)) files.push(full);
    }
  };
  walk(inputsDir);
  return files.map((file) => ({
    source: relative(inputsDir, file),
    content: readFileSync(file, 'utf-8'),
  }));
}

const ALL_NULL_FEATURES = Object.freeze(
  JSON.parse(
    readFileSync(join(FIXTURE_ROOT, 'inputs/alpha-pr/hokusai-scan-pr-104.json'), 'utf-8'),
  ) as CandidateFeaturesV1,
);

function makeFeatures(overrides: Partial<CandidateFeaturesV1>): CandidateFeaturesV1 {
  return {
    ...ALL_NULL_FEATURES,
    risk_level: null,
    requires_tests: null,
    tests_changed: null,
    ...overrides,
  } as CandidateFeaturesV1;
}

function makeLabelLine(
  repo: string,
  pr: number,
  horizon: number,
  reportOutcome: string | null,
  computedAt: string,
): string {
  return JSON.stringify({
    schema_version: '1.0.0',
    prUrl: `https://github.com/synth/${repo}/pull/${pr}`,
    horizon_days: horizon,
    label_provenance: 'harvested',
    line_ranges: [],
    outcome: {
      survived: reportOutcome === 'survived',
      survival_ratio: reportOutcome === 'survived' ? 1 : 0,
      reverted: reportOutcome === 'reverted',
      undone_by: null,
      followup: false,
      report_outcome: reportOutcome,
      reason_codes: ['no_evidence'],
    },
    envelope: {
      schema_version: '1.0.0',
      labeller_version: '1.0.0',
      normalization_version: '1.0.0',
      pr_head_sha: 'a'.repeat(40),
      merge_sha: 'b'.repeat(40),
      horizon_terminal_sha: 'c'.repeat(40),
      integration_branch: 'auto/integration',
      computed_at: computedAt,
    },
  });
}

// ── The placeholder rule ───────────────────────────────────────────────────

describe('evaluateShadowRule', () => {
  it('flags a risky change requiring tests with no test files touched', () => {
    for (const risk of ['medium', 'high'] as const) {
      expect(
        evaluateShadowRule(
          makeFeatures({ risk_level: risk, requires_tests: true, tests_changed: false }),
        ),
      ).toBe('flag');
    }
  });

  it('returns no_flag on any definitive negative even with other conjuncts null', () => {
    expect(evaluateShadowRule(makeFeatures({ risk_level: 'low' }))).toBe('no_flag');
    expect(evaluateShadowRule(makeFeatures({ requires_tests: false }))).toBe('no_flag');
    expect(evaluateShadowRule(makeFeatures({ tests_changed: true }))).toBe('no_flag');
    expect(
      evaluateShadowRule(
        makeFeatures({ risk_level: 'high', requires_tests: true, tests_changed: true }),
      ),
    ).toBe('no_flag');
  });

  it('returns unknown when a needed conjunct is null and nothing is negative', () => {
    expect(evaluateShadowRule(makeFeatures({}))).toBe('unknown');
    expect(
      evaluateShadowRule(
        makeFeatures({ risk_level: 'high', requires_tests: true, tests_changed: null }),
      ),
    ).toBe('unknown');
    expect(
      evaluateShadowRule(
        makeFeatures({ risk_level: null, requires_tests: true, tests_changed: false }),
      ),
    ).toBe('unknown');
  });
});

// ── Parsing helpers ────────────────────────────────────────────────────────

describe('parsePrUrl / prNumberFromSource', () => {
  it('parses owner, repo, and number from a PR URL', () => {
    expect(parsePrUrl('https://github.com/golden/alpha/pull/101')).toEqual({
      repo: 'golden/alpha',
      prNumber: 101,
    });
    expect(parsePrUrl('https://github.com/o/r/pull/7/files')).toEqual({
      repo: 'o/r',
      prNumber: 7,
    });
    expect(parsePrUrl('https://example.com/not-a-pr')).toBeNull();
  });

  it('extracts the pr-<n> token from a filename', () => {
    expect(prNumberFromSource('alpha-pr/hokusai-scan-pr-101.json')).toBe(101);
    expect(prNumberFromSource('pr-9.json')).toBe(9);
    expect(prNumberFromSource('hokusai-scan-labels-2026-09-20.jsonl')).toBeNull();
    expect(prNumberFromSource('supr-3.json')).toBeNull();
  });
});

// ── Golden fixture run ─────────────────────────────────────────────────────

describe('aggregateShadowScans (golden fixture)', () => {
  const result = aggregateShadowScans(readFixtureInputs(), { asOf: AS_OF });

  it('reproduces the golden markdown byte-for-byte', () => {
    expect(result.markdown).toBe(
      readFileSync(join(FIXTURE_ROOT, 'expected-report.md'), 'utf-8'),
    );
  });

  it('reproduces the golden JSON byte-for-byte', () => {
    expect(serializeShadowReport(result.report)).toBe(
      readFileSync(join(FIXTURE_ROOT, 'expected-report.json'), 'utf-8'),
    );
  });

  it('dedupes by (prUrl, horizon) keeping the latest computed_at', () => {
    // alpha PR 101 was labelled survived on 09-20 and reverted on 09-25:
    // the reverted row must win, so alpha counts 2 reverted, not 1.
    const alpha = result.report.repos.find((repo) => repo.repo === 'golden/alpha');
    expect(alpha?.outcomes.reverted).toBe(2);
    expect(alpha?.outcomes.survived).toBe(2);
  });

  it('applies the placeholder rule to produce expected flag / TP / FP counts', () => {
    const alpha = result.report.repos.find((repo) => repo.repo === 'golden/alpha');
    expect(alpha?.flags).toEqual({ flag: 4, no_flag: 2, unknown: 2 });
    expect(alpha?.true_positives).toBe(2);
    expect(alpha?.false_positives).toBe(1);
    expect(alpha?.would_be_precision).toBe(0.6667);
    expect(alpha?.precision_suppressed).toBe(false);
    expect(alpha?.reworked_prs).toBe(PRECISION_SUPPRESSION_FLOOR);
  });

  it('suppresses precision below the reworked-PR floor', () => {
    const bravo = result.report.repos.find((repo) => repo.repo === 'golden/bravo');
    expect(bravo?.reworked_prs).toBe(1);
    expect(bravo?.precision_suppressed).toBe(true);
    expect(bravo?.would_be_precision).toBeNull();
    // Counts are still reported so the suppressed line stays inspectable.
    expect(bravo?.true_positives).toBe(1);
    expect(bravo?.false_positives).toBe(1);
  });

  it('joins standalone features across repos only when attribution is unambiguous', () => {
    // bravo PR 202 features joined by "only bravo labelled #202"…
    const bravo = result.report.repos.find((repo) => repo.repo === 'golden/bravo');
    expect(bravo?.flags.no_flag).toBe(1);
    // …while the orphan pr-999 features are skipped with a diagnostic.
    expect(
      result.diagnostics.some((line) => line.includes('cannot attribute PR #999')),
    ).toBe(true);
  });

  it('reports malformed lines as diagnostics without failing the run', () => {
    expect(result.diagnostics.some((line) => line.includes('not valid JSON'))).toBe(true);
    expect(
      result.diagnostics.some((line) => line.includes('unsupported label schema_version')),
    ).toBe(true);
  });

  it('carries the placeholder-rule honesty phrase on every reported number block', () => {
    expect(result.report.shadow_rule.trained_model).toBe(false);
    const perRepoSections = result.markdown.split('\n## ').slice(1);
    expect(perRepoSections).toHaveLength(2);
    for (const section of perRepoSections) {
      expect(section).toContain(PLACEHOLDER_RULE_PHRASE);
    }
  });

  it('is deterministic: a second run over shuffled inputs produces identical bytes', () => {
    const shuffled = [...readFixtureInputs()].reverse();
    const again = aggregateShadowScans(shuffled, { asOf: AS_OF });
    expect(again.markdown).toBe(result.markdown);
    expect(serializeShadowReport(again.report)).toBe(serializeShadowReport(result.report));
  });
});

// ── Unit behaviours off the golden path ────────────────────────────────────

describe('aggregateShadowScans (unit)', () => {
  it('renders an explicit empty report when there are no inputs', () => {
    const result = aggregateShadowScans([], { asOf: AS_OF });
    expect(result.report.repos).toEqual([]);
    expect(result.report.horizon_days).toBe(DEFAULT_REPORT_HORIZON);
    expect(result.markdown).toContain('No scan inputs found');
    expect(renderShadowReportMarkdown(result.report)).toBe(result.markdown);
  });

  it('honours a non-default reporting horizon', () => {
    const inputs: ShadowScanInput[] = [
      {
        source: 'labels.jsonl',
        content: `${makeLabelLine('solo', 1, 14, 'reverted', '2026-09-01T00:00:00Z')}\n${makeLabelLine('solo', 1, 30, 'survived', '2026-09-01T00:00:00Z')}\n`,
      },
    ];
    const at14 = aggregateShadowScans(inputs, { asOf: AS_OF, horizonDays: 14 });
    expect(at14.report.repos[0]?.outcomes.reverted).toBe(1);
    const at30 = aggregateShadowScans(inputs, { asOf: AS_OF });
    expect(at30.report.repos[0]?.outcomes.survived).toBe(1);
  });

  it('attributes standalone features to the single labelled repo', () => {
    const inputs: ShadowScanInput[] = [
      {
        source: 'labels.jsonl',
        content: `${makeLabelLine('solo', 5, 30, 'reverted', '2026-09-01T00:00:00Z')}\n`,
      },
      {
        source: 'hokusai-scan-pr-5.json',
        content: JSON.stringify(
          makeFeatures({ risk_level: 'high', requires_tests: true, tests_changed: false }),
        ),
      },
    ];
    const result = aggregateShadowScans(inputs, { asOf: AS_OF });
    expect(result.report.repos[0]?.true_positives).toBe(1);
  });

  it('dedupes re-scanned features keeping the lexicographically greatest source', () => {
    const inputs: ShadowScanInput[] = [
      {
        source: 'labels.jsonl',
        content: `${makeLabelLine('solo', 5, 30, 'survived', '2026-09-01T00:00:00Z')}\n`,
      },
      {
        source: 'run-1/hokusai-scan-pr-5.json',
        content: JSON.stringify(
          makeFeatures({ risk_level: 'high', requires_tests: true, tests_changed: false }),
        ),
      },
      {
        // A later run re-extracted the PR; tests were added since.
        source: 'run-2/hokusai-scan-pr-5.json',
        content: JSON.stringify(
          makeFeatures({ risk_level: 'high', requires_tests: true, tests_changed: true }),
        ),
      },
    ];
    const result = aggregateShadowScans(inputs, { asOf: AS_OF });
    expect(result.report.repos[0]?.flags).toEqual({ flag: 0, no_flag: 1, unknown: 0 });
  });

  it('counts a PR labelled only at other horizons as seen but not labelled', () => {
    const inputs: ShadowScanInput[] = [
      {
        source: 'labels.jsonl',
        content: `${makeLabelLine('solo', 9, 14, 'survived', '2026-09-01T00:00:00Z')}\n`,
      },
    ];
    const result = aggregateShadowScans(inputs, { asOf: AS_OF });
    const repo = result.report.repos[0];
    expect(repo?.prs_seen).toBe(1);
    expect(repo?.labelled_prs).toBe(0);
    expect(repo?.survival_rate).toBeNull();
    expect(repo?.would_be_precision).toBeNull();
  });
});
