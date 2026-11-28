/**
 * Example-report selection (HOK-3515 step 1): which public repos may get a
 * Rework Risk example report.
 *
 * A committed manifest lists candidates. A probe measures each one on GitHub
 * and this module decides eligible or not, with every reason. The decision is
 * pure, so the probe, the batch command and the tests share one rule.
 *
 * Training and holdout exclusion: every repo the model could have seen comes
 * from a corpus manifest. That includes the development repos and the HOK-3028
 * evaluation slice, because the slice is drawn from the cohort's own repos. A
 * candidate in any listed corpus manifest, in any status, is excluded with the
 * single reason `in_training_or_holdout`. The reason is the same for
 * development and slice repos, so the output never says which repos are held
 * out. The evaluation-slice manifest is never read here. A private set that
 * is not in a public manifest can be passed as salted SHA-256 hashes.
 */
import { createHash } from 'node:crypto';

export const EXAMPLE_SELECTION_VERSION = '0.2.0';

export interface ExampleThresholds {
  min_merged_prs_per_year: number;
  min_base_is_default_share: number;
  min_pr_mapped_commit_share: number;
  /**
   * Share of sampled PRs into the default branch whose landing commit's
   * subject carries the PR's number ("(#N)" or "Merge pull request #N"). The
   * scanner finds PRs on the main line only this way, so a rebase-merging repo
   * can be fully PR-mapped on GitHub yet scan empty (zephyr, HOK-3515 dry
   * run). Optional for older manifests.
   */
  min_pr_number_in_subject_share?: number;
  /** Lower bound on reworked PRs: revert PRs in the last year. Must be at least the report's retrospective floor. */
  min_revert_prs_per_year: number;
  min_agent_share: number;
  /** Merge conventions the corpus enumerator can map PRs from. */
  supported_conventions: string[];
}

export interface ExampleCandidate {
  repo: string;
  /** First batch, swap list, the 50-repo dry run, … */
  batch: string;
  role: 'primary' | 'swap' | 'dry_run';
  default_branch_aliases?: string[];
  note?: string;
}

export interface ExampleManifest {
  manifest_version: string;
  issue: string;
  /** Repo-relative paths of every corpus manifest whose repos are training or held-out data. */
  exclude_corpus_manifests: string[];
  /** Days of merged-PR history the probe samples, ending at `--as-of` minus the label horizon. */
  window_days: number;
  horizon_days: number;
  thresholds: ExampleThresholds;
  candidates: ExampleCandidate[];
  changes?: unknown[];
}

/** What the probe measured; field names match the cohort probe's `metrics`. */
export interface ExampleProbeMetrics {
  merged_prs_per_year: number;
  revert_prs_per_year: number;
  base_is_default_share: number | null;
  pr_mapped_commit_share: number | null;
  /** Absent in probes before selection 0.2.0. */
  pr_number_in_subject_share?: number | null;
  agent_share: number | null;
}

export interface ExampleProbeInput {
  archived: boolean;
  observed_merge_convention: string;
  metrics: ExampleProbeMetrics;
}

export interface ExampleDecision {
  eligible: boolean;
  /** Stable codes; detail strings follow a colon. Empty when eligible. */
  reasons: string[];
}

export const EXCLUDED_REASON = 'in_training_or_holdout';

/** Repo names compare case-insensitively, as GitHub resolves them. */
export const repoKey = (repo: string): string => repo.trim().toLowerCase();

