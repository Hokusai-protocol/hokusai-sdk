import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REDACTION_CONFIG,
  hashPayload,
  preview,
  redact,
} from './anonymization.js';
import { HokusaiDispatchBuilder } from './client.js';
import { claudeCodeFixture } from './fixtures/claude-code.fixture.js';
import { codexFixture } from './fixtures/codex.fixture.js';
import { wavemillFixture } from './fixtures/wavemill.fixture.js';
import { InMemoryModelRegistry } from './model-registry.js';

const salt = 'test-redaction-salt';

describe('redact', () => {
  it('redacts all supported categories with the default conservative config', () => {
    const input = [
      'Contact alice@example.com about Acme Corp.',
      'Use sk-12345678 and tok-12345678.',
      'password=letmein',
      'https://api.acme.internal/v1/jobs',
      'db-prod.acme.internal',
      'ticket=ABC-12345',
      '```js\nconsole.log("hello");\n```',
      '2026-06-08T12:00:00.000Z ERROR failed to connect',
    ].join('\n');

    const result = redact(input, {
      ...DEFAULT_REDACTION_CONFIG,
      salt,
      knownNames: ['Acme Corp'],
      customRules: [{ category: 'id', pattern: /\bABC-\d{5}\b/g }],
    });

    expect(result.mode).toBe('conservative');
    expect(result.output).not.toContain('alice@example.com');
    expect(result.output).not.toContain('Acme Corp');
    expect(result.output).not.toContain('sk-12345678');
    expect(result.output).not.toContain('tok-12345678');
    expect(result.output).not.toContain('password=letmein');
    expect(result.output).not.toContain('https://api.acme.internal/v1/jobs');
    expect(result.output).not.toContain('db-prod.acme.internal');
    expect(result.output).not.toContain('ABC-12345');
    expect(result.output).not.toContain('console.log("hello");');
    expect(result.output).not.toContain('ERROR failed to connect');
    expect(result.redactions.map((entry) => entry.category)).toEqual(
      expect.arrayContaining([
        'email',
        'org',
        'secret',
        'token',
        'credential',
        'url',
        'hostname',
        'id',
        'code',
        'log',
      ]),
    );
  });

  it('is deterministic for repeated values with the same salt', () => {
    const input = 'alice@example.com and alice@example.com';
    const first = redact(input, { salt });
    const second = redact(input, { salt });

    expect(first.output).toBe(second.output);
    expect(first.redactions).toEqual(second.redactions);
    expect(first.redactions).toHaveLength(1);
    expect(first.redactions[0]).toMatchObject({
      category: 'email',
      count: 2,
    });
  });

  it('removes raw code and raw logs in conservative mode', () => {
    const result = redact(
      '```ts\nconst token = "abc";\n```\nINFO shipped build',
      { salt, mode: 'conservative' },
    );

    expect(result.output).not.toContain('const token = "abc";');
    expect(result.output).not.toContain('INFO shipped build');
  });

  it('keeps preview output non-leaking while showing send-time behavior', () => {
    const input = [
      'Acme Corp contact alice@example.com',
      '```ts\nconsole.log("hello");\n```',
      'INFO shipped build',
    ].join('\n');
    const result = preview(input, {
      salt,
      knownNames: ['Acme Corp'],
    });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('Acme Corp');
    expect(serialized).not.toContain('alice@example.com');
    expect(serialized).not.toContain('console.log("hello");');
    expect(result.hasRawCode).toBe(false);
    expect(result.hasRawLogs).toBe(false);
    expect(result.redactionSummary).toEqual(
      expect.arrayContaining([
        { category: 'org', count: 1 },
        { category: 'email', count: 1 },
      ]),
    );
  });

  it('supports per-category disable, custom rules, and known names', () => {
    const input =
      'Reach alice@example.com at Acme Corp about CASE-123 and password=keepme';

    const result = redact(input, {
      salt,
      credential: false,
      knownNames: ['Acme Corp'],
      customRules: [{ category: 'id', pattern: /\bCASE-\d+\b/g }],
    });

    expect(result.output).toContain('password=keepme');
    expect(result.output).not.toContain('alice@example.com');
    expect(result.output).not.toContain('Acme Corp');
    expect(result.output).not.toContain('CASE-123');
  });

  it('hashes payloads deterministically, ignores object key order, and varies by salt', () => {
    const left = hashPayload({ b: 1, a: { d: 2, c: 3 } }, salt);
    const right = hashPayload({ a: { c: 3, d: 2 }, b: 1 }, salt);
    const differentSalt = hashPayload({ a: { c: 3, d: 2 }, b: 1 }, 'other-salt');

    expect(left).toHaveLength(64);
    expect(left).toBe(right);
    expect(left).not.toBe(differentSalt);
  });

  it('redacts all three reference fixtures without leaking sensitive values', () => {
    for (const fixture of [claudeCodeFixture, codexFixture, wavemillFixture]) {
      const result = redact(fixture.raw, {
        salt,
        knownNames: fixture.knownNames,
        customRules: [{ category: 'id', pattern: /\bticket-[^\s]+\b/g }],
      });

      for (const sensitiveValue of fixture.expectedRedactedValues) {
        expect(result.output).not.toContain(sensitiveValue);
      }
    }
  });

  it('handles empty input and no-sensitive-data input', () => {
    expect(redact('', { salt })).toEqual({
      output: '',
      redactions: [],
      mode: 'conservative',
    });

    const result = redact('plain text only', { salt });
    expect(result.output).toBe('plain text only');
    expect(result.redactions).toEqual([]);
  });

  it('throws for invalid input and empty salt', () => {
    expect(() => redact(null as never, { salt })).toThrow(TypeError);
    expect(() => redact('value', { salt: '' })).toThrow(TypeError);
    expect(() => hashPayload({ ok: true }, '')).toThrow(TypeError);
  });
});

describe('HokusaiClient redaction integration', () => {
  it('uses the reusable redaction engine when redactionConfig is supplied', async () => {
    const builder = new HokusaiDispatchBuilder({
      consent: {
        subjectId: 'user-123',
        grantedScopes: ['task-execution'],
      },
      redactionConfig: {
        salt,
        knownNames: ['Acme Corp'],
      },
      modelRegistry: new InMemoryModelRegistry([
        {
          id: 'gpt-5-codex',
          provider: 'openai',
          family: 'gpt-5',
          capabilities: ['reasoning'],
        },
      ]),
    });

    const payload = await builder.prepareDispatch(
      {
        id: 'task-redaction',
        prompt: 'Email alice@example.com before using sk-12345678 for Acme Corp',
      },
      'gpt-5-codex',
    );

    expect(payload.prompt).toContain('EMAIL_');
    expect(payload.prompt).toContain('SECRET_');
    expect(payload.prompt).toContain('ORG_');
    expect(payload.prompt).not.toContain('alice@example.com');
    expect(payload.redactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'email' }),
        expect.objectContaining({ category: 'secret' }),
        expect.objectContaining({ category: 'org' }),
      ]),
    );
  });
});
