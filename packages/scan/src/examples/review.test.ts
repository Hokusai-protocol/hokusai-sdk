import type { ArbiterReportV1 } from '@hokusai/core';
import { describe, expect, it } from 'vitest';
import { reportDraftFixtures } from '../../../core/src/fixtures/arbiter-report.js';
import { DEFAULT_REPORT_POLICY, applyReportSuppression } from '../report/suppression.js';
import { checkCopy, htmlToText, reviewExampleReport, type ExampleReviewInput } from './review.js';
import { TrainingExclusion } from './select.js';

const GOOD_PAGE =
  'Rework Report for acme/widgets. Hokusai predicts which PRs will need rework after merge. ' +
  'Would Hokusai have caught them? At a 30-day rework risk threshold of 50%, these PRs were flagged before merge. ' +
  'Reverted or repaired within 30 days is the outcome; the risk score is the prediction.';

/**
 * A real-looking passing report: the prediction fixture, re-labelled as a scan
 * of acme/widgets. The fixture's scores are illustrative (every PR scores 0.7
 * but a third are flagged), so scores are made to follow the flags.
 */
function goodReport(): ArbiterReportV1 {
  const d = reportDraftFixtures.prediction();
  d.data_origin = 'scan';
  d.repo = { host: 'github', owner: 'acme', name: 'widgets' };
  const scored = d.prs.filter((pr) => pr.prediction);
  for (const pr of scored) pr.prediction!.score = pr.prediction!.flagged ? 0.7 : 0.3;
  d.retrospective!.flagged_share.value = scored.filter((pr) => pr.prediction!.flagged).length / scored.length;
  return applyReportSuppression(d, DEFAULT_REPORT_POLICY);
}

it('the raw prediction fixture fails threshold_consistent: it is illustrative', () => {
  const d = reportDraftFixtures.prediction();
  d.data_origin = 'scan';
  d.repo = { host: 'github', owner: 'acme', name: 'widgets' };
  const r = reviewExampleReport({ report: d, expectedRepo: 'acme/widgets', exclusion: new TrainingExclusion() });
  expect(r.checks.find((c) => c.code === 'threshold_consistent')?.passed).toBe(false);
});

const exclusion = new TrainingExclusion().addCorpusManifest({ repos: [{ repo: 'corpus/repo' }], alternates: [] });

function input(over: Partial<ExampleReviewInput> = {}): ExampleReviewInput {
  const report = goodReport();
  return { report, rescan: structuredClone(report), pageText: GOOD_PAGE, expectedRepo: 'acme/widgets', exclusion, ...over };
}

const failed = (i: ExampleReviewInput) =>
  reviewExampleReport(i)
    .checks.filter((c) => !c.passed)
    .map((c) => c.code);

