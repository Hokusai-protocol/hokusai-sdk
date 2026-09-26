/**
 * Typed scan inputs and their validators.
 *
 * Every implicit-environment dependency the pre-extraction code had (ambient
 * `gh` auth, origin-remote owner/repo detection, workflow config, wall clock)
 * is a field here instead. The validators are pure — no filesystem, no git,
 * no environment reads — so the same rules apply identically in the CLI, the
 * GitHub Action, and any library caller. Filesystem/git preconditions (repo
 * exists, not a shallow clone) are checked by the CLI shell, which owns the
 * ambient world.
 */

import { HORIZONS, type HorizonDays } from '@hokusai/core';

/** Invalid input surfaced by the CLI as exit code 2. */
export class ScanInputError extends Error {
  override readonly name = 'ScanInputError';
}

/** `owner/name` pair identifying the GitHub repository. */
export interface GithubRepoRef {
  owner: string;
  repo: string;
}

/** Inputs shared by every scan mode. */
export interface ScanCommonInputs {
  /** Local checkout of the repository being scanned. Always explicit. */
  repoDir: string;
  /** GitHub `owner/name`; required whenever GitHub evidence is collected. */
  githubRepo?: GithubRepoRef | undefined;
  /** GitHub token value (already read from the caller-named env var). */
  token?: string | undefined;
  /** Skip all network-touching evidence collection. */
  offline: boolean;
  /** Pinned "now" for deterministic horizon cutoffs and computed_at. */
  asOf?: Date | undefined;
}

/** Inputs for `hokusai-scan label`. */
export interface ScanLabelInputs extends ScanCommonInputs {
  /** Integration branch whose first-parent history is walked. Never `main`. */
  integrationBranch: string;
  /** Horizons to label; defaults to every contract horizon. */
  horizons: HorizonDays[];
  /** Label a single PR URL instead of enumerating the branch. */
  prUrl?: string | undefined;
  /** Maximum merged PRs to enumerate. */
  maxPrs: number;
  /** Collect gh cross-reference (linked issue/PR) evidence. */
  includeLinkedReferences: boolean;
}

/** Inputs for `hokusai-scan extract`. */
export interface ScanExtractInputs extends ScanCommonInputs {
  /** Pull request number the checkout candidates. */
  prNumber: number;
  /** Base ref override for the checkout diff. */
  baseRef?: string | undefined;
  /** Explicit committed-config path override. */
  configPath?: string | undefined;
}

/** Inputs for `hokusai-scan scan` (label one PR + extract, combined). */
export interface ScanInputs extends ScanLabelInputs, ScanExtractInputs {}

// ── Field validators (pure) ────────────────────────────────────────────────

export function validateRepoDir(value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new ScanInputError('--repo is required');
  }
  return value;
}

export function validateIntegrationBranch(value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new ScanInputError('--integration-branch is required');
  }
  if (value === 'main') {
    throw new ScanInputError('integration branch main is rejected (v1.0.0 contract)');
  }
  return value;
}

export function validatePrNumber(value: string | number | undefined): number {
  if (value === undefined || value === '') {
    throw new ScanInputError('--pr is required');
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || !/^\d+$/.test(String(value).trim())) {
    throw new ScanInputError('--pr must be a positive integer');
  }
  return parsed;
}

export function validateGithubRepo(value: string | undefined): GithubRepoRef | undefined {
  if (value === undefined || value === '') return undefined;
  const match = value.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) {
    throw new ScanInputError('--github-repo must be in owner/name form');
  }
  return { owner: match[1] as string, repo: match[2] as string };
}

export function validatePrUrl(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^https?:\/\/\S+\/pull\/\d+\b/.test(value)) {
    throw new ScanInputError('--pr-url must be a full PR URL (https://…/pull/<n>)');
  }
  return value;
}

export function validateAsOf(value: string | undefined): Date | undefined {
  if (value === undefined || value === '') return undefined;
  // Require an explicit ISO-8601 date or timestamp, not the looser forms
  // Date.parse tolerates ("Sep 26", "2026/09/26"), so inputs stay portable.
  // If time is present, timezone must be present (Z or ±HH:MM) to ensure determinism.
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2}))?$/.test(value)) {
    throw new ScanInputError('--as-of must be an ISO-8601 timestamp (e.g., 2026-03-01 or 2026-03-01T00:00:00Z)');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ScanInputError('--as-of must be an ISO-8601 timestamp');
  }
  return parsed;
}

export function validateHorizons(value: string | undefined): HorizonDays[] {
  if (value === undefined || value === '') return [...HORIZONS];
  const parsed = value.split(',').map((part) => Number(part.trim()));
  const invalid = parsed.filter((entry) => !(HORIZONS as readonly number[]).includes(entry));
  if (invalid.length > 0) {
    throw new ScanInputError(
      `invalid horizons ${invalid.join(', ')}: allowed values are ${HORIZONS.join(', ')}`,
    );
  }
  return parsed as HorizonDays[];
}

export function validateMaxPrs(value: string | undefined): number {
  if (value === undefined || value === '') return 1000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ScanInputError('--max-prs must be a positive integer');
  }
  return parsed;
}

/** Env-var NAMES must be identifiers; the VALUE is never accepted as an arg. */
export function validateTokenEnvName(value: string | undefined): string {
  if (value === undefined || value === '') return 'GITHUB_TOKEN';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new ScanInputError('--token-env must name an environment variable');
  }
  return value;
}
