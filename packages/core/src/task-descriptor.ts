/**
 * Derive the categorical `task_descriptor` carried by Model 30 contribution
 * rows from the raw task text and repository signals a harness has at route
 * time.
 *
 * The descriptor is what makes a contribution row useful for training: it is
 * how the router learns which model suits which kind of work. Every harness
 * needs this, so it lives here rather than in any one adapter.
 *
 * Only opaque categorical labels and buckets are produced. The raw task text is
 * read and discarded — never stored, never returned. See `privacy-model.md`.
 *
 * @module task-descriptor
 */

import {
  bucketRepositoryScale,
  classifyTaskFamily,
  inferReasoningDepth,
  summarizeLanguageSignals,
} from './task-signals.js';
import type { ReasoningDepth, TaskFamily } from './task-packet.js';
import type { HokusaiLanguage } from './contribution/descriptor-types.js';

/**
 * Categorical repository signals available at route time. Counts only — never
 * raw file contents or paths.
 */
export interface TaskDescriptorSignals {
  fileCount?: number | undefined;
  extensionCounts?: Record<string, number> | undefined;
}

export interface TaskDescriptorInput {
  taskText?: string | undefined;
  repositorySignals?: TaskDescriptorSignals | undefined;
}

/**
 * A partial task descriptor. Values are strings except `complexity`, which the
 * descriptor contract declares as a numeric score.
 */
export type TaskDescriptorFields = Record<string, string | number>;

/**
 * Map a reasoning depth onto the numeric complexity score the descriptor
 * contract declares (`HokusaiTaskDescriptor.complexity: number`).
 *
 * The values line up with the server's own string vocabulary in
 * `_complexity_number` (`low`/`small` = 3, `medium`/`moderate` = 5,
 * `high`/`large` = 8) and with wavemill's `complexityToHokusaiScore`, which
 * emits 1-9 on the same scale. Emitting `'shallow' | 'standard' | 'deep'`
 * instead — as this module used to — matched none of them, so the server fell
 * through to its default of 5.0 and every task looked equally complex.
 */
export const REASONING_DEPTH_COMPLEXITY: Record<ReasoningDepth, number> = {
  shallow: 3,
  standard: 5,
  deep: 8,
};

/** Extra string spellings the server's `_complexity_number` understands. */
const COMPLEXITY_ALIASES: Record<string, number> = {
  low: 3,
  small: 3,
  medium: 5,
  moderate: 5,
  high: 8,
  large: 8,
  very_high: 10,
  ...REASONING_DEPTH_COMPLEXITY,
};

/**
 * Coerce a complexity value — numeric, a reasoning depth, or one of the
 * server's string aliases — into a numeric score. Returns `undefined` for a
 * value with no defined meaning rather than defaulting, so the caller can omit
 * the field instead of asserting a complexity it never derived.
 */
export function normalizeComplexity(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return undefined;
  }

  const alias = COMPLEXITY_ALIASES[normalized];
  if (alias !== undefined) {
    return alias;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Map a display language label (`summarizeLanguageSignals` returns `TypeScript`,
 * `Python`, ...) onto the closed `HokusaiLanguage` vocabulary. Labels outside
 * the vocabulary become `unknown` rather than leaking an unmodeled category.
 */
const HOKUSAI_LANGUAGE_BY_LABEL: Record<string, HokusaiLanguage> = {
  python: 'python',
  typescript: 'typescript',
  javascript: 'javascript',
  go: 'go',
  rust: 'rust',
  java: 'java',
  shell: 'bash',
  bash: 'bash',
};

export function normalizeHokusaiLanguage(label: string | undefined): HokusaiLanguage {
  if (typeof label !== 'string') {
    return 'unknown';
  }

  return HOKUSAI_LANGUAGE_BY_LABEL[label.trim().toLowerCase()] ?? 'unknown';
}

/** Map a deterministic TaskFamily label onto the server's HokusaiTaskType set. */
export const TASK_FAMILY_TO_HOKUSAI_TYPE: Record<TaskFamily, string> = {
  bugfix: 'bugfix',
  feature: 'feature',
  migration: 'migration',
  refactor: 'refactor',
  test: 'tests',
  docs: 'docs',
  infra: 'infra',
  chore: 'infra',
  mixed: 'unknown',
  investigation: 'unknown',
};

/**
 * Pick the single dominant language from extension counts. Ties break
 * deterministically by extension name. Returns undefined when no extension maps
 * to a known language.
 */
function dominantLanguage(extensionCounts: Record<string, number>): string | undefined {
  let bestExtension: string | undefined;
  let bestCount = 0;

  for (const [extension, count] of Object.entries(extensionCounts)) {
    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) {
      continue;
    }

    if (
      count > bestCount ||
      (count === bestCount && (bestExtension === undefined || extension < bestExtension))
    ) {
      bestExtension = extension;
      bestCount = count;
    }
  }

  if (bestExtension === undefined) {
    return undefined;
  }

  return summarizeLanguageSignals({ [bestExtension]: bestCount })[0];
}

/**
 * Derive categorical descriptor labels from the raw task text and repository
 * signals available at route time.
 *
 * Fields are omitted rather than guessed: a descriptor with no derivable signal
 * comes back empty, and the caller decides what to do. `buildHarnessOutcomeRow`
 * rejects an empty descriptor, so callers that cannot derive anything should
 * fall back to `{ task_type: 'unknown' }` rather than fabricate labels.
 */
export function deriveTaskDescriptor(input: TaskDescriptorInput): TaskDescriptorFields {
  const derived: TaskDescriptorFields = {};

  const taskText = input.taskText?.trim();
  if (taskText && taskText.length > 0) {
    derived.task_type = TASK_FAMILY_TO_HOKUSAI_TYPE[classifyTaskFamily({ text: taskText })];
    derived.complexity = REASONING_DEPTH_COMPLEXITY[inferReasoningDepth({ text: taskText })];
  }

  const repoSizeBucket = bucketRepositoryScale(input.repositorySignals?.fileCount);
  if (repoSizeBucket) {
    derived.repo_size_bucket = repoSizeBucket;
  }

  const extensionCounts = input.repositorySignals?.extensionCounts;
  if (extensionCounts) {
    const dominant = dominantLanguage(extensionCounts);
    if (dominant) {
      derived.language = normalizeHokusaiLanguage(dominant);
    }
  }

  return derived;
}
