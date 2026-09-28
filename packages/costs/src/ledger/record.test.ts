import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  parseLine,
  serializeLine,
  toLedgerRecord,
} from './record.js';
import { hash, input } from './test-support.js';

describe('ledger record', () => {
  it('canonicalizes key order and hashes a deterministic allowlisted record', () => {
    expect(canonicalJson({ z: 1, a: 2 })).toBe(canonicalJson({ a: 2, z: 1 }));
    const a = toLedgerRecord(input(), { eventKey: 'e1' }, hash);
    const b = toLedgerRecord(input(), { eventKey: 'e1' }, hash);
    expect(a).toEqual(b);
    expect(Object.keys(a)).toHaveLength(17);
    expect(parseLine(serializeLine(a).trimEnd(), hash)).toEqual({
      ok: true,
      record: a,
    });
  });
  it('rejects malformed, tampered and future records', () => {
    const a = toLedgerRecord(input(), { eventKey: 'e1' }, hash);
    expect(parseLine('not json', hash)).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(parseLine(JSON.stringify({ ...a, amountMicros: 2 }), hash)).toEqual({
      ok: false,
      reason: 'checksum',
    });
    expect(parseLine(JSON.stringify({ ...a, v: 2 }), hash)).toEqual({
      ok: false,
      reason: 'unsupported_version',
    });
  });
  it.each([
    ['taskId', '/etc/passwd'],
    ['model', '/etc/passwd'],
    ['model', 'sk-ant-api03-AAAAAA'],
    ['backend', '../private'],
    ['amountMicros', -1],
    ['inputTokens', 1.5],
    ['outputTokens', NaN],
    ['cacheReadTokens', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects invalid %s without echoing the value', (field, value) => {
    try {
      toLedgerRecord(input({ [field]: value }), { eventKey: 'e' }, hash);
      throw new Error('accepted');
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_RECORD', field });
      expect(String(error)).not.toContain(String(value));
    }
  });
  it('enforces pricing and amount agreement', () => {
    expect(() =>
      toLedgerRecord(input({ amountMicros: null }), { eventKey: 'e' }, hash),
    ).toThrow();
    expect(() =>
      toLedgerRecord(
        input({ pricingBasis: 'unpriced' }),
        { eventKey: 'e' },
        hash,
      ),
    ).toThrow();
  });
});
