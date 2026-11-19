import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_REPORT_POLICY } from '../report/suppression.js';
import { EXCLUDED_REASON, TrainingExclusion, decideExample, hashRepo, parseExampleManifest, type ExampleProbeInput, type ExampleThresholds } from './example-select.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
type Json = { repos: { repo: string }[]; alternates: { repo: string }[] } & Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixtures are mutated freely in the rejection tests
const readJson = (rel: string): any => JSON.parse(readFileSync(path.join(root, rel), 'utf8'));
const readCorpus = (rel: string): Json => readJson(rel) as Json;
const FLOOR = DEFAULT_REPORT_POLICY.min_reworked_for_retrospective;

const thresholds: ExampleThresholds = {
  min_merged_prs_per_year: 300,
  min_base_is_default_share: 0.5,
  min_pr_mapped_commit_share: 0.8,
  min_revert_prs_per_year: 20,
  min_agent_share: 0.02,
  supported_conventions: ['squash', 'merge_commit', 'rebase_or_mixed'],
};

const passing: ExampleProbeInput = {
  archived: false,
  observed_merge_convention: 'squash',
  metrics: { merged_prs_per_year: 2000, revert_prs_per_year: 40, base_is_default_share: 0.95, pr_mapped_commit_share: 0.97, agent_share: 0.1 },
};

describe('decideExample', () => {
  it('passes a repo that clears every threshold', () => {
    expect(decideExample(passing, thresholds, false)).toEqual({ eligible: true, reasons: [] });
  });

  it('lists every failed check, not only the first', () => {
    const d = decideExample(
      { archived: true, observed_merge_convention: 'off_github_or_bot_landed', metrics: { merged_prs_per_year: 100, revert_prs_per_year: 3, base_is_default_share: null, pr_mapped_commit_share: 0.4, agent_share: 0 } },
      thresholds,
      true,
    );
    expect(d.eligible).toBe(false);
    expect(d.reasons.map((r) => r.split(':')[0])).toEqual([
      EXCLUDED_REASON,
      'archived',
      'merged_prs_per_year',
      'base_is_default_share',
      'pr_mapped_commit_share',
      'revert_prs_per_year',
      'agent_share',
      'merge_convention',
    ]);
    expect(d.reasons).toContain('base_is_default_share: unmeasured < 0.5');
  });

  it('excludes a corpus repo even when it would otherwise pass', () => {
    expect(decideExample(passing, thresholds, true)).toEqual({ eligible: false, reasons: [EXCLUDED_REASON] });
  });
});

describe('TrainingExclusion', () => {
  it('excludes repos and alternates in any status, case-insensitively', () => {
    const ex = new TrainingExclusion().addCorpusManifest({ repos: [{ repo: 'Org/Kept' }], alternates: [{ repo: 'org/swapped' }] });
    expect(ex.has('org/kept')).toBe(true);
    expect(ex.has('ORG/SWAPPED')).toBe(true);
    expect(ex.has('org/other')).toBe(false);
  });

  it('matches a private hashed list without holding the names', () => {
    const salt = 'a'.repeat(64);
    const ex = new TrainingExclusion().addHashedList({ salt, sha256: [hashRepo(salt, 'Secret/Repo')] });
    expect(ex.has('secret/repo')).toBe(true);
    expect(ex.has('secret/other')).toBe(false);
    expect(() => ex.addHashedList({ salt: 'b', sha256: [] })).toThrow(/one salt/);
  });

  it('covers every repo in the committed HOK-3022 cohort, so the evaluation slice is covered too', () => {
    const cohort = readCorpus('fixtures/arbiter/corpus/hok-3022-cohort.json');
    const ex = new TrainingExclusion().addCorpusManifest(cohort);
    for (const entry of [...cohort.repos, ...cohort.alternates]) expect(ex.has(entry.repo)).toBe(true);
  });
});

describe('parseExampleManifest', () => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- a fresh mutable copy per test
  const manifest = () => readJson('fixtures/arbiter/example-reports/manifest.json');

  it('accepts the committed manifest', () => {
    const m = parseExampleManifest(manifest(), FLOOR);
    expect(m.candidates.length).toBeGreaterThan(0);
  });

  it('no committed candidate is a corpus repo', () => {
    const m = parseExampleManifest(manifest(), FLOOR);
    const ex = new TrainingExclusion();
    for (const rel of m.exclude_corpus_manifests) ex.addCorpusManifest(readCorpus(rel));
    expect(m.candidates.filter((c) => ex.has(c.repo)).map((c) => c.repo)).toEqual([]);
  });

  it('rejects a revert floor below the report retrospective floor', () => {
    const m = manifest();
    m.thresholds.min_revert_prs_per_year = FLOOR - 1;
    expect(() => parseExampleManifest(m, FLOOR)).toThrow(/retrospective floor/);
  });

  it('rejects duplicate candidates regardless of case', () => {
    const m = manifest();
    m.candidates.push({ ...m.candidates[0], repo: m.candidates[0].repo.toUpperCase() });
    expect(() => parseExampleManifest(m, FLOOR)).toThrow(/duplicate/);
  });

  it('requires at least one corpus manifest to exclude', () => {
    const m = manifest();
    m.exclude_corpus_manifests = [];
    expect(() => parseExampleManifest(m, FLOOR)).toThrow(/exclude_corpus_manifests/);
  });
});
