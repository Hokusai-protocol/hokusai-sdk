/**
 * Public-surface guard for `@hokusai/costs`:
 *
 * - the root exposes the drop-in API (`measureTask`, `createTaskCostTracker`,
 *   the usage mappers, `TaskCostMeasureError`);
 * - the pre-existing root/ledger/sources runtime export names are unchanged
 *   (exact snapshots, so an accidental removal or addition fails loudly);
 * - the root module's *static* import graph contains no `node:` import (the
 *   session-file reader loads via dynamic `import()` only).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as root from './index.js';
import * as ledger from './ledger/index.js';
import * as claudeCode from './sources/claude-code/index.js';
import * as codex from './sources/codex/index.js';
import * as eventSource from './sources/event-source.js';
import * as nodeFs from './sources/node-fs.js';

function runtimeExports(mod: Record<string, unknown>): string[] {
  return Object.keys(mod).sort();
}

describe('@hokusai/costs public surface', () => {
  it('exposes the drop-in task-cost API from the root', () => {
    expect(root.measureTask).toBeTypeOf('function');
    expect(root.createTaskCostTracker).toBeTypeOf('function');
    expect(root.fromAnthropicUsage).toBeTypeOf('function');
    expect(root.fromOpenAIUsage).toBeTypeOf('function');
    expect(root.TaskCostMeasureError).toBeTypeOf('function');
    expect(root.toLedgerEntries).toBeTypeOf('function');
  });

  it('keeps the root runtime export names stable (snapshot)', () => {
    expect(runtimeExports(root)).toEqual(
      [
        // Engine + pricing (pre-existing).
        'createTaskCostEngine',
        'resolveEventPrice',
        // Ledger re-exports (pre-existing + toLedgerEntries).
        'LEDGER_RECORD_CURRENT_VERSION',
        'TaskCostLedgerError',
        'applyMigrations',
        'canonicalJson',
        'createMemoryLedgerStorage',
        'migrations',
        'openTaskCostLedger',
        'parseLine',
        'queryLedger',
        'serializeLine',
        'summarizeTaskRecords',
        'toLedgerEntries',
        'toLedgerRecord',
        'validateLedgerInput',
        // Drop-in API (HOK-3073).
        'TASK_COST_CAPTURE_KINDS',
        'TaskCostMeasureError',
        'createTaskCostTracker',
        'fromAnthropicUsage',
        'fromOpenAIUsage',
        'measureTask',
      ].sort(),
    );
  });

  it('keeps the ledger subpath export names stable (snapshot)', () => {
    expect(runtimeExports(ledger)).toEqual([
      'LEDGER_RECORD_CURRENT_VERSION',
      'TaskCostLedgerError',
      'applyMigrations',
      'canonicalJson',
      'createMemoryLedgerStorage',
      'migrations',
      'openTaskCostLedger',
      'parseLine',
      'queryLedger',
      'serializeLine',
      'summarizeTaskRecords',
      'toLedgerEntries',
      'toLedgerRecord',
      'validateLedgerInput',
    ]);
  });

  it('keeps the sources subpath export names stable (snapshots)', () => {
    expect(runtimeExports(claudeCode)).toEqual([
      'CLAUDE_CODE_PROVIDER_CONTRACT_VERSION',
      'TASK_COST_SOURCE_DIAGNOSTIC_CODES',
      'extractClaudeCodeUsage',
      'parseClaudeCodeTranscript',
    ]);
    expect(runtimeExports(codex)).toEqual([
      'CODEX_PROVIDER_CONTRACT_VERSION',
      'TASK_COST_SOURCE_DIAGNOSTIC_CODES',
      'extractCodexUsage',
      'parseCodexRollout',
    ]);
    expect(runtimeExports(eventSource)).toEqual([
      'TASK_COST_SOURCE_DIAGNOSTIC_CODES',
      'extractEventSourceUsage',
    ]);
    expect(runtimeExports(nodeFs)).toEqual([
      'TASK_COST_SOURCE_DIAGNOSTIC_CODES',
      'readSessionFilePaths',
      'readSessionFiles',
    ]);
  });

  it('keeps node: imports out of the root static import graph', () => {
    const srcDir = new URL('.', import.meta.url).pathname;
    const visited = new Set<string>();
    const queue = [resolve(srcDir, 'index.ts')];
    const staticImportPattern =
      /(?:^|\n)\s*(?:import|export)[^;]*?from\s+['"]([^'"]+)['"]/g;
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (visited.has(file)) continue;
      visited.add(file);
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(staticImportPattern)) {
        const specifier = match[1] as string;
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/^node:/);
        if (specifier.startsWith('.')) {
          queue.push(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')));
        }
      }
    }
    // Sanity: the walk actually traversed the graph.
    expect(visited.size).toBeGreaterThan(10);
  });
});
