import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  ARBITER_REPORT_INVARIANT_CODES,
  ARBITER_REPORT_V1_JSON_SCHEMA,
  REPORT_FORBIDDEN_KEYS,
  projectSurvivalLabel,
  validateArbiterReportV1,
} from './arbiter-report.js';
import { canonicalHash } from './arbiter-survival-label.js';
import { harvestedSurvivalLabelFixture } from './fixtures/arbiter-survival-label.js';

const root = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../fixtures/arbiter/report',
);
const read = (name: string) =>
  JSON.parse(readFileSync(join(root, name), 'utf8')) as Record<string, unknown>;
const schema = read('arbiter-report.v1.schema.json');
const ajv = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const clone = <T>(value: T): T => structuredClone(value);
describe('arbiter_report/v1', () => {
  it('pins the canonical schema JSON', () =>
    expect(schema).toEqual(ARBITER_REPORT_V1_JSON_SCHEMA));
  it('accepts every generated fixture, including a dot-prefixed repo', () => {
    for (const name of ['full', 'sparse', 'harness-only', 'prediction']) {
      const payload = read(`${name}.v1.json`);
      expect(ajv(payload), name).toBe(true);
      expect(validateArbiterReportV1(payload).ok, name).toBe(true);
    }
    expect((read('full.v1.json').repo as Record<string, unknown>).name).toBe(
      '.github',
    );
  });
  it('agrees with all shared invalid fixtures', () => {
    const covered = new Set<string>();
    for (const file of readdirSync(join(root, 'invalid'))) {
      const fixture = read(`invalid/${file}`) as {
        expect: { code: string; path: string };
        payload: unknown;
      };
      const result = validateArbiterReportV1(fixture.payload);
      expect(result.ok, file).toBe(false);
      if (!result.ok) {
        if (fixture.expect.code !== 'schema_violation') {
          expect(
            result.errors.some(
              (e) =>
                e.message === fixture.expect.code &&
                e.path === fixture.expect.path,
            ),
            file,
          ).toBe(true);
          covered.add(fixture.expect.code);
        } else {
          expect(ajv(fixture.payload), file).toBe(false);
          if (file === 'cost_sum_forbidden.json')
            covered.add('cost_sum_forbidden');
        }
      }
    }
    expect([...covered].sort()).toEqual(
      [...ARBITER_REPORT_INVARIANT_CODES].sort(),
    );
  });
  it('rejects forbidden keys at every envelope depth', () => {
    const full = read('sparse.v1.json');
    for (const key of REPORT_FORBIDDEN_KEYS) {
      for (const location of ['root', 'repo', 'pr', 'label']) {
        const payload = clone(full);
        const prs = payload.prs as { labels: Record<string, unknown>[] }[];
        const target: Record<string, unknown> =
          location === 'root'
            ? payload
            : location === 'repo'
              ? (payload.repo as Record<string, unknown>)
              : location === 'pr'
                ? prs[0]!
                : prs[0]!.labels[0]!;
        target[key] = 'private';
        expect(
          validateArbiterReportV1(payload).ok,
          `${key} at ${location}`,
        ).toBe(false);
      }
    }
  });
  it('keeps all fixture string leaves bounded and whitespace free', () => {
    const walk = (value: unknown): void => {
      if (typeof value === 'string') {
        expect(value.length).toBeLessThanOrEqual(200);
        expect(value).not.toMatch(/\s/);
      } else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object')
        Object.values(value).forEach(walk);
    };
    for (const name of ['full', 'sparse', 'harness-only', 'prediction'])
      walk(read(`${name}.v1.json`));
  });
  it('projects only safe label fields and retains the dispute join', () => {
    const projected = projectSurvivalLabel(harvestedSurvivalLabelFixture);
    expect(projected.label_hash).toBe(
      canonicalHash(harvestedSurvivalLabelFixture),
    );
    expect(projected).not.toHaveProperty('line_ranges');
    expect(projected).not.toHaveProperty('envelope');
    expect(projected).not.toHaveProperty('prUrl');
  });
});
