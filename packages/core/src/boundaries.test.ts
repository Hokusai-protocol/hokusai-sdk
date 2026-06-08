import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../..');

describe('core boundaries', () => {
  it('does not import adapters or examples', () => {
    expect(() =>
      execFileSync('node', [path.join(repoRoot, 'scripts/check-core-boundaries.mjs')], {
        cwd: repoRoot,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
