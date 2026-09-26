import { describe, expect, it } from 'vitest';
import {
  extractPrNumber,
  parseNameStatusOutput,
  parseRevertAcknowledgements,
} from './diff-parsing.js';

describe('parseNameStatusOutput', () => {
  it('returns an empty list for blank output', () => {
    expect(parseNameStatusOutput('')).toEqual([]);
    expect(parseNameStatusOutput('   \n')).toEqual([]);
  });

  it('parses add/modify/delete rows', () => {
    const entries = parseNameStatusOutput('A\tadded.ts\nM\tchanged.ts\nD\tremoved.ts\n');
    expect(entries).toEqual([
      { status: 'A', path: 'added.ts', previousPath: undefined },
      { status: 'M', path: 'changed.ts', previousPath: undefined },
      { status: 'D', path: 'removed.ts', previousPath: undefined },
    ]);
  });

  it('collapses rename similarity scores and reports both paths', () => {
    const entries = parseNameStatusOutput('R100\told/name.ts\tnew/name.ts\nC085\tsrc/a.ts\tsrc/b.ts');
    expect(entries).toEqual([
      { status: 'R', path: 'new/name.ts', previousPath: 'old/name.ts' },
      { status: 'C', path: 'src/b.ts', previousPath: 'src/a.ts' },
    ]);
  });

  it('drops malformed rows without a path', () => {
    expect(parseNameStatusOutput('M\n\nX')).toEqual([]);
  });
});

describe('extractPrNumber', () => {
  it('matches true merge commit subjects', () => {
    expect(extractPrNumber('Merge pull request #437 from org/branch')).toBe(437);
  });

  it('matches squash-commit trailing (#N) subjects', () => {
    expect(extractPrNumber('HOK-99: first try (#7)')).toBe(7);
  });

  it('ignores a (#N) that is not at the end of the subject', () => {
    expect(extractPrNumber('revert (#7) because reasons')).toBe(null);
  });

  it('returns null for ordinary commits', () => {
    expect(extractPrNumber('fix: a normal commit')).toBe(null);
  });
});

describe('parseRevertAcknowledgements', () => {
  it('accepts only explicit acknowledgement phrases', () => {
    const acks = parseRevertAcknowledgements(
      'This intentionally reverts #12. Also reverts #34.\nMentions #56 casually.',
    );
    expect([...acks].sort((a, b) => a - b)).toEqual([12, 34]);
  });

  it('returns the empty set for null/undefined text', () => {
    expect(parseRevertAcknowledgements(null).size).toBe(0);
    expect(parseRevertAcknowledgements(undefined).size).toBe(0);
  });
});
