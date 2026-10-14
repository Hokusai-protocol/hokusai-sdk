/**
 * The committed example fixture (`examples/fixtures/claude-code-session.jsonl`,
 * shipped in the npm package) must equal the sanitized generator's output, so
 * the two cannot drift. Regenerate with:
 *
 *   UPDATE_FIXTURES=1 pnpm --filter @hokusai/costs test -- example-fixture
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildExampleClaudeSessionJsonl } from './test-support.js';

const fixturePath = fileURLToPath(
  new URL('../../examples/fixtures/claude-code-session.jsonl', import.meta.url),
);

describe('bundled example fixture', () => {
  it('matches the sanitized generator output exactly', () => {
    const generated = buildExampleClaudeSessionJsonl();
    if (process.env.UPDATE_FIXTURES === '1') {
      writeFileSync(fixturePath, generated);
    }
    expect(existsSync(fixturePath)).toBe(true);
    expect(readFileSync(fixturePath, 'utf8')).toBe(generated);
  });
});
