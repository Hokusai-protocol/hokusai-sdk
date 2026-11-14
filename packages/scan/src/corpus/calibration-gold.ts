/**
 * Known-answer ("gold") items that check the HOK-3269 human auditor.
 *
 * Gold items are PRs from public repositories outside the cohort, so they
 * reveal nothing about the sample or the evaluation slice. Each has an
 * answer settled from public evidence. They serve two purposes:
 *
 *   screening   a short paid test a candidate auditor labels before hiring
 *   hidden      rows mixed into sheet-h.csv, indistinguishable from sample rows
 *
 * Hidden rows are removed before any estimate is computed; they only decide
 * whether the audit is accepted. The answer key stays private (the repo is
 * public), and only its hash is recorded before labelling starts.
 * Pure: callers do the file I/O.
 */

import { createHash } from 'node:crypto';
import { CALIBRATION_VERDICTS, HUMAN_EXCLUSION_CODES } from '@hokusai/core';
import { csvCell, parseCsv, SHEET_COLUMNS } from './calibration.js';

export const GOLD_PROCEDURE = 'hok-3269-gold';

export const GOLD_KINDS = ['revert_defect', 'repair_ref', 'missed_fix', 'revert_non_defect', 'planned_followup', 'linkage_trap', 'negative'] as const;
export type GoldKind = (typeof GOLD_KINDS)[number];

/**
 * Share of gold verdicts a labeller must get right, pre-registered before
 * any gold item was labelled. With 10 hidden items, a careful labeller who
 * is right 90% of the time fails 8-of-10 about 7% of the time, and one who
 * is right 60% of the time passes about 17% of the time. `unclear` and blank
 * count as wrong: gold items are chosen to be clear.
 */
export const GOLD_PASS_SHARE = { screening: 0.75, hidden: 0.8 } as const;

export interface GoldItem {
  item_id: string;
  use: 'screening' | 'hidden';
  kind: GoldKind;
  pr_url: string;
  candidate_fixes: string[];
  related_prs: string[];
  expected: { corrective: 'yes' | 'no'; exclusion_code: string; fix_url: string };
  why: string;
}

export interface GoldSet {
  procedure: typeof GOLD_PROCEDURE;
  gold_version: string;
  items: GoldItem[];
}

const PR_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/;

export function parseGoldSet(raw: unknown): GoldSet {
  const set = raw as GoldSet;
  if (set?.procedure !== GOLD_PROCEDURE) throw new Error('not a hok-3269-gold file');
  if (typeof set.gold_version !== 'string' || !Array.isArray(set.items) || !set.items.length) throw new Error('gold set needs gold_version and items');
  const ids = new Set<string>();
  for (const item of set.items) {
    const where = item?.item_id ?? '(no id)';
    if (!/^[0-9a-f]{12}$/.test(item.item_id ?? '')) throw new Error(`${where}: item_id must be 12 lowercase hex characters`);
    if (ids.has(item.item_id)) throw new Error(`${where}: duplicate item_id`);
    ids.add(item.item_id);
    if (item.use !== 'screening' && item.use !== 'hidden') throw new Error(`${where}: use must be screening or hidden`);
    if (!(GOLD_KINDS as readonly string[]).includes(item.kind)) throw new Error(`${where}: unknown kind ${String(item.kind)}`);
    if (!PR_URL.test(item.pr_url)) throw new Error(`${where}: pr_url is not a PR URL`);
    if (![...item.candidate_fixes, ...item.related_prs].every((u) => PR_URL.test(u))) throw new Error(`${where}: candidate_fixes and related_prs must be PR URLs`);
    const { corrective, exclusion_code } = item.expected ?? {};
    if (corrective !== 'yes' && corrective !== 'no') throw new Error(`${where}: expected.corrective must be yes or no`);
    if (corrective === 'yes' && exclusion_code) throw new Error(`${where}: a yes takes no exclusion code`);
    if (corrective === 'no' && item.candidate_fixes.length && !(HUMAN_EXCLUSION_CODES as readonly string[]).includes(exclusion_code)) throw new Error(`${where}: a no with candidate fixes needs a human exclusion code`);
  }
  return set;
}

const renderRows = (rows: readonly (readonly string[])[]) => `${[SHEET_COLUMNS as readonly string[], ...rows].map((r) => r.map(csvCell).join(',')).join('\n')}\n`;
const blankRow = (g: GoldItem) => SHEET_COLUMNS.map((c) => (c === 'item_id' ? g.item_id : c === 'pr_url' ? g.pr_url : c === 'candidate_fixes' ? g.candidate_fixes.join(' ') : c === 'related_prs' ? g.related_prs.join(' ') : ''));

