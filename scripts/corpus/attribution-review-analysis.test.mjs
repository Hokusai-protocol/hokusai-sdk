import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeReview,
  joinReview,
  ruleChecks,
  weightedShare,
  wilson,
} from './attribution-review-analysis.mjs';

const strata = [
  {
    id: 'a',
    repo: 'x/big',
    stratum: 'baseline_positive',
    stratum_population: 900,
  },
  {
    id: 'b',
    repo: 'x/big',
    stratum: 'baseline_positive',
    stratum_population: 900,
  },
  {
    id: 'c',
    repo: 'x/small',
    stratum: 'baseline_positive',
    stratum_population: 100,
  },
  {
    id: 'd',
    repo: 'x/small',
    stratum: 'baseline_positive',
    stratum_population: 100,
  },
];
const label = (id, verdict, extra = {}) => ({
  id,
  verdict,
  reviewer: 'r',
  ...extra,
});
const labels = [
  label('a', 'agent_evidence'),
  label('b', 'no_evidence'),
  label('c', 'agent_evidence', { evidence_scope: 'inherited_upstream' }),
  label('d', 'agent_evidence'),
];

test('weights each sampling cell by its population, not by its sample', () => {
  const report = analyzeReview(strata, labels);
  const s = report.as_labelled.baseline_positive;
  assert.equal(s.population, 1000);
  assert.equal(s.verdicts.agent_evidence, 3);
  assert.equal(s.agent_evidence_inherited_upstream, 1);
  // 0.5 of 900 plus all of 100, not the raw 3/4.
  assert.equal(s.weighted_agent_evidence.estimate, 0.55);
  assert.equal(s.weighted_agent_evidence.raw, '3/4');
  assert.ok(s.weighted_agent_evidence.standard_error > 0);
  assert.equal(report.adjudicated, null);
});

test('adjudication is reported beside the returned labels, never over them', () => {
  const report = analyzeReview(strata, labels, [
    { id: 'b', verdict: 'agent_evidence' },
  ]);
  assert.equal(report.as_labelled.baseline_positive.verdicts.no_evidence, 1);
  assert.equal(report.adjudicated.changed_verdicts, 1);
  assert.equal(
    report.adjudicated.strata.baseline_positive.weighted_agent_evidence
      .estimate,
    1,
  );
});

test('a pooled sample uses its stratum as the single cell', () => {
  const pooled = ['p', 'q'].map((id) => ({
    id,
    repo: id === 'p' ? 'x/big' : 'x/small',
    stratum: 'unmarked',
    sampling_cell: 'unmarked',
    stratum_population: 500,
  }));
  const rows = joinReview(pooled, [
    label('p', 'agent_evidence'),
    label('q', 'no_evidence'),
  ]);
  assert.equal(weightedShare(rows, 'verdict', 'agent_evidence').estimate, 0.5);
});

test('rejects sheets that change the sample or leave verdicts blank', () => {
  assert.throws(() => analyzeReview(strata, labels.slice(1)), /match/);
  assert.throws(
    () =>
      analyzeReview(strata, [...labels.slice(1), label('z', 'no_evidence')]),
    /match/,
  );
  assert.throws(
    () => analyzeReview(strata, [...labels.slice(1), label('a', null)]),
    /verdict/,
  );
  assert.throws(
    () => analyzeReview(strata, labels, [{ id: 'z', verdict: 'ambiguous' }]),
    /not in the sample/,
  );
});

test('rule checks and the Wilson interval', () => {
  assert.deepEqual(
    ruleChecks([
      { rule: 'r1', verdict: 'agent_evidence' },
      { rule: 'r1', verdict: 'no_evidence' },
      { rule: null, verdict: 'agent_evidence' },
    ]),
    { r1: { matched: 2, agent_evidence: 1 } },
  );
  const [low, high] = wilson(54, 54);
  assert.ok(low > 0.93 && low < 0.94 && high === 1);
  assert.equal(wilson(0, 0), null);
});
