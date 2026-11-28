/**
 * Automated review of a Rework Risk example report (HOK-3515 step 3).
 *
 * Every report runs these checks before a person sees it. A report that
 * fails any check cannot be published. A report that passes but sits near a
 * floor is flagged `borderline`, so at scale it joins the human-review
 * sample. The checks encode the honesty rules of HOK-2826 and HOK-2828 and
 * the positioning guidance's vocabulary rules.
 *
 * The checks never trust the payload's own claims where they can be
 * re-derived: suppression is re-applied, flags are recomputed from scores,
 * training membership is checked against the corpus manifests, and the
 * re-scan is compared field by field.
 */
import { validateArbiterReportV1, type ArbiterReportV1 } from '@hokusai/core';
import { isDeepStrictEqual } from 'node:util';
import { DEFAULT_REPORT_POLICY, applyReportSuppression } from '../report/suppression.js';
import { repoKey, type TrainingExclusion } from './select.js';

export const EXAMPLE_REVIEW_VERSION = '0.2.0';

export type ReviewCheckCode =
  | 'schema_valid'
  | 'real_data'
  | 'repo_matches_candidate'
  | 'prs_found'
  | 'not_training_repo'
  | 'retrospective_present'
  | 'out_of_sample_provenance'
  | 'threshold_consistent'
  | 'threshold_shown'
  | 'policy_is_default'
  | 'suppression_consistent'
  | 'rescan_reproduces'
  | 'copy_vocabulary'
  | 'versions_recorded';

export interface ReviewCheck {
  code: ReviewCheckCode;
  passed: boolean;
  detail?: string;
}

export interface ExampleReviewInput {
  /** The emitted payload, as parsed JSON. */
  report: unknown;
  /** owner/name the batch asked for. */
  expectedRepo: string;
  exclusion: TrainingExclusion;
  /** A second scan of the same repo at the same `as_of`. Missing fails `rescan_reproduces`. */
  rescan?: unknown;
  /** Visible text of the rendered private page. Missing fails the page checks. */
  pageText?: string;
  /** Versions the batch run pinned; each one given must match the payload. */
  expectedVersions?: { scanner?: string; head_version?: string; labeller_version?: string };
}

export interface ExampleReviewResult {
  review_version: string;
  repo: string;
  passed: boolean;
  /** Passed, but close enough to a floor that a person must look at it. */
  borderline: boolean;
  checks: ReviewCheck[];
  borderline_reasons: string[];
}

// ---------------------------------------------------------------------------
// Copy rules (Linear: "Rework Risk — Positioning & Messaging Guidance", §3–§5).

export interface CopyFinding {
  rule: string;
  match: string;
}

/** The interim display the owner approved for fast reverts (revert-signal study §8). */
const APPROVED_PHRASES = [/possible defect revert \(lower confidence\)/gi];

const HARD_COPY_RULES: { rule: string; pattern: RegExp }[] = [
  {
    // §5.1: never say judge, grade, evaluate or review about what the model does.
    rule: 'model_action_verb',
    pattern:
      /\b(?:hokusai|rework risk|the model|our model|the score|this score|the prediction)\b[^.!?\n]{0,40}?\b(?:judg(?:e|es|ed|ing|ment)|grad(?:e|es|ed|ing)|evaluat(?:e|es|ed|ing|ion)|review(?:s|ed|ing)?)\b/gi,
  },
  // §2: "Arbiter" is the internal codename only.
  { rule: 'internal_name', pattern: /\barbiter\b/gi },
  // §3: never expose raw label names.
  { rule: 'raw_label_name', pattern: /\b(?:substantially_rewritten|substantially rewritten|followup|follow-up label|survival|survived)\b/gi },
  // §5.6 and the cr-0.2.0 decision: the claim is "reverted or repaired", not a defect.
  { rule: 'defect_claim', pattern: /\b(?:corrective|caused by a bug|defect(?:s|ive)?|buggy)\b/gi },
  // §5.4 and §5.9: advisory only; never a gate, never blocks or merges.
  {
    rule: 'gate_or_block',
    pattern:
      /\b(?:block(?:s|ed|ing)?|gat(?:e|es|ed|ing))\s+(?:the\s+|your\s+)?(?:merges?|prs?|pull requests?|deploys?)\b|\bmerge gate\b|\bgatekeep\w*|\bauto-?merg\w*/gi,
  },
  // §7.4.
  { rule: 'merged_without_review', pattern: /\bmerged without review\b/gi },
  // §5.11 and the report contract: illustrative content never reaches a live report.
  { rule: 'illustrative_content', pattern: /\b(?:illustrative|lorem ipsum|placeholder|sample data|example data|fixture|hokusai-fixtures)\b/gi },
];

/** Words that are fine in some sentences but need a person to read the sentence. */
const SOFT_COPY_RULES: { rule: string; pattern: RegExp }[] = [
  { rule: 'judgement_word', pattern: /\b(?:judg\w*|grad(?:e|es|ed|ing)|evaluat\w*|verdict)\b/gi },
];

