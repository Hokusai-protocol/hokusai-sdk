// The record/summary API for hosts that are not wrapping a run: record each
// usage observation yourself, then ask for the report. Includes an unknown
// model to show partial coverage — its cost stays null, never $0, and the
// priced subtotal is reported as a lower bound.
import { createTaskCostTracker } from '@hokusai/costs';

const tracker = createTaskCostTracker({
  taskId: 'task-tracker-example',
  harness: 'native',
});

tracker.recordUsage({
  model: 'claude-sonnet-5',
  usage: {
    inputTokens: 4_000,
    outputTokens: 900,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  },
});
tracker.recordUsage({
  model: 'some-internal-model', // not in any price table
  usage: { inputTokens: 1_000, outputTokens: 200 },
});

const report = tracker.summary();
if (report.totalUsd !== null)
  throw new Error('an unknown model must null the total');
if (!(report.estimatedUsd > 0))
  throw new Error('expected a priced lower bound');
if (report.coverage.unknownModels[0] !== 'some-internal-model') {
  throw new Error('expected the unknown model to be called out');
}
console.log(JSON.stringify(report, null, 2));
