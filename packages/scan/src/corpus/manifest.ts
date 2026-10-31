/**
 * The predeclared cohort manifest (`fixtures/arbiter/corpus/hok-3022-cohort.json`).
 * Only the fields the corpus commands read are typed; the rest is provenance.
 */

export type CohortStatus =
  | 'candidate'
  | 'kept'
  | 'pending_exception'
  | 'unmeasured'
  | 'failed_probe'
  | 'passed_probe'
  | 'swapped_out';

export interface CohortRepo {
  repo: string;
  status: CohortStatus;
  default_branch_aliases?: string[];
  tier?: string;
  observed_merge_convention?: string;
}

export interface CohortManifest {
  manifest_version: string;
  window: { merged_from: string; merged_until: string };
  repos: CohortRepo[];
  alternates: CohortRepo[];
}

/** Statuses that still belong in a corpus run: kept, or awaiting a decision this run informs. */
export const RUNNABLE_STATUSES: readonly CohortStatus[] = ['kept', 'pending_exception', 'unmeasured'];

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseCohortManifest(input: unknown): CohortManifest {
  const fail = (message: string): never => {
    throw new Error(`cohort manifest: ${message}`);
  };
  if (!input || typeof input !== 'object') fail('must be an object');
  const m = input as Partial<CohortManifest>;
  if (typeof m.manifest_version !== 'string') fail('manifest_version is required');
  if (!m.window || !DAY.test(m.window.merged_from ?? '') || !DAY.test(m.window.merged_until ?? '')) fail('window.merged_from/merged_until must be YYYY-MM-DD');
  if (Date.parse(m.window!.merged_from) >= Date.parse(m.window!.merged_until)) fail('window must be non-empty');
  for (const key of ['repos', 'alternates'] as const) {
    if (!Array.isArray(m[key])) fail(`${key} must be an array`);
    for (const entry of m[key]!) {
      if (!REPO.test(entry?.repo ?? '')) fail(`invalid repo ${JSON.stringify(entry?.repo)}`);
      if (typeof entry.status !== 'string') fail(`${entry.repo}: status is required`);
    }
  }
  return m as CohortManifest;
}

/** Cohort and alternate entries a corpus run covers, optionally narrowed to one repo. */
export function runnableRepos(manifest: CohortManifest, only?: string): CohortRepo[] {
  const all = [...manifest.repos, ...manifest.alternates];
  if (only) {
    const entry = all.find((r) => r.repo === only);
    if (!entry) throw new Error(`cohort manifest: ${only} is not declared; add it to the manifest first`);
    return [entry];
  }
  return all.filter((r) => RUNNABLE_STATUSES.includes(r.status));
}