describe('reviewExampleReport', () => {
  it('passes a clean report with a re-scan and a page', () => {
    const r = reviewExampleReport(input());
    expect(r.checks.filter((c) => !c.passed)).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it('fails illustrative data', () => {
    const report = goodReport();
    report.data_origin = 'fixture';
    expect(failed(input({ report, rescan: structuredClone(report) }))).toContain('real_data');
  });

  it('fails a corpus repo even when the payload says it was not trained on', () => {
    const report = goodReport();
    report.repo = { host: 'github', owner: 'Corpus', name: 'Repo' };
    expect(failed(input({ report, rescan: structuredClone(report), expectedRepo: 'corpus/repo' }))).toEqual(['not_training_repo']);
  });

  it('fails a repo the payload says was in training', () => {
    const report = goodReport();
    report.model_provenance!.repo_in_training_set = true;
    expect(failed(input({ report, rescan: structuredClone(report) }))).toEqual(expect.arrayContaining(['not_training_repo', 'out_of_sample_provenance']));
  });

  it('fails a time split that scored PRs merged before the split date', () => {
    const report = goodReport();
    report.model_provenance!.split = 'time_split';
    report.model_provenance!.split_date = '2026-12-01';
    expect(failed(input({ report, rescan: structuredClone(report) }))).toEqual(['out_of_sample_provenance']);
  });

  it('fails when the retrospective is missing or suppressed', () => {
    const d = reportDraftFixtures.prediction();
    d.data_origin = 'scan';
    d.repo = { host: 'github', owner: 'acme', name: 'widgets' };
    d.retrospective!.n_reworked = 5;
    const report = applyReportSuppression(d, DEFAULT_REPORT_POLICY);
    expect(report.retrospective!.suppressed).toBe(true);
    expect(failed(input({ report, rescan: structuredClone(report) }))).toContain('retrospective_present');
  });

  it('fails flags that do not follow the stated threshold', () => {
    const report = goodReport();
    const pr = report.prs.find((p) => p.prediction)!;
    pr.prediction!.flagged = !pr.prediction!.flagged;
    expect(failed(input({ report, rescan: structuredClone(report) }))).toContain('threshold_consistent');
  });

  it('fails a payload whose suppression was skipped', () => {
    const report = goodReport();
    const cell = report.aggregates.survival_by_horizon.rows[0]!.cell;
    // Below the floor but shown: what an un-suppressed payload looks like.
    cell.n = 3;
    expect(failed(input({ report, rescan: structuredClone(report) }))).toContain('suppression_consistent');
  });

  it('fails loosened floors', () => {
    const report = goodReport();
    report.policy = { ...report.policy, min_cell_n: 5 };
    expect(failed(input({ report, rescan: structuredClone(report) }))).toContain('policy_is_default');
  });

  it('fails a re-scan that differs, and ignores scanned_at', () => {
    const rescan = goodReport();
    rescan.scan.scanned_at = '2030-01-01T00:00:00Z';
    expect(failed(input({ rescan }))).toEqual([]);
    rescan.prs[0]!.prediction = rescan.prs[0]!.prediction && { ...rescan.prs[0]!.prediction, score: 0.01, flagged: false };
    const r = reviewExampleReport(input({ rescan }));
    expect(r.checks.find((c) => c.code === 'rescan_reproduces')).toMatchObject({ passed: false });
  });

  it('fails without a re-scan or a page', () => {
    const bare = input();
    delete bare.rescan;
    delete bare.pageText;
    expect(failed(bare)).toEqual(['rescan_reproduces', 'threshold_shown', 'copy_vocabulary']);
  });

  it('fails a page that does not show the threshold', () => {
    expect(failed(input({ pageText: GOOD_PAGE.replace('50%', 'a fixed') }))).toEqual(['threshold_shown']);
  });

  it('fails a page that breaks the vocabulary rules', () => {
    expect(failed(input({ pageText: `${GOOD_PAGE} Hokusai reviews every PR for you.` }))).toEqual(['copy_vocabulary']);
  });

  it('pins versions the batch expects', () => {
    expect(failed(input({ expectedVersions: { head_version: '9.9.9' } }))).toEqual(['versions_recorded']);
  });

  it('marks a passing report borderline when the retrospective is thin', () => {
    const r = reviewExampleReport(input());
    // Recall rests on 30 reworked PRs, under twice the cell floor of 20.
    expect(r.passed).toBe(true);
    expect(r.borderline).toBe(true);
    expect(r.borderline_reasons.some((b) => b.startsWith('retrospective recall'))).toBe(true);
  });

  it('rejects malformed payloads without throwing', () => {
    expect(failed(input({ report: { nope: true } }))).toEqual(['schema_valid']);
  });
});

describe('checkCopy', () => {
  const hard = (text: string) => checkCopy(text).hard.map((f) => f.rule);

  it('accepts the approved lines', () => {
    expect(hard('Tests tell you if agent code passes. Hokusai tells you if it will hold up.')).toEqual([]);
    expect(hard('Hokusai predicts which PRs will need rework after they are merged, so human review goes where it matters.')).toEqual([]);
    expect(hard('Tests tell you whether code passes now. Review tells you whether code looks right now. Hokusai predicts whether code will hold up.')).toEqual([]);
  });

  it('rejects judge, grade, evaluate and review as what the model does', () => {
    expect(hard('Hokusai reviews your PRs.')).toEqual(['model_action_verb']);
    expect(hard('The model grades each change.')).toEqual(['model_action_verb']);
    expect(hard('Rework Risk evaluates agent code.')).toEqual(['model_action_verb']);
  });

  it('rejects defect claims but allows the approved lower-confidence annotation', () => {
    expect(hard('These PRs were defective.')).toEqual(['defect_claim']);
    expect(hard('corrective rework')).toEqual(['defect_claim']);
    expect(hard('Revert of #12 · possible defect revert (lower confidence)')).toEqual([]);
  });

  it('rejects internal names, raw labels, gates and illustrative content', () => {
    expect(hard('Arbiter report')).toEqual(['internal_name']);
    expect(hard('Survival by horizon')).toEqual(['raw_label_name']);
    expect(hard('Hokusai blocks merges that score high')).toEqual(['gate_or_block']);
    expect(hard('Illustrative numbers below')).toEqual(['illustrative_content']);
    expect(hard('Code blocks render fine.')).toEqual([]);
  });

  it('requires a pairing for "learns from outcomes"', () => {
    expect(hard('Hokusai learns from outcomes.')).toEqual(['learns_from_outcomes_alone']);
    expect(hard('Hokusai learns from outcomes across organizations.')).toEqual([]);
  });

  it('flags judgement words elsewhere as soft', () => {
    expect(checkCopy('Use your judgement.').soft.map((f) => f.rule)).toEqual(['judgement_word']);
  });
});

describe('htmlToText', () => {
  it('drops scripts, styles and tags', () => {
    expect(htmlToText('<style>.a{}</style><p>Risk&nbsp;score <b>50%</b></p><script>var arbiter=1</script>')).toBe('Risk score 50%');
  });
});