function findAll(text: string, rules: { rule: string; pattern: RegExp }[]): CopyFinding[] {
  const out: CopyFinding[] = [];
  for (const { rule, pattern } of rules) for (const m of text.matchAll(pattern)) out.push({ rule, match: m[0] });
  return out;
}

/** Hard findings fail the report; soft findings make it borderline. */
export function checkCopy(text: string): { hard: CopyFinding[]; soft: CopyFinding[] } {
  let t = text;
  for (const p of APPROVED_PHRASES) t = t.replace(p, ' ');
  const hard = findAll(t, HARD_COPY_RULES);
  // §5.7: "learns from outcomes" never stands alone.
  if (/\blearns? from outcomes\b/i.test(t) && !/\bacross organi[sz]ations\b|\bowned by\b/i.test(t))
    hard.push({ rule: 'learns_from_outcomes_alone', match: 'learns from outcomes' });
  return { hard, soft: findAll(t, SOFT_COPY_RULES) };
}

/** Visible text of an HTML page: scripts, styles and tags removed, common entities decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------

/** Ways a page may print the threshold: 0.35, 35%, 35.0%. */
function thresholdForms(t: number): string[] {
  const pct = t * 100;
  const forms = new Set([`${Math.round(pct)}%`, `${Math.round(pct * 10) / 10}%`, `${pct.toFixed(1)}%`, String(t), t.toFixed(2)]);
  return [...forms];
}

/** The fields that legitimately differ between two scans at the same `as_of`. */
function withoutVolatile(r: ArbiterReportV1): ArbiterReportV1 {
  const copy = structuredClone(r);
  copy.scan.scanned_at = '';
  return copy;
}

function firstDifference(a: unknown, b: unknown, path = '$'): string | null {
  if (isDeepStrictEqual(a, b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], Array.isArray(a) ? `${path}[${k}]` : `${path}.${k}`);
      if (d) return d;
    }
  }
  return path;
}

