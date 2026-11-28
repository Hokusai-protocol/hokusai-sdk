import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  REPORT_FORBIDDEN_KEYS,
  validateArbiterReportV1,
} from './arbiter-report.js';
import {
  ARBITER_REPORT_V2_INVARIANT_CODES,
  ARBITER_REPORT_V2_JSON_SCHEMA,
  deriveRetrospectiveCounts,
  validateArbiterReportV2,
  type PrRowV2,
  type RetrospectiveKey,
} from './arbiter-report-v2.js';

const root = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../fixtures/arbiter/report-v2',
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixtures are mutated freely
const read = (name: string): any =>
  JSON.parse(readFileSync(join(root, name), 'utf8'));
const schema = read('arbiter-report.v2.schema.json') as Record<string, unknown>;
const ajv = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const VALID = ['retrospective', 'time-split', 'suppressed', 'unavailable'];

describe('arbiter_report/v2 (proposed)', () => {
  it('pins the canonical schema JSON', () =>
    expect(schema).toEqual(ARBITER_REPORT_V2_JSON_SCHEMA));

  it('accepts every generated fixture under both validators', () => {
    for (const name of VALID) {
      const payload: unknown = read(`${name}.v2.json`);
      expect(ajv(payload), name).toBe(true);
      expect(validateArbiterReportV2(payload).ok, name).toBe(true);
    }
  });

  it('agrees with every invalid fixture and covers every invariant code', () => {
    const covered = new Set<string>();
    for (const file of readdirSync(join(root, 'invalid'))) {
      const fixture = read(`invalid/${file}`) as {
        expect: { code: string; path: string };
        payload: unknown;
      };
      const result = validateArbiterReportV2(fixture.payload);
      expect(result.ok, file).toBe(false);
      if (result.ok) continue;
      if (fixture.expect.code === 'schema_violation')
        expect(ajv(fixture.payload), file).toBe(false);
      else {
        expect(
          result.errors.some(
            (e) =>
              e.message === fixture.expect.code &&
              e.path === fixture.expect.path,
          ),
          file,
        ).toBe(true);
        covered.add(fixture.expect.code);
      }
    }
    expect([...covered].sort()).toEqual(
      [...ARBITER_REPORT_V2_INVARIANT_CODES].sort(),
    );
  });

  it('renders training-set and held-out repos with different provenance', () => {
    const held = read('retrospective.v2.json').retrospective.heads[0].training;
    const inSet = read('time-split.v2.json').retrospective.heads[0].training;
    expect([held.split, held.repo_membership]).toEqual([
      'leave_repo_out',
      'excluded',
    ]);
    expect([inSet.split, inSet.repo_membership]).toEqual([
      'time_split',
      'included',
    ]);
  });

  it('carries both calibrations: the repo-calibrated one typed as unavailable, never invented', () => {
    const cals = read('retrospective.v2.json').retrospective.calibrations as {
      kind: string;
      status: string;
      unavailable_reasons: string[];
    }[];
    expect(cals.map((c) => [c.kind, c.status])).toEqual([
      ['portable', 'available'],
      ['repo_calibrated', 'unavailable'],
    ]);
    expect(cals[1]!.unavailable_reasons).toEqual([
      'local_calibration_undefined',
    ]);
  });

  it('rejects forbidden keys inside every new object', () => {
    const base = read('retrospective.v2.json');
    /* eslint-disable @typescript-eslint/no-unsafe-return -- untyped fixture JSON */
    const places: ((r: typeof base) => Record<string, unknown>)[] = [
      (r) => r.retrospective,
      (r) => r.retrospective.heads[0],
      (r) => r.retrospective.heads[0].training,
      (r) => r.retrospective.calibrations[0],
      (r) => r.retrospective.results[0],
      (r) => r.retrospective.results[0].counts,
      (r) => r.prs[0].predictions[0],
      (r) => r.prs[0].targets[0],
    ];
    /* eslint-enable @typescript-eslint/no-unsafe-return */
    for (const key of REPORT_FORBIDDEN_KEYS.map((k) => k.replace('*', '_text')))
      for (const place of places) {
        const r = structuredClone(base);
        place(r)[key] = 'leak';
        expect(validateArbiterReportV2(r).ok, key).toBe(false);
      }
  });

  it('flags a score tied with the threshold (comparison gte)', () => {
    const r = read('retrospective.v2.json');
    const tied = (
      r.prs as {
        predictions: { score: number | null; flagged: boolean | null }[];
      }[]
    )
      .map((pr) => pr.predictions[0]!)
      .find((p) => p.score === 0.5);
    expect(tied?.flagged).toBe(true);
    tied!.flagged = false;
    expect(validateArbiterReportV2(r).ok).toBe(false);
  });

  it('keeps v1 and v2 apart', () => {
    expect(validateArbiterReportV1(read('retrospective.v2.json')).ok).toBe(
      false,
    );
    expect(
      validateArbiterReportV2(
        JSON.parse(
          readFileSync(join(root, '../report/prediction.v1.json'), 'utf8'),
        ),
      ).ok,
    ).toBe(false);
  });
});

