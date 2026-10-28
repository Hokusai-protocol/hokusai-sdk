/**
 * Contract test for Arbiter corrective-rework records (HOK-3267). Producer
 * output and consumer expectations both validate against the single JSON
 * Schema at `packages/core/schemas/arbiter-corrective-rework.schema.json`,
 * and the corrective boolean is checked to come only from accepted repair
 * pairs via {@link deriveCorrectiveLabel}.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
  ADMITTED_PROXIES,
  ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION,
  CORRECTIVE_PROXIES,
  CORRECTIVE_REASON_CODES,
  EVIDENCE_KINDS,
  EXCLUSION_CODES,
  PROXY_CONFIDENCE,
  correctiveCandidateId,
  deriveCorrectiveLabel,
  type DeriveCorrectiveInput,
  type RepairPairV1,
} from './arbiter-corrective-rework.js';
import { ARBITER_CORRECTIVE_REWORK_V1_JSON_SCHEMA } from './arbiter-corrective-rework-schema.js';
import {
  acceptedCorrectiveCandidateFixture,
  correctiveFalseFixture,
  correctiveMissingFixture,
  correctiveTrueFixture,
  rejectedCorrectiveCandidateFixture,
  repairPairFixture,
} from './fixtures/arbiter-corrective-rework.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '../schemas/arbiter-corrective-rework.schema.json');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8')) as Record<string, unknown>;
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

type Defs = Record<string, { enum?: string[]; properties?: Record<string, { enum?: string[]; items?: { enum?: string[] } }> }>;
const defs = (schema as { $defs: Defs }).$defs;

function mutate<T>(value: T, fn: (draft: T) => void): T {
  const draft = structuredClone(value);
  fn(draft);
  return draft;
}

describe('corrective-rework — schema', () => {
  it('compiles under Ajv 2020-12', () => {
    expect(typeof validate).toBe('function');
  });

  it('the exported TS schema mirror is deep-equal to the JSON file', () => {
    expect(ARBITER_CORRECTIVE_REWORK_V1_JSON_SCHEMA).toEqual(schema);
  });

  it('enums match the exported constants exactly', () => {
    expect(defs.schemaVersion?.enum).toEqual([ARBITER_CORRECTIVE_REWORK_SCHEMA_VERSION]);
    expect(defs.proxy?.enum).toEqual([...CORRECTIVE_PROXIES]);
    expect(defs.exclusionCode?.enum).toEqual([...EXCLUSION_CODES]);
    expect(defs.evidence?.properties?.kind?.enum).toEqual([...EVIDENCE_KINDS]);
    expect(defs.corrective?.properties?.reason_codes?.items?.enum).toEqual([...CORRECTIVE_REASON_CODES]);
  });

  it('every proxy has a confidence tier and abnormal_churn is not admitted', () => {
    expect(Object.keys(PROXY_CONFIDENCE).sort()).toEqual([...CORRECTIVE_PROXIES].sort());
    expect(ADMITTED_PROXIES).not.toContain('abnormal_churn');
  });
});

describe('corrective-rework — positive fixtures', () => {
  const fixtures = {
    'accepted candidate': acceptedCorrectiveCandidateFixture,
    'rejected candidate': rejectedCorrectiveCandidateFixture,
    'repair pair': repairPairFixture,
    'corrective=true': correctiveTrueFixture,
    'corrective=false': correctiveFalseFixture,
    'corrective=null': correctiveMissingFixture,
  };
  for (const [name, record] of Object.entries(fixtures)) {
    it(`${name} validates`, () => {
      expect(validate(record), JSON.stringify(validate.errors)).toBe(true);
    });
    it(`${name} keeps envelope.schema_version equal to schema_version`, () => {
      expect(record.envelope.schema_version).toBe(record.schema_version);
    });
  }

  it('the repair pair and its accepted candidate share identity', () => {
    expect(repairPairFixture.candidate_id).toBe(acceptedCorrectiveCandidateFixture.candidate_id);
    expect(correctiveTrueFixture.repair_pair_ids).toEqual([repairPairFixture.candidate_id]);
  });
});

describe('corrective-rework — negative fixtures', () => {
  const rejects = (name: string, record: unknown): void => {
    it(`rejects ${name}`, () => {
      expect(validate(record)).toBe(false);
    });
  };

  rejects('an accepted candidate with an exclusion code', mutate(acceptedCorrectiveCandidateFixture, (d) => {
    (d as { exclusion_code: string | null }).exclusion_code = 'refactor';
  }));
  rejects('a rejected candidate without an exclusion code', mutate(rejectedCorrectiveCandidateFixture, (d) => {
    d.exclusion_code = null;
  }));
  rejects('a free-form exclusion code', mutate(rejectedCorrectiveCandidateFixture, (d) => {
    (d as { exclusion_code: string }).exclusion_code = 'looked fine to me';
  }));
  rejects('a candidate with no evidence', mutate(acceptedCorrectiveCandidateFixture, (d) => {
    d.evidence = [];
  }));
  rejects('evidence carrying extra free text', mutate(acceptedCorrectiveCandidateFixture, (d) => {
    (d.evidence[0] as unknown as Record<string, unknown>).title = 'Fix crash in parser';
  }));
  rejects('a zero lag', mutate(acceptedCorrectiveCandidateFixture, (d) => {
    d.lag_seconds = 0;
  }));
  rejects('an abbreviated fix sha', mutate(repairPairFixture, (d) => {
    d.fix.sha = 'abc1234';
  }));
  rejects('line_survival above 1', mutate(repairPairFixture, (d) => {
    d.line_survival = 1.5;
  }));
  rejects('an unknown record_type', mutate(repairPairFixture, (d) => {
    (d as { record_type: string }).record_type = 'pair';
  }));
  rejects('unknown top-level properties', mutate(repairPairFixture, (d) => {
    (d as unknown as Record<string, unknown>).diff = '+ x';
  }));
  rejects('corrective=true without repair pairs', mutate(correctiveTrueFixture, (d) => {
    d.repair_pair_ids = [];
  }));
  rejects('corrective=true without confidence', mutate(correctiveTrueFixture, (d) => {
    d.confidence = null;
  }));
  rejects('corrective=true with a negative reason code', mutate(correctiveTrueFixture, (d) => {
    d.reason_codes = ['no_accepted_fix'];
  }));
  rejects('corrective=false with repair pairs', mutate(correctiveFalseFixture, (d) => {
    d.repair_pair_ids = [repairPairFixture.candidate_id];
  }));
  rejects('corrective=false with a proxy reason code', mutate(correctiveFalseFixture, (d) => {
    d.reason_codes = ['revert'];
  }));
  rejects('corrective=null with a confidence', mutate(correctiveMissingFixture, (d) => {
    d.confidence = 'high';
  }));
  rejects('corrective=null without base_label_missing', mutate(correctiveMissingFixture, (d) => {
    d.reason_codes = ['no_accepted_fix'];
  }));
  rejects('a horizon outside 14/30/60', mutate(correctiveTrueFixture, (d) => {
    (d as { horizon_days: number }).horizon_days = 7;
  }));
  rejects('a malformed definition_version', mutate(correctiveTrueFixture, (d) => {
    d.envelope.definition_version = '0.1.0';
  }));
});

describe('corrective-rework — deriveCorrectiveLabel', () => {
  const DAY = 86_400;
  const pair = (lagDays: number, proxy: RepairPairV1['proxy'], id: string, prUrl = repairPairFixture.original.pr_url): DeriveCorrectiveInput['repair_pairs'][number] => ({
    candidate_id: id.repeat(64).slice(0, 64),
    lag_seconds: lagDays * DAY,
    proxy,
    confidence: PROXY_CONFIDENCE[proxy],
    original: { ...repairPairFixture.original, pr_url: prUrl },
  });
  const derive = (horizon: 14 | 30 | 60, pairs: DeriveCorrectiveInput['repair_pairs']) =>
    deriveCorrectiveLabel({
      prUrl: repairPairFixture.original.pr_url,
      horizon_days: horizon,
      base_label_hash: correctiveTrueFixture.base_label_hash,
      base_label_present: true,
      repair_pairs: pairs,
      envelope: { ...correctiveTrueFixture.envelope },
    });

  it('counts a fix merged exactly at the horizon and not one a second later', () => {
    expect(derive(14, [pair(14, 'revert', 'a')]).corrective).toBe(true);
    const late = { ...pair(14, 'revert', 'a'), lag_seconds: 14 * DAY + 1 };
    expect(derive(14, [late]).corrective).toBe(false);
  });

  it('is monotone across horizons', () => {
    const pairs = [pair(20, 'szz', 'a')];
    expect([14, 30, 60].map((h) => derive(h as 14 | 30 | 60, pairs).corrective)).toEqual([false, true, true]);
  });

  it('never admits abnormal_churn', () => {
    expect(derive(60, [pair(2, 'abnormal_churn', 'a')]).corrective).toBe(false);
  });

  it("ignores pairs for other originals", () => {
    expect(derive(60, [pair(2, 'revert', 'a', 'https://github.com/example-org/example-repo/pull/999')]).corrective).toBe(false);
  });

  it('takes the highest confidence and lists proxies in precision order', () => {
    const row = derive(30, [pair(10, 'szz', 'b'), pair(5, 'revert', 'a'), pair(12, 'szz', 'c')]);
    expect(row.confidence).toBe('high');
    expect(row.reason_codes).toEqual(['revert', 'szz']);
    expect(row.repair_pair_ids).toEqual(['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)]);
    expect(validate(row), JSON.stringify(validate.errors)).toBe(true);
  });

  it('candidate ids are stable and distinguish the proxy and the fix', () => {
    const original = { pr_url: 'https://github.com/o/r/pull/1' };
    const fix = { pr_url: 'https://github.com/o/r/pull/2', sha: 'a'.repeat(40) };
    expect(correctiveCandidateId(original, fix, 'revert')).toBe(correctiveCandidateId(original, fix, 'revert'));
    expect(correctiveCandidateId(original, fix, 'revert')).not.toBe(correctiveCandidateId(original, fix, 'szz'));
    expect(correctiveCandidateId(original, { pr_url: null, sha: 'a'.repeat(40) }, 'revert')).not.toBe(
      correctiveCandidateId(original, fix, 'revert'),
    );
  });
});
