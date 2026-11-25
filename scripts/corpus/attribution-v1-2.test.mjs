import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  chooseFreshSample,
  classifyV12,
  summarizeV12,
} from './attribution-v1-2.mjs';

const protocol = JSON.parse(
  readFileSync(
    'fixtures/arbiter/corpus/hok-2822-attribution-protocol-v1.2.json',
    'utf8',
  ),
);
const row = (extra = {}) => ({
  repo: 'x/y',
  pr_number: 1,
  positive: false,
  genericBot: false,
  ...extra,
});
const input = (extra = {}) => ({
  authorLogin: 'someone',
  headRef: 'fix',
  body: 'Fix',
  title: 'Fix',
  commitMessages: ['Fix'],
  ...extra,
});

test('1.2.0 adds explicit rules and never removes a frozen positive', () => {
  assert.deepEqual(
    classifyV12(row({ positive: true }), input(), protocol).stratum,
    'v1_positive',
  );
  const body = classifyV12(
    row(),
    input({ body: 'This is an AI generated diff.' }),
    protocol,
  );
  assert.equal(body.stratum, 'added_body_disclosure');
  assert.equal(body.positive, true);
  assert.equal(
    classifyV12(
      row(),
      input({ commitMessages: ['[AI Codemod] Skip a scan'] }),
      protocol,
    ).stratum,
    'added_ai_codemod',
  );
  assert.equal(classifyV12(row(), input(), protocol).positive, false);
});

test('owner mappings are repo-specific; a generic bot is still not an agent', () => {
  const seer = input({ headRef: 'seer/fix/x' });
  assert.equal(
    classifyV12(row({ repo: 'getsentry/sentry' }), seer, protocol).stratum,
    'added_owner_mapping',
  );
  assert.equal(classifyV12(row(), seer, protocol).positive, false);
  assert.equal(
    classifyV12(
      row({ repo: 'llvm/llvm-project', genericBot: true }),
      input({ authorLogin: 'Forking-Google-Bazel-Bot' }),
      protocol,
    ).positive,
    true,
  );
  const bot = classifyV12(row({ genericBot: true }), input(), protocol);
  assert.equal(bot.stratum, 'bot_without_agent_evidence');
  assert.equal(bot.positive, false);
});

test('inherited scope flags a positive without changing it', () => {
  const imported = classifyV12(
    row({ positive: true }),
    input({ title: '`rust-analyzer` subtree update' }),
    protocol,
  );
  assert.equal(imported.inherited_upstream, true);
  assert.equal(imported.positive, true);
  const summary = summarizeV12([
    imported,
    classifyV12(row({ pr_number: 2 }), input(), protocol),
  ]);
  assert.equal(summary.v1_2_union, 1);
  assert.equal(summary.inherited_upstream_among_positives, 1);
});

test('fresh sample is pooled, deterministic and excludes the v1 sample', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({
    repo: i % 2 ? 'a/a' : 'b/b',
    pr_number: i,
    stratum: i < 40 ? 'unmarked' : 'v1_positive',
  }));
  const design = { seed: 's', strata: { unmarked: 5 } };
  const excluded = new Set(['a/a#1', 'b/b#2']);
  const first = chooseFreshSample(rows, design, excluded);
  assert.equal(first.length, 5);
  assert.deepEqual(
    first,
    chooseFreshSample([...rows].reverse(), design, excluded),
  );
  assert.ok(first.every((r) => r.stratum === 'unmarked'));
  assert.ok(first.every((r) => !excluded.has(`${r.repo}#${r.pr_number}`)));
  assert.ok(first.every((r) => r.stratum_population === 38));
});