describe('deriveRetrospectiveCounts', () => {
  const key: RetrospectiveKey = {
    target: 'cr-0.2.0',
    horizon_days: 30,
    calibration_ref: 'c',
    segment: 'all',
  };
  type Spec = {
    agent?: PrRowV2['agent_at_merge'];
    flagged?: boolean | null;
    positive?: boolean | null;
    status?: 'scored' | 'not_scored' | 'excluded';
    target?: 'mature' | 'immature' | 'missing';
  };
  const rows = (specs: Spec[]) =>
    specs.map(
      (s) =>
        ({
          agent_at_merge: s.agent ?? 'agent',
          targets: [
            {
              target: 'cr-0.2.0',
              horizon_days: 30,
              status: s.target ?? 'mature',
              positive:
                s.target && s.target !== 'mature'
                  ? null
                  : (s.positive ?? false),
            },
          ],
          predictions: [
            s.status && s.status !== 'scored'
              ? {
                  calibration_ref: 'c',
                  status: s.status,
                  reason:
                    s.status === 'excluded'
                      ? 'dependency_bot'
                      : 'missing_merge_time_inputs',
                  score: null,
                  flagged: null,
                }
              : {
                  calibration_ref: 'c',
                  status: 'scored',
                  reason: null,
                  score: s.flagged ? 0.9 : 0.1,
                  flagged: s.flagged ?? false,
                },
          ],
        }) as unknown as PrRowV2,
    );

  it('counts a perfect predictor', () => {
    const d = deriveRetrospectiveCounts(
      rows([
        { flagged: true, positive: true },
        { flagged: true, positive: true },
        { flagged: false, positive: false },
      ]),
      key,
    );
    expect(d.counts).toMatchObject({ tp: 2, fp: 0, fn: 0, tn: 1 });
    expect([d.precision.value, d.recall.value, d.flag_rate.value]).toEqual([
      1,
      1,
      2 / 3,
    ]);
  });

  it('gives no precision when nothing is flagged and no recall without positives', () => {
    const none = deriveRetrospectiveCounts(
      rows([{ positive: true }, { positive: false }]),
      key,
    );
    expect(none.precision).toEqual({ n: 0, value: null });
    expect(none.recall).toEqual({ n: 1, value: 0 });
    const all = deriveRetrospectiveCounts(
      rows([{ flagged: true }, { flagged: true }]),
      key,
    );
    expect(all.recall).toEqual({ n: 0, value: null });
    expect(all.precision).toEqual({ n: 2, value: 0 });
  });

  it('never counts unknown outcomes as negatives, but keeps them in the flag rate', () => {
    const d = deriveRetrospectiveCounts(
      rows([
        { flagged: true, target: 'immature' },
        { flagged: false, target: 'missing' },
        { flagged: false, positive: true },
      ]),
      key,
    );
    expect(d.counts).toMatchObject({
      scored: 3,
      evaluable: 1,
      flagged: 1,
      fn: 1,
      tn: 0,
    });
    expect(d.not_evaluable).toEqual([
      { reason: 'horizon_not_mature', count: 1 },
      { reason: 'label_missing', count: 1 },
    ]);
    expect(d.flag_rate).toEqual({ n: 3, value: 1 / 3 });
  });

  it('separates excluded from eligible-but-unscored', () => {
    const d = deriveRetrospectiveCounts(
      rows([
        { status: 'excluded' },
        { status: 'not_scored' },
        { flagged: true, positive: true },
      ]),
      key,
    );
    expect(d.counts).toMatchObject({ eligible: 2, scored: 1 });
    expect(d.excluded).toEqual([{ reason: 'dependency_bot', count: 1 }]);
    expect(d.not_scored).toEqual([
      { reason: 'missing_merge_time_inputs', count: 1 },
    ]);
  });

  it('puts unknown attribution in neither the agent segment nor anywhere human', () => {
    const r = rows([
      { agent: 'agent', flagged: true, positive: true },
      { agent: 'unknown', flagged: true, positive: true },
      { agent: 'not_agent_signal', positive: true },
    ]);
    expect(
      deriveRetrospectiveCounts(r, { ...key, segment: 'agent_attributed' })
        .counts.eligible,
    ).toBe(1);
    expect(deriveRetrospectiveCounts(r, key).counts.eligible).toBe(3);
  });

  it('handles an empty cohort', () => {
    const d = deriveRetrospectiveCounts([], key);
    expect(d.counts.eligible).toBe(0);
    expect([d.precision.value, d.recall.value, d.flag_rate.value]).toEqual([
      null,
      null,
      null,
    ]);
  });
});
