import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REWORK_RISK_FEATURE_MANIFEST, validateFeatureColumns } from '@hokusai/core';
import { describe, expect, it } from 'vitest';
import { agentMarkerColumns, detectAgentMarkers, type AgentMarkerCommit, type AgentMarkers } from './agent-markers.js';

const here = dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(
  readFileSync(join(here, '../../../../fixtures/arbiter/rework-risk/agent-marker-cases.json'), 'utf8'),
) as {
  cases: {
    name: string;
    authorLogin?: string;
    authorType?: string;
    headRef?: string;
    commits: AgentMarkerCommit[] | null;
    body?: string;
    bodyUnavailable?: boolean;
    expect: Partial<AgentMarkers>;
  }[];
};

const detect = (item: (typeof cases)[number]) => detectAgentMarkers({
  authorLogin: item.authorLogin ?? 'some-person',
  authorType: item.authorType ?? 'User',
  headRef: item.headRef ?? 'fix-thing',
  commits: item.commits,
  body: item.body ?? null,
  ...(item.bodyUnavailable ? { bodyUnavailable: true } : {}),
});

describe('detectAgentMarkers', () => {
  it.each(cases.map((item) => [item.name, item] as const))('%s', (_name, item) => {
    expect(detect(item)).toMatchObject(item.expect);
  });

  it('is unaffected by repeated use of its patterns', () => {
    const item = cases[0]!;
    expect(detect(item)).toEqual(detect(item));
  });
});

describe('agentMarkerColumns', () => {
  const columns = agentMarkerColumns(detect(cases[0]!));

  it('writes only declared columns', () => {
    expect(validateFeatureColumns(Object.keys(columns), { allowSegments: true })).toEqual([]);
  });

  it('covers every agent column in the manifest', () => {
    const declared = REWORK_RISK_FEATURE_MANIFEST.entries
      .map((entry) => entry.name)
      .filter((name) => name.includes('.agent.') || name === 'segment.author.dependency_bot');
    expect(Object.keys(columns).sort()).toEqual([...declared].sort());
  });

  it('only ever writes a tool family the manifest lists', () => {
    const allowed = REWORK_RISK_FEATURE_MANIFEST.entries.find((entry) => entry.name === 'feature.agent.tool_family')?.categories;
    for (const item of cases) {
      const family = detect(item).family;
      if (family !== null) expect(allowed).toContain(family);
    }
  });
});