export function reviewExampleReport(input: ExampleReviewInput): ExampleReviewResult {
  const checks: ReviewCheck[] = [];
  const borderline: string[] = [];
  const add = (code: ReviewCheckCode, passed: boolean, detail?: string) => checks.push(detail === undefined ? { code, passed } : { code, passed, detail });
  const finish = (): ExampleReviewResult => {
    const passed = checks.every((c) => c.passed);
    return { review_version: EXAMPLE_REVIEW_VERSION, repo: input.expectedRepo, passed, borderline: passed && borderline.length > 0, checks, borderline_reasons: borderline };
  };

  const valid = validateArbiterReportV1(input.report);
  if (!valid.ok) {
    add('schema_valid', false, valid.errors.slice(0, 5).map((e) => `${e.path}: ${e.code}`).join('; '));
    return finish();
  }
  add('schema_valid', true);
  const r = valid.value;
  const repo = `${r.repo.owner}/${r.repo.name}`;

  add('real_data', r.data_origin === 'scan' && repoKey(r.repo.owner) !== 'hokusai-fixtures', r.data_origin === 'scan' ? undefined : `data_origin ${r.data_origin}`);
  add('repo_matches_candidate', repoKey(repo) === repoKey(input.expectedRepo), repoKey(repo) === repoKey(input.expectedRepo) ? undefined : `payload is ${repo}`);
  // An empty or near-empty scan is not a report: it happens when the repo's commit subjects carry no PR numbers (rebase merges).
  const found = r.coverage.prs_enumerated;
  add('prs_found', found >= DEFAULT_REPORT_POLICY.min_cell_n, found >= DEFAULT_REPORT_POLICY.min_cell_n ? undefined : `scan found ${found} PRs (< ${DEFAULT_REPORT_POLICY.min_cell_n}); do the repo's commit subjects carry PR numbers?`);

  const inCorpus = input.exclusion.has(repo);
  const claimsTraining = r.model_provenance?.repo_in_training_set === true;
  add('not_training_repo', !inCorpus && !claimsTraining, inCorpus ? 'in_training_or_holdout' : claimsTraining ? 'model_provenance.repo_in_training_set is true' : undefined);

  // The launch requires the predictive section, shown, not suppressed.
  const retro = r.retrospective;
  add('retrospective_present', !!retro && !retro.suppressed, !retro ? 'no retrospective section' : retro.suppressed ? `suppressed: ${retro.suppression_reasons.join(', ')}` : undefined);

  // Out-of-sample: provenance present; under a time split every scored PR merged after the split date.
  const prov = r.model_provenance;
  const scored = r.prs.filter((pr) => pr.prediction);
  if (!prov) add('out_of_sample_provenance', false, 'model_provenance missing');
  else if (prov.split === 'time_split') {
    const split = Date.parse(prov.split_date);
    const early = scored.filter((pr) => Date.parse(pr.merged_at) <= split);
    add('out_of_sample_provenance', early.length === 0, early.length ? `${early.length} scored PRs merged on or before split_date ${prov.split_date}` : undefined);
  } else add('out_of_sample_provenance', !prov.repo_in_training_set, prov.repo_in_training_set ? 'leave_repo_out but repo_in_training_set' : undefined);

  // The threshold the page shows is the one the flags used, and flagged_share is recomputable.
  if (!retro) add('threshold_consistent', false, 'no retrospective section');
  else {
    const wrong = scored.filter((pr) => pr.prediction!.flagged !== pr.prediction!.score >= retro.threshold).length;
    const flagged = scored.filter((pr) => pr.prediction!.flagged).length;
    const share = scored.length ? flagged / scored.length : null;
    const fs = retro.flagged_share;
    const shareOff = !fs.suppressed && (fs.n !== scored.length || share === null || Math.abs((fs.value ?? -1) - share) > 1e-4);
    add(
      'threshold_consistent',
      wrong === 0 && !shareOff,
      wrong ? `${wrong} PRs flagged inconsistently with threshold ${retro.threshold}` : shareOff ? `flagged_share ${fs.value} over ${fs.n} does not match ${flagged}/${scored.length} scored PRs` : undefined,
    );
  }

  add('policy_is_default', isDeepStrictEqual(r.policy, DEFAULT_REPORT_POLICY), isDeepStrictEqual(r.policy, DEFAULT_REPORT_POLICY) ? undefined : `policy ${r.policy.policy_version} differs from the default floors`);

  // Suppression fires below the floor: re-applying the default policy must change nothing.
  try {
    const again = applyReportSuppression(r, DEFAULT_REPORT_POLICY);
    const diff = firstDifference(again, r);
    add('suppression_consistent', diff === null, diff ? `re-applying suppression changes ${diff}` : undefined);
  } catch (error) {
    add('suppression_consistent', false, (error as Error).message.slice(0, 200));
  }

  if (input.rescan === undefined) add('rescan_reproduces', false, 'no re-scan supplied');
  else {
    const again = validateArbiterReportV1(input.rescan);
    if (!again.ok) add('rescan_reproduces', false, 're-scan payload is invalid');
    else {
      const diff = firstDifference(withoutVolatile(again.value), withoutVolatile(r));
      add('rescan_reproduces', diff === null, diff ? `re-scan differs at ${diff}` : undefined);
    }
  }

  if (input.pageText === undefined) {
    add('threshold_shown', false, 'no rendered page supplied');
    add('copy_vocabulary', false, 'no rendered page supplied');
  } else {
    const text = input.pageText;
    if (!retro) add('threshold_shown', false, 'no retrospective section');
    else {
      const forms = thresholdForms(retro.threshold);
      const shown = forms.some((f) => text.includes(f));
      add('threshold_shown', shown, shown ? undefined : `page shows none of ${forms.join(', ')}`);
    }
    const copy = checkCopy(text);
    add('copy_vocabulary', copy.hard.length === 0, copy.hard.length ? copy.hard.slice(0, 5).map((f) => `${f.rule}: "${f.match}"`).join('; ') : undefined);
    for (const f of copy.soft) borderline.push(`copy ${f.rule}: "${f.match}"`);
  }

  const v = input.expectedVersions ?? {};
  const mismatches: string[] = [];
  if (!r.scan.scanner.version) mismatches.push('scanner version missing');
  if (!r.scan.contracts.labeller_version) mismatches.push('labeller version missing');
  if (prov && !prov.head_version) mismatches.push('head version missing');
  if (v.scanner && v.scanner !== r.scan.scanner.version) mismatches.push(`scanner ${r.scan.scanner.version} ≠ ${v.scanner}`);
  if (v.labeller_version && v.labeller_version !== r.scan.contracts.labeller_version) mismatches.push(`labeller ${r.scan.contracts.labeller_version} ≠ ${v.labeller_version}`);
  if (v.head_version && v.head_version !== prov?.head_version) mismatches.push(`head ${prov?.head_version ?? 'none'} ≠ ${v.head_version}`);
  add('versions_recorded', mismatches.length === 0, mismatches.length ? mismatches.join('; ') : undefined);

  // Borderline: passes, but close enough to a floor that a person must read it.
  const p = r.policy;
  if (retro && !retro.suppressed && retro.n_reworked < 1.5 * p.min_reworked_for_retrospective)
    borderline.push(`n_reworked ${retro.n_reworked} is under 1.5× the floor ${p.min_reworked_for_retrospective}`);
  if (retro)
    for (const [name, cell] of Object.entries({ precision: retro.precision, recall: retro.recall, flagged_share: retro.flagged_share }))
      if (!cell.suppressed && cell.n < 2 * p.min_cell_n) borderline.push(`retrospective ${name} n ${cell.n} is under 2× the cell floor ${p.min_cell_n}`);
  const agentRate = r.coverage.attribution.agent.rate;
  if (agentRate >= p.min_agent_coverage && agentRate < p.min_agent_coverage + 0.1)
    borderline.push(`agent attribution coverage ${agentRate} is within 0.1 of the floor ${p.min_agent_coverage}`);

  return finish();
}
