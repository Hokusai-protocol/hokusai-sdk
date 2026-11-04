/**
 * Aider's stage cost for a v4 contribution row (HOK-3412): the token counts
 * Aider printed, recorded on a `@hokusai/costs` tracker and priced by the
 * shared engine. Aider is not a task-cost contract harness yet, so the
 * summary says `unknown`; the row's stage still says `aider`.
 *
 * Only `sent` / `received` are recorded. Aider's cache counts are diagnostic
 * (whether `sent` already includes them is not established), and its printed
 * session cost is Aider's own estimate, not a provider charge: it stays the
 * row's contributor-reported `actual_cost_usd`.
 *
 * @module stage-cost
 */

import type { StageCostInput } from '@hokusai/core';
import { createTaskCostTracker } from '@hokusai/costs';
import type { AiderAccountingSummary } from './accounting.js';

export function measureAiderStage(input: {
  taskId: string;
  model: string;
  accounting: AiderAccountingSummary;
  observedAt: string;
}): StageCostInput {
  try {
    const tracker = createTaskCostTracker({ taskId: input.taskId, harness: 'unknown' });
    const { inputTokens, outputTokens } = input.accounting;
    if (inputTokens !== undefined || outputTokens !== undefined) {
      tracker.recordUsage({
        model: input.model,
        usage: {
          ...(inputTokens !== undefined ? { inputTokens } : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {}),
        },
        occurredAt: input.observedAt,
      });
    }
    return tracker.summary();
  } catch {
    return { summaries: [] };
  }
}
