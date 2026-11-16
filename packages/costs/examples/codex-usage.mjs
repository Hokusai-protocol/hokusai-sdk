// Codex exec --json turn.completed.usage: input includes cached tokens;
// output includes reasoning. Normalize once before metering.
import { createTaskCostTracker, fromCodexUsage } from '@hokusai/costs';

const diagnostics = {};
const usage = fromCodexUsage(
  {
    input_tokens: 1000,
    cached_input_tokens: 800,
    output_tokens: 300,
    reasoning_output_tokens: 200,
  },
  diagnostics,
);
const tracker = createTaskCostTracker({
  taskId: 'codex-usage-example',
  harness: 'codex',
});
tracker.recordUsage({ model: 'gpt-5-codex', usage });
const cost = tracker.summary();
if (cost.totalUsd !== 0.00335)
  throw new Error('cached or reasoning tokens counted twice');
if (Object.keys(diagnostics).length !== 0)
  throw new Error('unexpected cache overflow');
console.log(JSON.stringify(cost, null, 2));
