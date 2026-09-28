import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  openTaskCostLedger,
  createNodeFileLedgerStorage,
  defaultLedgerHash,
} from '@hokusai/costs/ledger/node';

const root = await mkdtemp(join(tmpdir(), 'hokusai-ledger-example-'));
try {
  const storage = createNodeFileLedgerStorage({
    path: join(root, 'task-cost-ledger.v1.jsonl'),
  });
  const ledger = await openTaskCostLedger({
    storage,
    hashFn: defaultLedgerHash,
  });
  const base = {
    taskId: 't1',
    model: 'anthropic/claude-sonnet-4-6',
    harness: 'claude-code',
    backend: 'anthropic',
    source: 'provider_reported',
    pricingBasis: 'metered',
    amountMicros: 1200,
    ts: 1000,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    coverage: 'complete',
  };
  await ledger.append(base, { eventKey: 'first' });
  await ledger.append(
    {
      ...base,
      source: 'local_estimate',
      pricingBasis: 'token_equivalent',
      amountMicros: 800,
      ts: 2000,
    },
    { eventKey: 'second' },
  );
  await ledger.append(
    {
      ...base,
      model: 'openai/gpt-5-codex',
      backend: 'openai',
      amountMicros: 250,
      ts: 3000,
    },
    { eventKey: 'third' },
  );
  await ledger.append(
    {
      ...base,
      taskId: 't2',
      model: 'openai/gpt-5-codex',
      backend: 'openai',
      source: 'none',
      pricingBasis: 'unpriced',
      amountMicros: null,
      coverage: 'partial',
      ts: 4000,
    },
    { eventKey: 'fourth' },
  );
  const duplicate = await ledger.append(base, { eventKey: 'first' });
  if (duplicate.status !== 'duplicate')
    throw new Error('Replay was not deduplicated');
  const before = ledger.query({ groupBy: ['model', 'backend', 'source'] });
  ledger.close();
  const reopened = await openTaskCostLedger({
    storage,
    hashFn: defaultLedgerHash,
  });
  const after = reopened.query({ groupBy: ['model', 'backend', 'source'] });
  if (!isDeepStrictEqual(before, after))
    throw new Error('Reopened totals changed');
  console.log(JSON.stringify(after, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
