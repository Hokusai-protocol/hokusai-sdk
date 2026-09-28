import { TASK_COST_FORBIDDEN_KEYS } from '@hokusai/core';
import { describe, expect, it } from 'vitest';
import { PRIVACY_SENTINEL } from '../sources/test-support.js';
import { openTaskCostLedger } from './ledger.js';
import { createMemoryLedgerStorage } from './storage.js';
import { hash, input } from './test-support.js';

const poison = 'SENTINEL_private_value';
describe('ledger privacy', () => {
  it('persists only the 17 allowlisted keys', async () => {
    const storage = createMemoryLedgerStorage();
    const ledger = await openTaskCostLedger({ storage, hashFn: hash });
    const dirty = {
      ...input(),
      prompt: poison,
      messages: poison,
      cwd: poison,
      accountId: poison,
      email: poison,
      userId: poison,
      raw: poison,
    };
    await ledger.append(dirty, { eventKey: poison });
    expect(storage.contents()).not.toMatch(PRIVACY_SENTINEL);
    expect(JSON.stringify(ledger.query({}))).not.toMatch(PRIVACY_SENTINEL);
    const record = ledger.records()[0];
    expect(record).toBeDefined();
    expect(Object.keys(record ?? {})).toHaveLength(17);
    for (const key of Object.keys(record ?? {}))
      expect(
        TASK_COST_FORBIDDEN_KEYS.has(key.toLowerCase().replaceAll('_', '')),
      ).toBe(false);
  });
  it.each(['taskId', 'model', 'backend'])(
    'rejects poison in %s without echoing it',
    async (field) => {
      const ledger = await openTaskCostLedger({
        storage: createMemoryLedgerStorage(),
        hashFn: hash,
      });
      for (const value of [
        'SENTINEL prompt text',
        '/private/path',
        '../secret',
        'sk-ant-key',
        'user@example.com',
        'x'.repeat(129),
      ]) {
        try {
          await ledger.append(input({ [field]: value }), { eventKey: 'e' });
          throw new Error('accepted');
        } catch (error) {
          expect(error).toMatchObject({ code: 'INVALID_RECORD', field });
          expect(String(error)).not.toContain(value);
        }
      }
    },
  );
});
