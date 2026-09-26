/**
 * Shadow-mode aggregator for the Survival Check (Arbiter P2.S1, HOK-2820).
 *
 * Turns accumulated per-repo scan output — survival-label JSONL from the
 * nightly backfill, candidate-feature JSON from per-PR extract runs, and
 * combined `scan` objects — into the shadow-mode calibration report: what the
 * Check *would* have flagged, and what the would-be precision was, per repo.
 *
 * Shadow-mode step 1 has no trained model, so "would flag" is the transparent
 * placeholder rule {@link evaluateShadowRule}: every reported number carries
 * the phrase {@link PLACEHOLDER_RULE_PHRASE}. When Model A lands (Phase 3)
 * the rule is swapped for the model's `predict()` and the phrasing changes.
 * The aggregator exists now so the calibration surface exists to plug the
 * model into later (§22.7 flywheel).
 *
 * Pure module: inputs arrive as already-read file contents, and the output is
 * byte-deterministic given the same inputs and `asOf`. No filesystem, no
 * environment, no clock — the CLI shell owns the ambient world
 * (`boundary.test.ts` enforces this mechanically).
 *
 * @module shadow-aggregate
 */

import {
  HORIZONS,
  validateCandidateFeaturesV1,
  type CandidateFeaturesV1,
  type HorizonDays,
  type ReportOutcome,
} from '@hokusai/core';

/** Wire version of the machine-readable shadow report object. */
export const SHADOW_REPO_REPORT_SCHEMA_VERSION = 'shadow_repo_report/v1' as const;

/**
 * Identifier of the placeholder shadow-flag rule. Versioned so a report
 * always says exactly which rule (later: which model) produced its numbers.
 */
export const SHADOW_RULE_ID = 'placeholder-untested-risky-change/v1' as const;

/** Human-readable statement of {@link evaluateShadowRule}. */
export const SHADOW_RULE_DESCRIPTION =
  'flag when risk_level is medium or high, requires_tests is true, and tests_changed is false' as const;

/**
 * Honesty marker required next to every reported number until Model A ships.
 * See the module doc: the rule is a placeholder, not a trained model.
 */
export const PLACEHOLDER_RULE_PHRASE = 'placeholder rule, no trained model yet' as const;

/**
 * Suppression floor (§13.3 / §20 governance): would-be precision is omitted
 * for a repo until at least this many reworked PRs exist at the reporting
 * horizon, so a quoted precision is never built on a vanishing denominator.
 */
export const PRECISION_SUPPRESSION_FLOOR = 5;

/** Default reporting horizon: the "30-day survival" number the Check quotes. */
export const DEFAULT_REPORT_HORIZON: HorizonDays = 30;

/** Tri-state verdict of the shadow rule for one PR. */
export type ShadowFlagVerdict = 'flag' | 'no_flag' | 'unknown';

/** One already-read input file handed to the aggregator. */
export interface ShadowScanInput {
  /**
   * Stable name for diagnostics and deterministic ordering — a path relative
   * to the inputs root, never an absolute path (report bytes must not depend
   * on where the inputs live). Standalone candidate-feature files are joined
   * by the `pr-<n>` token in this name.
   */
  source: string;
  /** Raw file contents (JSON or JSONL). */
  content: string;
}

export interface ShadowAggregateOptions {
  /** Pinned "now" stamped into the report as `generated_at`. */
  asOf: Date;
  /** Reporting horizon; defaults to {@link DEFAULT_REPORT_HORIZON}. */
  horizonDays?: HorizonDays | undefined;
}

