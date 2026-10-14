// The two-line example: one import, one wrapper call around the harness run.
// Works fully offline — no Hokusai account, no API key, no network.
import { measureTask } from '@hokusai/costs';
import { createFakeHarness } from './fake-harness.mjs';

const harness = createFakeHarness();

const { result, cost } = await measureTask(
  { taskId: 'task-offline-example', events: harness },
  () => harness.run(),
);

if (result !== 42) throw new Error('harness result was not propagated');
if (!(cost.totalUsd > 0)) throw new Error('expected a priced total');
console.log(JSON.stringify(cost, null, 2));
