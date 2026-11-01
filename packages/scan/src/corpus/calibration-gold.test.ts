import { describe, expect, it } from 'vitest';
import { parseCsv } from './calibration.js';
import { GOLD_PASS_SHARE, insertGoldRows, parseGoldSet, renderGoldSheet, scoreGold, splitGoldRows, type GoldItem } from './calibration-gold.js';

const pr = (n: number) => `https://github.com/x/y/pull/${n}`;
const gold = (n: number, kind: GoldItem['kind'], corrective: 'yes' | 'no', extra: Partial<GoldItem> = {}): GoldItem => ({
  item_id: n.toString(16).padStart(12, '0'),
  use: 'hidden',
  kind,
  pr_url: pr(n),
  candidate_fixes: [],
  related_prs: [pr(n + 100)],
  expected: { corrective, exclusion_code: '', fix_url: '' },
  why: 'test',
  ...extra,
});
const items = [
  gold(1, 'revert_defect', 'yes', { candidate_fixes: [pr(201)], expected: { corrective: 'yes', exclusion_code: '', fix_url: pr(201) } }),
  gold(2, 'revert_non_defect', 'no', { candidate_fixes: [pr(202)], expected: { corrective: 'no', exclusion_code: 'revert_non_defect', fix_url: '' } }),
  gold(3, 'missed_fix', 'yes', { expected: { corrective: 'yes', exclusion_code: '', fix_url: pr(103) } }),
  gold(4, 'negative', 'no'),
];
const set = { procedure: 'hok-3269-gold', gold_version: '1.0.0', items };
const blank = 'item_id,pr_url,candidate_fixes,related_prs,corrective,cause_code,exclusion_code,notes\naaaaaaaaaaaa,https://github.com/o/r/pull/1,,,,,,\nbbbbbbbbbbbb,https://github.com/o/r/pull/2,,,,,,\n';
const SEED = 'c'.repeat(64);

describe('parseGoldSet', () => {
  it('accepts a valid set and rejects an inconsistent answer', () => {
    expect(parseGoldSet(set).items).toHaveLength(4);
    expect(() => parseGoldSet({ ...set, items: [{ ...items[1]!, expected: { corrective: 'no', exclusion_code: '', fix_url: '' } }] })).toThrow('needs a human exclusion code');
    expect(() => parseGoldSet({ ...set, items: [items[0], items[0]] })).toThrow('duplicate');
    expect(() => parseGoldSet({ ...set, procedure: 'x' })).toThrow();
  });
});

describe('insertGoldRows', () => {
  it('mixes blank gold rows into a blank sheet, the same way for the same seed', () => {
    const sheet = insertGoldRows(blank, items, SEED);
    const rows = parseCsv(sheet).slice(1);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r[0])).toEqual(expect.arrayContaining(items.map((g) => g.item_id)));
    expect(rows.find((r) => r[0] === items[0]!.item_id)!.slice(2, 4)).toEqual([pr(201), pr(101)]);
    expect(insertGoldRows(blank, items, SEED)).toBe(sheet);
  });

  it('refuses a sheet with labels, a repeat run, or a gold PR that is a sample item', () => {
    expect(() => insertGoldRows(blank.replace('/pull/1,,,,', '/pull/1,,,yes,'), items, SEED)).toThrow('already has labels');
    expect(() => insertGoldRows(insertGoldRows(blank, items, SEED), items, SEED)).toThrow('already in the sheet');
    expect(() => insertGoldRows(blank, [{ ...items[0]!, pr_url: 'https://github.com/o/r/pull/1' }], SEED)).toThrow('is a sample item');
  });
});

describe('scoreGold and splitGoldRows', () => {
  const fill = (sheet: string, labels: Record<string, string>) =>
    sheet
      .split('\n')
      .map((line) => {
        const id = line.split(',')[0]!;
        return labels[id] ? line.replace(/,,,,$/, `,${labels[id]}`) : line;
      })
      .join('\n');
  const filled = fill(insertGoldRows(blank, items, SEED), {
    [items[0]!.item_id]: 'yes,test_gap,,',
    [items[1]!.item_id]: 'no,,revert_non_defect,',
    [items[2]!.item_id]: `yes,local_generation_error,,fixed in ${pr(103)}`,
    [items[3]!.item_id]: 'unclear,,,',
    aaaaaaaaaaaa: 'no,,,',
  });

  it('counts correct verdicts, with unclear as wrong, and the secondary checks', () => {
    const result = scoreGold(filled, items, GOLD_PASS_SHARE.hidden);
    expect(result).toMatchObject({ items: 4, correct: 3, min_correct: 4, passed: false, unlabelled: 0, exclusion: { matched: 1, of: 1 }, missed_fix_cited: { cited: 1, of: 1 } });
    expect(scoreGold(filled, items, 0.75).passed).toBe(true);
  });

  it('splits gold rows out, leaving the sample rows as they were', () => {
    const { rest, gold: goldSheet } = splitGoldRows(filled, new Set(items.map((g) => g.item_id)));
    expect(parseCsv(rest).slice(1).map((r) => r[0])).toEqual(['aaaaaaaaaaaa', 'bbbbbbbbbbbb']);
    expect(parseCsv(rest)[1]![4]).toBe('no');
    expect(parseCsv(goldSheet)).toHaveLength(5);
  });

  it('renders a blank screening sheet', () => {
    expect(parseCsv(renderGoldSheet(items)).slice(1).map((r) => r[0])).toEqual(items.map((g) => g.item_id));
  });
});