/** Per-repo shadow-mode summary inside {@link ShadowRepoReportV1}. */
export interface ShadowRepoSummaryV1 {
  /** `owner/name`, from the labels' prUrl. */
  repo: string;
  /** Distinct PRs observed (labels at any horizon, plus joined features). */
  prs_seen: number;
  /** PRs with a deduplicated label row at the reporting horizon. */
  labelled_prs: number;
  /** Deduplicated `report_outcome` counts at the reporting horizon. */
  outcomes: {
    survived: number;
    followup: number;
    substantially_rewritten: number;
    reverted: number;
    /** `report_outcome === null` — horizon not elapsed or evidence missing. */
    missing: number;
  };
  /** survived / known outcomes, 4 decimal places; null with zero known. */
  survival_rate: number | null;
  /** Known outcomes that are not `survived` (the precision denominator floor). */
  reworked_prs: number;
  /** Shadow-rule verdict counts over PRs with candidate features. */
  flags: {
    flag: number;
    no_flag: number;
    /** Rule inputs null, or no candidate features were captured for the PR. */
    unknown: number;
  };
  /** flag / (flag + no_flag), 4 decimal places; null with zero decided. */
  would_flag_rate: number | null;
  /** Flagged PRs whose known outcome at the horizon is reworked. */
  true_positives: number;
  /** Flagged PRs whose known outcome at the horizon is `survived`. */
  false_positives: number;
  /**
   * true_positives / (true_positives + false_positives), 4 decimal places.
   * Null when suppressed ({@link PRECISION_SUPPRESSION_FLOOR}) or when no
   * flagged PR has a known outcome yet.
   */
  would_be_precision: number | null;
  /** True when `reworked_prs < PRECISION_SUPPRESSION_FLOOR`. */
  precision_suppressed: boolean;
}

/** The machine-readable shadow report (the `--format json` output). */
export interface ShadowRepoReportV1 {
  schema_version: typeof SHADOW_REPO_REPORT_SCHEMA_VERSION;
  /** ISO-8601 UTC instant the report was generated at (`asOf`). */
  generated_at: string;
  horizon_days: HorizonDays;
  shadow_rule: {
    id: typeof SHADOW_RULE_ID;
    description: typeof SHADOW_RULE_DESCRIPTION;
    /** Always false until Model A replaces the placeholder rule. */
    trained_model: false;
  };
  /** Input files that contributed at least one label or feature row. */
  inputs_read: number;
  /** Sorted by repo name. */
  repos: ShadowRepoSummaryV1[];
}

export interface ShadowAggregateResult {
  report: ShadowRepoReportV1;
  /** Rendered {@link renderShadowReportMarkdown} of `report`. */
  markdown: string;
  /** Per-input parse/join warnings; stderr material, never report bytes. */
  diagnostics: string[];
}

// ── The placeholder shadow rule ─────────────────────────────────────────────

/**
 * The transparent placeholder "would flag" rule (see {@link SHADOW_RULE_ID}).
 *
 * Flags a PR when `risk_level` is medium or high, `requires_tests` is true,
 * and `tests_changed` is false (a risky change requiring tests with no test coverage).
 *
 * Tri-state on nulls: a definitive negative is `no_flag` regardless of
 * others; any null means `unknown` — never guessed to either side.
 */
export function evaluateShadowRule(features: CandidateFeaturesV1): ShadowFlagVerdict {
  const { risk_level, requires_tests, tests_changed } = features;
  if (risk_level === 'low' || requires_tests === false || tests_changed === true) return 'no_flag';
  if (risk_level === null || requires_tests === null || tests_changed === null) return 'unknown';
  if (risk_level !== 'medium' && risk_level !== 'high') return 'no_flag';
  return 'flag';
}

// ── Input parsing ───────────────────────────────────────────────────────────

interface PrRef {
  repo: string;
  prNumber: number;
}

/** Parse `https://<host>/<owner>/<name>/pull/<n>` into repo + number. */
export function parsePrUrl(prUrl: string): PrRef | null {
  const match = /\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\D|$)/.exec(prUrl);
  if (!match) return null;
  return {
    repo: `${match[1] as string}/${match[2] as string}`,
    prNumber: Number(match[3]),
  };
}

interface LabelRow {
  ref: PrRef;
  prUrl: string;
  horizonDays: HorizonDays;
  reportOutcome: ReportOutcome;
  computedAt: string;
  source: string;
}

