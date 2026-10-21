import { describe, expect, it } from 'vitest';
import { extractCorpusPrNumbers } from './pr-refs.js';

const REPO = 'org/repo';

describe('extractCorpusPrNumbers', () => {
  it('reads squash and merge-commit subjects', () => {
    expect(extractCorpusPrNumbers('Fix the parser (#123)', '', REPO)).toEqual([123]);
    expect(extractCorpusPrNumbers('Merge pull request #45 from org/feature', '', REPO)).toEqual([45]);
  });

  it('reads bors auto merges and rollups', () => {
    expect(extractCorpusPrNumbers('Auto merge of #130000 - user:branch, r=reviewer', '', REPO)).toEqual([130000]);
    expect(extractCorpusPrNumbers('Rollup merge of #129999 - user:fix, r=reviewer', '', REPO)).toEqual([129999]);
  });

  it('returns every member of a batched bors merge', () => {
    expect(extractCorpusPrNumbers('Merge #101 #102 #103', '', REPO)).toEqual([101, 102, 103]);
  });

  it("reads the merge-bot trailer only for the repo's own PRs", () => {
    const body = 'Summary\n\nPull Request resolved: https://github.com/org/repo/pull/777\nApproved by: x';
    expect(extractCorpusPrNumbers('[inductor] tweak', body, REPO)).toEqual([777]);
    expect(extractCorpusPrNumbers('[inductor] tweak', 'Pull Request resolved: https://github.com/other/repo/pull/777', REPO)).toEqual([]);
  });

  it('dedupes a subject and trailer naming the same PR', () => {
    expect(extractCorpusPrNumbers('tweak (#9)', 'Pull Request resolved: https://github.com/org/repo/pull/9', REPO)).toEqual([9]);
  });

  it('ignores mid-subject references and plain issue mentions', () => {
    expect(extractCorpusPrNumbers('Revert #12 because of #13', '', REPO)).toEqual([]);
    expect(extractCorpusPrNumbers('Fixed #35000 -- Corrected a crash', '', REPO)).toEqual([]);
  });
});
