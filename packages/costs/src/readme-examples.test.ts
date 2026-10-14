/**
 * Executes the README snippets tagged `<!-- readme:test <name> -->` against
 * the real source, so README drift fails CI. Tagged snippets import only from
 * '@hokusai/costs' and use no TypeScript-only syntax; the runner strips the
 * import lines, injects the imported names from the actual root module, and
 * runs the body (with a `harness`/`task` provided for the quickstart).
 */

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as costs from './index.js';
import type { TaskCostReport } from './measure/types.js';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

function taggedSnippet(name: string): string {
  const marker = `<!-- readme:test ${name} -->`;
  const start = readme.indexOf(marker);
  expect(start, `README is missing the "${name}" test marker`).toBeGreaterThan(
    -1,
  );
  const fenceStart = readme.indexOf('```ts', start);
  const bodyStart = readme.indexOf('\n', fenceStart) + 1;
  const fenceEnd = readme.indexOf('```', bodyStart);
  expect(
    fenceEnd,
    `README "${name}" snippet has no closing fence`,
  ).toBeGreaterThan(-1);
  return readme.slice(bodyStart, fenceEnd);
}

/** Strip `import … from '@hokusai/costs'` lines; inject those names instead. */
function prepare(snippet: string): { body: string; names: string[] } {
  const names: string[] = [];
  const lines = snippet.split('\n').filter((line) => {
    const match = /^import\s*\{([^}]+)\}\s*from\s*'([^']+)';?$/.exec(
      line.trim(),
    );
    if (match === null) return true;
    expect(match[2]).toBe('@hokusai/costs');
    names.push(...(match[1] as string).split(',').map((name) => name.trim()));
    return false;
  });
  return { body: lines.join('\n'), names };
}

async function runSnippet(
  name: string,
  extraScope: Record<string, unknown> = {},
): Promise<unknown> {
  const { body, names } = prepare(taggedSnippet(name));
  for (const imported of names) {
    expect(
      costs,
      `README imports "${imported}" which the root does not export`,
    ).toHaveProperty(imported);
  }
  const scope: Record<string, unknown> = { ...extraScope };
  for (const imported of names) {
    scope[imported] = (costs as Record<string, unknown>)[imported];
  }
  const AsyncFunction = Object.getPrototypeOf(async function noop() {
    /* async constructor accessor */
  }).constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<unknown>;
  const fn = new AsyncFunction(
    ...Object.keys(scope),
    `${body}\nreturn typeof report !== 'undefined' ? report : { result, cost };`,
  );
  return fn(...Object.values(scope));
}

describe('README snippets', () => {
  it('quickstart runs and returns a priced report', async () => {
    const emitter = new EventEmitter();
    const harness = {
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
      run(task: string) {
        emitter.emit('usage', {
          model: 'claude-sonnet-5',
          usage: { inputTokens: 1200, outputTokens: 400 },
        });
        return `ran ${task}`;
      },
    };
    const { result, cost } = (await runSnippet('quickstart', {
      harness,
      task: 'demo-task',
    })) as { result: string; cost: TaskCostReport };
    expect(result).toBe('ran demo-task');
    expect(cost.totalUsd ?? 0).toBeGreaterThan(0);
    expect(cost.byModel['claude-sonnet-5']).toBeDefined();
  });

  it('tracker snippet runs and returns a priced report', async () => {
    const report = (await runSnippet('tracker')) as TaskCostReport;
    expect(report.taskId).toBe('task-0001');
    expect(report.totalUsd ?? 0).toBeGreaterThan(0);
    expect(report.byHarness.native).toBeDefined();
  });
});