interface FeatureRow {
  features: CandidateFeaturesV1;
  /** Explicit repo when carried by a combined scan file; null otherwise. */
  repo: string | null;
  prNumber: number | null;
  source: string;
}

const REPORT_OUTCOMES: ReadonlySet<string> = new Set([
  'survived',
  'followup',
  'substantially_rewritten',
  'reverted',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate the label fields the aggregator reads. Deliberately narrower than
 * the full v1.0.0 schema: the aggregator consumes rows, it does not re-certify
 * them (the producer already did), but it never trusts a malformed row.
 */
function intakeLabelRow(value: unknown, source: string): LabelRow | string {
  if (!isRecord(value)) return `${source}: label row is not an object`;
  if (value.schema_version !== '1.0.0') {
    return `${source}: unsupported label schema_version ${JSON.stringify(value.schema_version)}`;
  }
  if (typeof value.prUrl !== 'string') return `${source}: label row has no prUrl`;
  const ref = parsePrUrl(value.prUrl);
  if (!ref) return `${source}: unparseable prUrl ${value.prUrl}`;
  const horizon = value.horizon_days;
  if (typeof horizon !== 'number' || !(HORIZONS as readonly number[]).includes(horizon)) {
    return `${source}: invalid horizon_days ${JSON.stringify(horizon)} on ${value.prUrl}`;
  }
  const outcome = value.outcome;
  if (!isRecord(outcome)) return `${source}: label row has no outcome object (${value.prUrl})`;
  const reportOutcome = outcome.report_outcome;
  if (reportOutcome !== null && !REPORT_OUTCOMES.has(reportOutcome as string)) {
    return `${source}: invalid report_outcome ${JSON.stringify(reportOutcome)} (${value.prUrl})`;
  }
  const envelope = value.envelope;
  if (!isRecord(envelope) || typeof envelope.computed_at !== 'string') {
    return `${source}: label row has no envelope.computed_at (${value.prUrl})`;
  }
  return {
    ref,
    prUrl: value.prUrl,
    horizonDays: horizon as HorizonDays,
    reportOutcome: reportOutcome as ReportOutcome,
    computedAt: envelope.computed_at,
    source,
  };
}

function intakeFeatures(
  value: unknown,
  repo: string | null,
  prNumber: number | null,
  source: string,
): FeatureRow | string {
  const result = validateCandidateFeaturesV1(value);
  if (!result.ok) {
    const first = result.errors[0];
    return `${source}: invalid candidate features (${first?.path ?? '$'}: ${first?.message ?? 'unknown'})`;
  }
  return { features: result.value, repo, prNumber, source };
}

/** PR number from the `pr-<n>` token of a standalone features filename. */
export function prNumberFromSource(source: string): number | null {
  const match = /(?:^|[^a-z0-9])pr-(\d+)(?:\D|$)/i.exec(source);
  return match ? Number(match[1]) : null;
}

interface ParsedInputs {
  labels: LabelRow[];
  features: FeatureRow[];
  diagnostics: string[];
  /** Sources that contributed at least one accepted row. */
  contributingSources: Set<string>;
}

function parseOneInput(input: ShadowScanInput, out: ParsedInputs): void {
  const text = input.content.trim();
  if (text === '') {
    out.diagnostics.push(`${input.source}: empty file, skipped`);
    return;
  }

  let whole: unknown;
  let wholeParsed = false;
  try {
    whole = JSON.parse(text);
    wholeParsed = true;
  } catch {
    wholeParsed = false;
  }

  if (wholeParsed && isRecord(whole)) {
    // Combined `hokusai-scan scan` object: features + labels for one PR.
    if (Array.isArray(whole.survival_labels) && isRecord(whole.candidate_features)) {
      let combinedRef: PrRef | null = null;
      for (const row of whole.survival_labels) {
        const label = intakeLabelRow(row, input.source);
        if (typeof label === 'string') {
          out.diagnostics.push(label);
          continue;
        }
        out.labels.push(label);
        out.contributingSources.add(input.source);
        combinedRef ??= label.ref;
      }
      const features = intakeFeatures(
        whole.candidate_features,
        combinedRef?.repo ?? null,
        combinedRef?.prNumber ?? prNumberFromSource(input.source),
        input.source,
      );
      if (typeof features === 'string') {
        out.diagnostics.push(features);
      } else {
        out.features.push(features);
        out.contributingSources.add(input.source);
      }
      return;
    }
    // Standalone `hokusai-scan extract` output.
    if (whole.schema_version === 'candidate_features/v1') {
      const prNumber = prNumberFromSource(input.source);
      if (prNumber === null) {
        out.diagnostics.push(
          `${input.source}: candidate features without a pr-<n> token in the filename, skipped`,
        );
        return;
      }
      const features = intakeFeatures(whole, null, prNumber, input.source);
      if (typeof features === 'string') {
        out.diagnostics.push(features);
      } else {
        out.features.push(features);
        out.contributingSources.add(input.source);
      }
      return;
    }
    // A single label row serialized as one JSON document.
    if (whole.schema_version === '1.0.0' && typeof whole.prUrl === 'string') {
      const label = intakeLabelRow(whole, input.source);
      if (typeof label === 'string') {
        out.diagnostics.push(label);
      } else {
        out.labels.push(label);
        out.contributingSources.add(input.source);
      }
      return;
    }
    out.diagnostics.push(`${input.source}: unrecognized JSON document, skipped`);
    return;
  }

  // JSONL: one survival label per line (the `label` subcommand's output).
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] as string).trim();
    if (line === '') continue;
    const where = `${input.source}:${index + 1}`;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      out.diagnostics.push(`${where}: not valid JSON, line skipped`);
      continue;
    }
    const label = intakeLabelRow(row, where);
    if (typeof label === 'string') {
      out.diagnostics.push(label);
      continue;
    }
    out.labels.push(label);
    out.contributingSources.add(input.source);
  }
}