/** A blank sheet of gold items, for the screening test. */
export function renderGoldSheet(items: readonly GoldItem[]): string {
  return renderRows(items.map(blankRow));
}

function sheetBody(text: string): string[][] {
  const [header, ...rows] = parseCsv(text);
  if (!header || header.join(',') !== SHEET_COLUMNS.join(',')) throw new Error(`sheet header must be ${SHEET_COLUMNS.join(',')}`);
  return rows;
}

/**
 * Mixes hidden gold rows into a blank audit sheet at positions keyed by the
 * sample's private seed. Refuses a sheet that already has labels or gold rows.
 */
export function insertGoldRows(sheet: string, hidden: readonly GoldItem[], seed: string): string {
  const rows = sheetBody(sheet);
  const labelCols = (['corrective', 'cause_code', 'exclusion_code', 'notes'] as const).map((c) => SHEET_COLUMNS.indexOf(c));
  if (rows.some((r) => labelCols.some((i) => (r[i] ?? '').trim()))) throw new Error('the audit sheet already has labels; gold rows go in before labelling');
  const ids = new Set(rows.map((r) => r[0]));
  const urls = new Set(rows.map((r) => r[1]));
  for (const g of hidden) {
    if (ids.has(g.item_id)) throw new Error(`${g.item_id}: already in the sheet`);
    if (urls.has(g.pr_url)) throw new Error(`${g.item_id}: its PR is a sample item`);
  }
  for (const g of hidden) {
    const at = Number.parseInt(createHash('sha256').update(`${seed}\0gold\0${g.item_id}`).digest('hex').slice(0, 8), 16) % (rows.length + 1);
    rows.splice(at, 0, blankRow(g));
  }
  return renderRows(rows);
}

/** Splits a filled sheet into its gold rows and the rest, both as sheets. */
export function splitGoldRows(sheet: string, goldIds: ReadonlySet<string>): { rest: string; gold: string } {
  const rows = sheetBody(sheet);
  return { rest: renderRows(rows.filter((r) => !goldIds.has(r[0]!.trim()))), gold: renderRows(rows.filter((r) => goldIds.has(r[0]!.trim()))) };
}

export interface GoldResult {
  items: number;
  correct: number;
  unlabelled: number;
  min_correct: number;
  passed: boolean;
  /** Of correct `no` verdicts on items with candidate fixes, how many named the expected exclusion code. */
  exclusion: { matched: number; of: number };
  /** Of correct `yes` verdicts on missed-fix items, how many put the fix's URL in notes. */
  missed_fix_cited: { cited: number; of: number };
  per_item: { item_id: string; kind: GoldKind; expected: string; got: string; correct: boolean; notes: string }[];
}

/** Scores a sheet's gold rows against the answer key. Rows for other items are ignored. */
export function scoreGold(sheet: string, items: readonly GoldItem[], passShare: number): GoldResult {
  const rows = sheetBody(sheet);
  const col = (name: (typeof SHEET_COLUMNS)[number]) => SHEET_COLUMNS.indexOf(name);
  const byId = new Map(rows.map((r) => [r[col('item_id')]!.trim(), r]));
  const result: GoldResult = { items: items.length, correct: 0, unlabelled: 0, min_correct: Math.ceil(passShare * items.length), passed: false, exclusion: { matched: 0, of: 0 }, missed_fix_cited: { cited: 0, of: 0 }, per_item: [] };
  for (const g of items) {
    const r = byId.get(g.item_id);
    const get = (name: (typeof SHEET_COLUMNS)[number]) => (r?.[col(name)] ?? '').trim();
    const got = get('corrective').toLowerCase();
    if (!(CALIBRATION_VERDICTS as readonly string[]).includes(got)) result.unlabelled++;
    const correct = got === g.expected.corrective;
    if (correct) result.correct++;
    if (correct && got === 'no' && g.candidate_fixes.length) {
      result.exclusion.of++;
      if (get('exclusion_code').toLowerCase() === g.expected.exclusion_code) result.exclusion.matched++;
    }
    if (correct && g.kind === 'missed_fix') {
      result.missed_fix_cited.of++;
      if (g.expected.fix_url && get('notes').includes(g.expected.fix_url)) result.missed_fix_cited.cited++;
    }
    result.per_item.push({ item_id: g.item_id, kind: g.kind, expected: g.expected.corrective, got: got || '(blank)', correct, notes: get('notes') });
  }
  result.passed = result.correct >= result.min_correct;
  return result;
}
