import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GraphqlRunner } from './enumerate.js';
import { TIMELINE_SPLIT_NODES, captureRepo, chunkNumbers, normalizeCi, normalizeEvidence, normalizeTimeline, readCapturedBatch, type TimelineEvidence } from './feature-capture.js';
import type { PrEvidence } from './features.js';

const page = (nodes: unknown[], hasNextPage = false, endCursor: string | null = null) => ({ pageInfo: { hasNextPage, endCursor }, nodes });
const apiPr = (number: number, over: Record<string, unknown> = {}) => ({
  number, createdAt: '2026-01-01T00:00:00Z', mergedAt: '2026-01-02T00:00:00Z', title: 't', body: 'b', headRefName: 'x',
  reviews: page([]), timelineItems: page([]), userContentEdits: page([]), commits: page([]),
  ...over,
});

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});
const tempDir = (): string => {
  dir = mkdtempSync(join(tmpdir(), 'hok-3023-capture-'));
  return dir;
};

const fromBatch = (query: string) => [...query.matchAll(/pr(\d+): pullRequest\(number:\d+\)/g)].map((match) => Number(match[1]));

describe('normalizeTimeline', () => {
  it('separates timeline events by type', () => {
    const evidence = normalizeTimeline(apiPr(1, {
      timelineItems: page([
        { __typename: 'LabeledEvent', createdAt: 'a', label: { name: 'bug' } },
        { __typename: 'UnlabeledEvent', createdAt: 'b', label: { name: 'bug' } },
        { __typename: 'RenamedTitleEvent', createdAt: 'c', previousTitle: 'p', currentTitle: 'q' },
        { __typename: 'ReviewDismissedEvent', createdAt: 'd', previousReviewState: 'APPROVED', review: { id: 'r' } },
      ]),
    }));
    expect(evidence.label_events.map((event) => event.action)).toEqual(['added', 'removed']);
    expect(evidence.renames).toEqual([{ at: 'c', from: 'p', to: 'q' }]);
    expect(evidence.dismissals).toEqual([{ at: 'd', previous_state: 'APPROVED', review_id: 'r' }]);
  });

  it('is never read from the evidence batch, whose timeline GitHub may have truncated', () => {
    const evidence = normalizeEvidence(apiPr(1, { timelineItems: page([{ __typename: 'LabeledEvent', createdAt: 'a', label: { name: 'bug' } }]) }));
    expect([evidence.label_events, evidence.renames, evidence.dismissals]).toEqual([[], [], []]);
  });
});

describe('timeline capture', () => {
  // GitHub's behaviour, reproduced: past ~310 timeline nodes in one query it drops
  // the rest and still reports hasNextPage: false.
  const CAP = 310;
  const events = (number: number) => Array.from({ length: number % 3 === 0 ? 60 : 5 }, (_, i) => ({ __typename: 'LabeledEvent', createdAt: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`, label: { name: `l${i}` } }));
  const capped: GraphqlRunner = (query) => {
    let budget = CAP;
    return {
      repository: Object.fromEntries(fromBatch(query).map((number) => {
        const nodes = events(number).slice(0, Math.max(0, budget));
        budget -= nodes.length;
        return [`pr${number}`, { number, timelineItems: page(nodes) }];
      })),
    };
  };

  it('splits a batch near the cap, so no PR comes back short', () => {
    const numbers = Array.from({ length: 25 }, (_, i) => i + 1);
    const repoDir = tempDir();
    captureRepo('timeline', 'org/repo', repoDir, numbers, capped, () => {});
    const items = readCapturedBatch<TimelineEvidence>(repoDir, 'timeline', numbers)!.items;
    expect(items.map((item) => item.value!.label_events.length)).toEqual(numbers.map((number) => events(number).length));
    expect(numbers.reduce((sum, number) => sum + events(number).length, 0)).toBeGreaterThan(CAP);
    expect(TIMELINE_SPLIT_NODES).toBeLessThan(CAP / 2);
  });
});

describe('normalizeCi', () => {
  it('uses the finish time and counts failures, not cancellations', () => {
    const ci = normalizeCi({ number: 1, commits: { nodes: [{ commit: { statusCheckRollup: { contexts: page([
      { __typename: 'CheckRun', completedAt: 'x', conclusion: 'FAILURE' },
      { __typename: 'CheckRun', completedAt: 'y', conclusion: 'CANCELLED' },
      { __typename: 'StatusContext', createdAt: 'z', state: 'ERROR' },
    ]) } } }] } });
    expect(ci?.contexts).toEqual([{ at: 'x', failed: true }, { at: 'y', failed: false }, { at: 'z', failed: true }]);
  });

  it('returns null when GitHub retains no rollup', () => {
    expect(normalizeCi({ number: 1, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } })).toBeNull();
  });
});

describe('captureRepo', () => {
  it('resumes: a finished batch is never fetched again', () => {
    const graphql: GraphqlRunner = (query) => ({ repository: Object.fromEntries(fromBatch(query).map((number) => [`pr${number}`, apiPr(number)])) });
    let calls = 0;
    const counted: GraphqlRunner = (query, variables) => { calls++; return graphql(query, variables); };
    const repoDir = tempDir();
    captureRepo('evidence', 'org/repo', repoDir, [1, 2, 3], counted, () => {});
    expect(calls).toBe(1);
    captureRepo('evidence', 'org/repo', repoDir, [1, 2, 3], counted, () => {});
    expect(calls).toBe(1);
  });

  it('follows every page of a truncated connection', () => {
    const graphql: GraphqlRunner = (query) => {
      if (query.includes('after:')) return { repository: { pr: { reviews: page([{ id: 'r2', state: 'APPROVED', submittedAt: 'b', author: null }]) } } };
      return { repository: { pr1: apiPr(1, { reviews: page([{ id: 'r1', state: 'APPROVED', submittedAt: 'a', author: null }], true, 'CUR') }) } };
    };
    const repoDir = tempDir();
    captureRepo('evidence', 'org/repo', repoDir, [1], graphql, () => {});
    const items = readCapturedBatch<PrEvidence>(repoDir, 'evidence', [1])!.items;
    expect(items[0]!.value!.reviews.map((review) => review.id)).toEqual(['r1', 'r2']);
  });

  it('splits a failing batch so one PR cannot lose its neighbours', () => {
    const graphql: GraphqlRunner = (query) => {
      const numbers = fromBatch(query);
      if (numbers.includes(2)) throw new Error('HTTP 502');
      return { repository: Object.fromEntries(numbers.map((number) => [`pr${number}`, apiPr(number)])) };
    };
    const repoDir = tempDir();
    const result = captureRepo('evidence', 'org/repo', repoDir, [1, 2, 3], graphql, () => {});
    expect(result.failed).toBe(1);
    const items = readCapturedBatch<PrEvidence>(repoDir, 'evidence', [1, 2, 3])!.items;
    expect(items.map((item) => item.error)).toEqual([null, 'capture_failed', null]);
  });

  it('records a deleted PR without failing the batch', () => {
    const graphql: GraphqlRunner = () => ({ repository: { pr1: null } });
    const repoDir = tempDir();
    expect(captureRepo('evidence', 'org/repo', repoDir, [1], graphql, () => {}).failed).toBe(0);
    expect(readCapturedBatch<PrEvidence>(repoDir, 'evidence', [1])!.items[0]!.error).toBe('not_found');
  });

  it('chunks the same numbers the same way, whatever their order', () => {
    const numbers = Array.from({ length: 60 }, (_, index) => index + 1);
    expect(chunkNumbers([...numbers].reverse())).toEqual(chunkNumbers(numbers));
  });
});