/** Hash for a private exclusion list: sha256(salt ‖ 0x00 ‖ lowercased owner/name), hex. */
export function hashRepo(salt: string, repo: string): string {
  return createHash('sha256').update(salt).update('\0').update(repoKey(repo)).digest('hex');
}

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function parseExampleManifest(value: unknown, minReworked: number): ExampleManifest {
  const m = value as ExampleManifest;
  const fail = (why: string): never => {
    throw new Error(`example manifest: ${why}`);
  };
  if (!m || typeof m !== 'object') fail('not an object');
  if (typeof m.manifest_version !== 'string') fail('manifest_version missing');
  if (!Array.isArray(m.exclude_corpus_manifests) || m.exclude_corpus_manifests.length === 0)
    fail('exclude_corpus_manifests must list at least one corpus manifest');
  if (!Number.isInteger(m.window_days) || m.window_days < 90) fail('window_days must be an integer ≥ 90');
  if (!Number.isInteger(m.horizon_days) || m.horizon_days < 1) fail('horizon_days must be a positive integer');
  const t = m.thresholds;
  if (!t || typeof t !== 'object') fail('thresholds missing');
  for (const key of ['min_merged_prs_per_year', 'min_revert_prs_per_year'] as const)
    if (!Number.isFinite(t[key]) || t[key] < 0) fail(`thresholds.${key} must be a number ≥ 0`);
  for (const key of ['min_base_is_default_share', 'min_pr_mapped_commit_share', 'min_agent_share'] as const)
    if (!Number.isFinite(t[key]) || t[key] < 0 || t[key] > 1) fail(`thresholds.${key} must be in [0, 1]`);
  if (t.min_pr_number_in_subject_share !== undefined && (!Number.isFinite(t.min_pr_number_in_subject_share) || t.min_pr_number_in_subject_share < 0 || t.min_pr_number_in_subject_share > 1))
    fail('thresholds.min_pr_number_in_subject_share must be in [0, 1]');
  if (t.min_revert_prs_per_year < minReworked)
    fail(`thresholds.min_revert_prs_per_year ${t.min_revert_prs_per_year} is below the report's retrospective floor ${minReworked}`);
  if (!Array.isArray(t.supported_conventions) || t.supported_conventions.length === 0) fail('thresholds.supported_conventions missing');
  if (!Array.isArray(m.candidates) || m.candidates.length === 0) fail('candidates missing');
  const seen = new Set<string>();
  for (const c of m.candidates) {
    if (typeof c?.repo !== 'string' || !REPO.test(c.repo)) fail(`bad candidate repo ${JSON.stringify(c?.repo)}`);
    if (seen.has(repoKey(c.repo))) fail(`duplicate candidate ${c.repo}`);
    seen.add(repoKey(c.repo));
    if (typeof c.batch !== 'string' || !c.batch) fail(`candidate ${c.repo} has no batch`);
    if (!['primary', 'swap', 'dry_run'].includes(c.role)) fail(`candidate ${c.repo} has bad role ${JSON.stringify(c.role)}`);
  }
  return m;
}

/**
 * Everything a model could have trained or been evaluated on. Reads every
 * entry of `repos` and `alternates` regardless of status: a swapped-out or
 * failed repo is still excluded, so a status change can never leak one in.
 */
export class TrainingExclusion {
  private readonly repos = new Set<string>();
  private readonly hashes = new Set<string>();
  private salt: string | null = null;

  addCorpusManifest(manifest: { repos?: { repo: string }[]; alternates?: { repo: string }[] }): this {
    for (const entry of [...(manifest.repos ?? []), ...(manifest.alternates ?? [])]) this.repos.add(repoKey(entry.repo));
    return this;
  }

  /** A private list: `{ salt, sha256: [...] }` built with `hashRepo`. */
  addHashedList(list: { salt: string; sha256: string[] }): this {
    if (typeof list?.salt !== 'string' || !list.salt || !Array.isArray(list.sha256)) throw new Error('hashed exclusion list needs salt and sha256[]');
    if (this.salt !== null && this.salt !== list.salt) throw new Error('hashed exclusion lists must share one salt');
    this.salt = list.salt;
    for (const h of list.sha256) this.hashes.add(String(h).toLowerCase());
    return this;
  }

  get size(): number {
    return this.repos.size + this.hashes.size;
  }

  has(repo: string): boolean {
    if (this.repos.has(repoKey(repo))) return true;
    return this.salt !== null && this.hashes.has(hashRepo(this.salt, repo));
  }
}

/** Every failed check, not just the first, so a near miss shows what to fix. */
export function decideExample(input: ExampleProbeInput, t: ExampleThresholds, excluded: boolean): ExampleDecision {
  const reasons: string[] = [];
  if (excluded) reasons.push(EXCLUDED_REASON);
  if (input.archived) reasons.push('archived');
  const m = input.metrics;
  const below = (code: string, value: number | null, min: number) => {
    if ((value ?? 0) < min) reasons.push(`${code}: ${value ?? 'unmeasured'} < ${min}`);
  };
  below('merged_prs_per_year', m.merged_prs_per_year, t.min_merged_prs_per_year);
  below('base_is_default_share', m.base_is_default_share, t.min_base_is_default_share);
  below('pr_mapped_commit_share', m.pr_mapped_commit_share, t.min_pr_mapped_commit_share);
  if (t.min_pr_number_in_subject_share !== undefined) below('pr_number_in_subject_share', m.pr_number_in_subject_share ?? null, t.min_pr_number_in_subject_share);
  below('revert_prs_per_year', m.revert_prs_per_year, t.min_revert_prs_per_year);
  below('agent_share', m.agent_share, t.min_agent_share);
  if (!t.supported_conventions.includes(input.observed_merge_convention))
    reasons.push(`merge_convention: ${input.observed_merge_convention} not supported`);
  return { eligible: reasons.length === 0, reasons };
}
