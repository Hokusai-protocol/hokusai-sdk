/**
 * Runs the Hokusai loop twice against an offline mock API, to show the one
 * distinction that decides whether a contribution earns anything:
 *
 *   Run A submits `actual_cost_usd` and lands `training_eligible`.
 *   Run B omits it and lands `partial` — accepted, stored, never trained on.
 *
 * Both return `accepted: true`. Only the fidelity tier tells them apart.
 *
 * @module index
 */

import { FAKE_REPOSITORY_SIGNALS, FAKE_SECRET, createReferenceHarnessAdapter } from './harness/index.js';
import { runHokusaiLoop, type HokusaiLoopResult } from './hokusai/index.js';
import { createMockHokusaiClient } from './mock-client.js';

const REDACTION_SALT = 'reference-harness-salt';
const BUDGET_USD = 0.5;

export interface ReferenceFlowSummary {
  trainingEligible: HokusaiLoopResult;
  partial: HokusaiLoopResult;
}

export async function runReferenceFlow(
  log: (line: string) => void = () => undefined,
): Promise<ReferenceFlowSummary> {
  const adapter = createReferenceHarnessAdapter();
  const client = createMockHokusaiClient();

  const shared = {
    adapter,
    client,
    models: adapter.discoverModels(),
    repositorySignals: FAKE_REPOSITORY_SIGNALS,
    redactionSalt: REDACTION_SALT,
    redactionSecret: FAKE_SECRET,
    log,
  };

  log('');
  log('=== Run A: budget + actual cost reported ===================');
  const trainingEligible = await runHokusaiLoop({
    ...shared,
    budgetUsd: BUDGET_USD,
    idempotencyKey: 'reference-harness-run-a',
  });
  log('');
  log(`  -> ${trainingEligible.fidelityTier ?? 'unknown'}`);
  log('     budget_usd and actual_cost_usd are both numeric, so the server can');
  log('     score success-under-budget. This row trains the router.');

  log('');
  log('=== Run B: actual cost omitted =============================');
  const partial = await runHokusaiLoop({
    ...shared,
    budgetUsd: BUDGET_USD,
    reportCost: false,
    idempotencyKey: 'reference-harness-run-b',
  });
  log('');
  log(`  -> ${partial.fidelityTier ?? 'unknown'}`);
  log('     Without actual_cost_usd the reward scorer cannot decide whether the');
  log('     run came in under budget. The row is accepted and stored as');
  log('     telemetry, excluded from training, and earns no stake.');
  log('');
  log('Both runs returned accepted=true. Only the tier distinguishes them.');
  log('');

  return { trainingEligible, partial };
}

async function main(): Promise<void> {
  await runReferenceFlow((line) => { console.log(line); });
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isEntrypoint) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