// ── Aggregation ─────────────────────────────────────────────────────────────

interface PrState {
  ref: PrRef;
  /** Deduplicated outcome at the reporting horizon; undefined = no label row. */
  outcomeAtHorizon?: { reportOutcome: ReportOutcome; computedAt: string };
  verdict?: ShadowFlagVerdict;
  /** Source of the joined features (lexicographically greatest wins). */
  featuresSource?: string;
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Number((numerator / denominator).toFixed(4));
}

/**
 * Aggregate accumulated shadow-scan output into the per-repo report.
 *
 * Deterministic given the same inputs and options: inputs are processed in
 * sorted `source` order, label rows deduplicate by (prUrl, horizon) keeping
 * the latest `computed_at` (later-encountered row wins a tie), and feature
 * rows deduplicate by (repo, pr) keeping the lexicographically greatest
 * source (run ids grow, so a re-scan's artifact sorts later).
 */
export function aggregateShadowScans(
  inputs: readonly ShadowScanInput[],
  options: ShadowAggregateOptions,
): ShadowAggregateResult {
  const horizonDays = options.horizonDays ?? DEFAULT_REPORT_HORIZON;
  const parsed: ParsedInputs = {
    labels: [],
    features: [],
    diagnostics: [],
    contributingSources: new Set(),
  };
  for (const input of [...inputs].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0))) {
    parseOneInput(input, parsed);
  }

  // Dedupe labels by (prUrl, horizon): latest computed_at wins.
  const dedupedLabels = new Map<string, LabelRow>();
  for (const label of parsed.labels) {
    const key = `${label.prUrl}\u0000${label.horizonDays}`;
    const existing = dedupedLabels.get(key);
    if (existing === undefined || label.computedAt >= existing.computedAt) {
      dedupedLabels.set(key, label);
    }
  }

  // Every PR a label mentions, at any horizon, is "seen".
  const prStates = new Map<string, PrState>();
  const prKey = (ref: PrRef): string => `${ref.repo}\u0000${ref.prNumber}`;
  for (const label of dedupedLabels.values()) {
    const key = prKey(label.ref);
    const state = prStates.get(key) ?? { ref: label.ref };
    if (label.horizonDays === horizonDays) {
      state.outcomeAtHorizon = {
        reportOutcome: label.reportOutcome,
        computedAt: label.computedAt,
      };
    }
    prStates.set(key, state);
  }

  // Join features. Repo resolution for standalone feature files: the labels'
  // single repo when unambiguous, else the single repo that labelled that PR
  // number; anything still ambiguous is skipped with a diagnostic rather than
  // guessed into the wrong repo's precision.
  const labelRepos = new Set<string>();
  for (const state of prStates.values()) labelRepos.add(state.ref.repo);
  const reposByPrNumber = new Map<number, Set<string>>();
  for (const state of prStates.values()) {
    const set = reposByPrNumber.get(state.ref.prNumber) ?? new Set<string>();
    set.add(state.ref.repo);
    reposByPrNumber.set(state.ref.prNumber, set);
  }

  for (const feature of parsed.features) {
    let repo = feature.repo;
    const prNumber = feature.prNumber;
    if (prNumber === null) {
      parsed.diagnostics.push(`${feature.source}: candidate features without a PR number, skipped`);
      continue;
    }
    if (repo === null) {
      if (labelRepos.size === 1) {
        repo = [...labelRepos][0] as string;
      } else {
        const candidates = reposByPrNumber.get(prNumber);
        if (candidates !== undefined && candidates.size === 1) {
          repo = [...candidates][0] as string;
        }
      }
    }
    if (repo === null) {
      parsed.diagnostics.push(
        `${feature.source}: cannot attribute PR #${prNumber} to a repo (no matching labels), skipped`,
      );
      continue;
    }
    const key = prKey({ repo, prNumber });
    const state = prStates.get(key) ?? { ref: { repo, prNumber } };
    // Dedupe by (repo, pr): lexicographically greatest source wins.
    if (state.featuresSource === undefined || feature.source >= state.featuresSource) {
      state.verdict = evaluateShadowRule(feature.features);
      state.featuresSource = feature.source;
    }
    prStates.set(key, state);
  }

  // Tally per repo.
  const repoNames = [...new Set([...prStates.values()].map((state) => state.ref.repo))].sort();
  const repos: ShadowRepoSummaryV1[] = repoNames.map((repoName) => {
    const states = [...prStates.values()].filter((state) => state.ref.repo === repoName);
    const outcomes = {
      survived: 0,
      followup: 0,
      substantially_rewritten: 0,
      reverted: 0,
      missing: 0,
    };
    const flags = { flag: 0, no_flag: 0, unknown: 0 };
    let labelledPrs = 0;
    let truePositives = 0;
    let falsePositives = 0;
    for (const state of states) {
      const verdict: ShadowFlagVerdict = state.verdict ?? 'unknown';
      flags[verdict] += 1;
      if (state.outcomeAtHorizon === undefined) continue;
      labelledPrs += 1;
      const outcome = state.outcomeAtHorizon.reportOutcome;
      if (outcome === null) {
        outcomes.missing += 1;
        continue;
      }
      outcomes[outcome] += 1;
      if (verdict !== 'flag') continue;
      if (outcome === 'survived') falsePositives += 1;
      else truePositives += 1;
    }
    const knownOutcomes =
      outcomes.survived + outcomes.followup + outcomes.substantially_rewritten + outcomes.reverted;
    const reworkedPrs = knownOutcomes - outcomes.survived;
    const precisionSuppressed = reworkedPrs < PRECISION_SUPPRESSION_FLOOR;
    return {
      repo: repoName,
      prs_seen: states.length,
      labelled_prs: labelledPrs,
      outcomes,
      survival_rate: ratio(outcomes.survived, knownOutcomes),
      reworked_prs: reworkedPrs,
      flags,
      would_flag_rate: ratio(flags.flag, flags.flag + flags.no_flag),
      true_positives: truePositives,
      false_positives: falsePositives,
      would_be_precision: precisionSuppressed
        ? null
        : ratio(truePositives, truePositives + falsePositives),
      precision_suppressed: precisionSuppressed,
    };
  });

  const report: ShadowRepoReportV1 = {
    schema_version: SHADOW_REPO_REPORT_SCHEMA_VERSION,
    generated_at: options.asOf.toISOString(),
    horizon_days: horizonDays,
    shadow_rule: {
      id: SHADOW_RULE_ID,
      description: SHADOW_RULE_DESCRIPTION,
      trained_model: false,
    },
    inputs_read: parsed.contributingSources.size,
    repos,
  };

  return {
    report,
    markdown: renderShadowReportMarkdown(report),
    diagnostics: parsed.diagnostics,
  };
}

