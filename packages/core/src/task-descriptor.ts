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
import type { TaskFamily } from './task-packet.js';

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
export function deriveTaskDescriptor(input: TaskDescriptorInput): Record<string, string> {
  const derived: Record<string, string> = {};

  const taskText = input.taskText?.trim();
  if (taskText && taskText.length > 0) {
    derived.task_type = TASK_FAMILY_TO_HOKUSAI_TYPE[classifyTaskFamily({ text: taskText })];
    derived.complexity = inferReasoningDepth({ text: taskText });
  }

  const repoSizeBucket = bucketRepositoryScale(input.repositorySignals?.fileCount);
  if (repoSizeBucket) {
    derived.repo_size_bucket = repoSizeBucket;
  }

  const extensionCounts = input.repositorySignals?.extensionCounts;
  if (extensionCounts) {
    const dominant = dominantLanguage(extensionCounts);
    if (dominant) {
      derived.language = dominant;
    }
  }

  return derived;
}