// ── Rendering ───────────────────────────────────────────────────────────────

function percent(numerator: number, denominator: number): string {
  if (denominator === 0) return 'n/a';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

/**
 * Render the report as the markdown block written to `last-report.md` and to
 * the Actions run summary (both Actions-only surfaces, never a PR surface).
 * Byte-stable for a given report object.
 */
export function renderShadowReportMarkdown(report: ShadowRepoReportV1): string {
  const lines: string[] = [
    '# Hokusai shadow-mode survival report',
    '',
    `- generated_at: ${report.generated_at}`,
    `- horizon: ${report.horizon_days} days`,
    `- shadow rule: \`${report.shadow_rule.id}\` — ${report.shadow_rule.description} (${PLACEHOLDER_RULE_PHRASE})`,
    `- inputs read: ${report.inputs_read}`,
    '- shadow mode (Arbiter §15.4 step 1): nothing in this report is surfaced on any PR',
    '',
  ];
  if (report.repos.length === 0) {
    lines.push('No scan inputs found — nothing to report yet.', '');
    return lines.join('\n');
  }
  for (const repo of report.repos) {
    const { outcomes, flags } = repo;
    const knownOutcomes =
      outcomes.survived + outcomes.followup + outcomes.substantially_rewritten + outcomes.reverted;
    const decided = flags.flag + flags.no_flag;
    const precisionLine = repo.precision_suppressed
      ? `- would-be precision: suppressed — ${repo.reworked_prs} reworked PR(s) at ${report.horizon_days}d, fewer than the ${PRECISION_SUPPRESSION_FLOOR} required to quote precision honestly (TP ${repo.true_positives}, FP ${repo.false_positives}; ${PLACEHOLDER_RULE_PHRASE})`
      : `- would-be precision: ${percent(repo.true_positives, repo.true_positives + repo.false_positives)} (TP ${repo.true_positives}, FP ${repo.false_positives}; ${PLACEHOLDER_RULE_PHRASE})`;
    lines.push(
      `## ${repo.repo}`,
      '',
      `- PRs seen: ${repo.prs_seen} (labelled at ${report.horizon_days}d: ${repo.labelled_prs})`,
      `- outcomes at ${report.horizon_days}d: survived ${outcomes.survived}, followup ${outcomes.followup}, substantially_rewritten ${outcomes.substantially_rewritten}, reverted ${outcomes.reverted}, missing ${outcomes.missing}`,
      `- ${report.horizon_days}-day survival rate: ${percent(outcomes.survived, knownOutcomes)} (${outcomes.survived}/${knownOutcomes} known outcomes)`,
      `- would-be flags: ${flags.flag} flagged, ${flags.no_flag} not flagged, ${flags.unknown} unknown (${PLACEHOLDER_RULE_PHRASE})`,
      `- would-be flag rate: ${percent(flags.flag, decided)} (${flags.flag}/${decided} decided)`,
      precisionLine,
      '',
    );
  }
  return lines.join('\n');
}

/** Canonical serialization of the JSON report (the `--format json` bytes). */
export function serializeShadowReport(report: ShadowRepoReportV1): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
