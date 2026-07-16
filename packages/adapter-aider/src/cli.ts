#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import {
  createAiderHokusaiClient,
  runAiderLoop,
  type RunAiderLoopOptions,
  type RunAiderLoopResult,
} from './index.js';

export interface ParsedCli {
  taskText?: string;
  messageFile?: string;
  cwd?: string;
  maxCostUsd?: number;
  availableModels: string[];
  preferredModel?: string;
  hokusaiApiBaseUrl?: string;
  idempotencyKey?: string;
  aiderBin?: string;
  taskId?: string;
  extraArgs: string[];
  help: boolean;
  jsonOutput: boolean;
}

const USAGE = `hokusai-aider — route a coding task through Hokusai, then run Aider

Usage:
  hokusai-aider [options] [task text]
  hokusai-aider [options] --message "task text"
  hokusai-aider [options] --message-file ./task.txt -- <aider passthrough args>

Options:
  -m, --message <text>              Task text (alternative to positional)
  --message-file <path>             Read task text from file
  --cwd <dir>                       Working directory for Aider (default: cwd)
  --max-cost-usd <number>           Budget hint; missing budget → telemetry row
  --available-model <id>            Add id to the candidate pool (repeatable)
  --preferred-model <id>            Preferred fallback if router omits recommendation
  --hokusai-api-base-url <url>      Override HOKUSAI_API_BASE_URL
  --idempotency-key <key>           Contribution idempotency key
  --aider-bin <path>                Path to the aider binary (default: aider)
  --task-id <id>                    Override auto-generated task id
  --json                            Print a JSON result summary to stdout
  -h, --help                        Show this help

Environment:
  HOKUSAI_API_KEY                   Required for real routing
  HOKUSAI_API_BASE_URL              Override the Hokusai API base URL
  OPENAI_API_BASE, OPENAI_API_KEY   BYOK for Aider via OpenAI-compatible providers

Anything after \`--\` is forwarded to Aider verbatim.
`;

const NEEDS_VALUE = new Set([
  '-m',
  '--message',
  '--message-file',
  '--cwd',
  '--max-cost-usd',
  '--available-model',
  '--preferred-model',
  '--hokusai-api-base-url',
  '--idempotency-key',
  '--aider-bin',
  '--task-id',
]);

export function parseCli(argv: readonly string[]): ParsedCli {
  const parsed: ParsedCli = {
    availableModels: [],
    extraArgs: [],
    help: false,
    jsonOutput: false,
  };
  const positional: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const token = argv[i] ?? '';
    if (token === '--') {
      parsed.extraArgs = argv.slice(i + 1);
      break;
    }
    if (token === '-h' || token === '--help') {
      parsed.help = true;
      i += 1;
      continue;
    }
    if (token === '--json') {
      parsed.jsonOutput = true;
      i += 1;
      continue;
    }
    if (NEEDS_VALUE.has(token)) {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`Missing value for ${token}`);
      }
      applyFlag(parsed, token, value);
      i += 2;
      continue;
    }
    if (token.startsWith('--') && token.includes('=')) {
      const eq = token.indexOf('=');
      const key = token.slice(0, eq);
      const value = token.slice(eq + 1);
      if (!NEEDS_VALUE.has(key)) {
        throw new Error(`Unknown flag: ${key}`);
      }
      applyFlag(parsed, key, value);
      i += 1;
      continue;
    }
    if (token.startsWith('-')) {
      throw new Error(`Unknown flag: ${token}`);
    }
    positional.push(token);
    i += 1;
  }
  if (parsed.taskText === undefined && positional.length > 0) {
    parsed.taskText = positional.join(' ');
  }
  return parsed;
}

function applyFlag(target: ParsedCli, flag: string, value: string): void {
  switch (flag) {
    case '-m':
    case '--message':
      target.taskText = value;
      return;
    case '--message-file':
      target.messageFile = value;
      return;
    case '--cwd':
      target.cwd = value;
      return;
    case '--max-cost-usd': {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`--max-cost-usd must be a non-negative number, got "${value}"`);
      }
      target.maxCostUsd = parsed;
      return;
    }
    case '--available-model':
      target.availableModels.push(value);
      return;
    case '--preferred-model':
      target.preferredModel = value;
      return;
    case '--hokusai-api-base-url':
      target.hokusaiApiBaseUrl = value;
      return;
    case '--idempotency-key':
      target.idempotencyKey = value;
      return;
    case '--aider-bin':
      target.aiderBin = value;
      return;
    case '--task-id':
      target.taskId = value;
      return;
    default:
      throw new Error(`Unknown flag: ${flag}`);
  }
}

export interface CliDeps {
  argv: string[];
  env: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  readMessageFile?: (path: string) => Promise<string>;
  runLoop?: (options: RunAiderLoopOptions) => Promise<RunAiderLoopResult>;
  createClient?: typeof createAiderHokusaiClient;
}

export interface CliOutcome {
  exitCode: number;
  result?: RunAiderLoopResult;
}

/**
 * Wrapper CLI. Returns an exit code instead of calling `process.exit` so tests
 * can assert on it. `deps.runLoop` and `deps.createClient` are injected to keep
 * the CLI unit-testable without hitting Aider or the Hokusai API.
 */
export async function runCli(deps: CliDeps): Promise<CliOutcome> {
  let parsed: ParsedCli;
  try {
    parsed = parseCli(deps.argv);
  } catch (error) {
    deps.stderr(`${(error as Error).message}\n`);
    deps.stderr(USAGE);
    return { exitCode: 2 };
  }

  if (parsed.help) {
    deps.stdout(USAGE);
    return { exitCode: 0 };
  }

  let taskText = parsed.taskText?.trim() ?? '';
  if (!taskText && parsed.messageFile) {
    const read = deps.readMessageFile ?? readMessageFileFromDisk;
    try {
      taskText = (await read(parsed.messageFile)).trim();
    } catch (error) {
      deps.stderr(`Could not read --message-file: ${(error as Error).message}\n`);
      return { exitCode: 2 };
    }
  }
  if (!taskText) {
    deps.stderr('A task description is required. Pass it positionally, via --message, or via --message-file.\n');
    deps.stderr(USAGE);
    return { exitCode: 2 };
  }

  const createClient = deps.createClient ?? createAiderHokusaiClient;
  const client = createClient(
    parsed.hokusaiApiBaseUrl ? { baseUrl: parsed.hokusaiApiBaseUrl } : {},
    deps.env,
  );

  if (!deps.env.HOKUSAI_API_KEY) {
    deps.stderr('HOKUSAI_API_KEY is not set. Routing will fail — set the environment variable and retry.\n');
  }

  const runLoop = deps.runLoop ?? runAiderLoop;
  try {
    const result = await runLoop({
      client,
      taskText,
      env: deps.env,
      log: (line) => deps.stderr(`${line}\n`),
      extraModelIds: parsed.availableModels,
      ...(parsed.cwd ? { cwd: parsed.cwd } : {}),
      ...(parsed.maxCostUsd !== undefined
        ? { budgetUsd: parsed.maxCostUsd }
        : {}),
      ...(parsed.preferredModel ? { preferredModel: parsed.preferredModel } : {}),
      ...(parsed.aiderBin ? { aiderBin: parsed.aiderBin } : {}),
      ...(parsed.taskId ? { taskId: parsed.taskId } : {}),
      ...(parsed.idempotencyKey
        ? { idempotencyKey: parsed.idempotencyKey }
        : {}),
      ...(parsed.extraArgs.length > 0
        ? { extraAiderArgs: parsed.extraArgs }
        : {}),
    });

    printSummary(deps, parsed, result);
    return {
      exitCode: result.aider.exitCode === 0 ? 0 : 1,
      result,
    };
  } catch (error) {
    deps.stderr(`hokusai-aider failed: ${(error as Error).message}\n`);
    return { exitCode: 1 };
  }
}

function printSummary(
  deps: CliDeps,
  parsed: ParsedCli,
  result: RunAiderLoopResult,
): void {
  const costLine =
    result.actualCostUsd !== undefined
      ? `submitted ($${result.actualCostUsd.toFixed(6)})`
      : `omitted${result.costOmittedReason ? ` — ${result.costOmittedReason}` : ''}`;
  const summaryLines = [
    `selected_model: ${result.selectedModel}`,
    `completion_result: ${result.row.completion_result}`,
    `wall_clock_seconds: ${result.aider.wallClockSeconds.toFixed(3)}`,
    `actual_cost_usd: ${costLine}`,
    `fidelity_tier: ${result.fidelityTier ?? '(unknown)'}`,
  ];
  if (parsed.jsonOutput) {
    deps.stdout(
      JSON.stringify(
        {
          route_id: result.routeId,
          selected_model: result.selectedModel,
          completion_result: result.row.completion_result,
          wall_clock_seconds: result.aider.wallClockSeconds,
          actual_cost_usd: result.actualCostUsd ?? null,
          cost_omitted_reason: result.costOmittedReason ?? null,
          fidelity_tier: result.fidelityTier ?? null,
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }
  deps.stdout(`${summaryLines.join('\n')}\n`);
}

async function readMessageFileFromDisk(path: string): Promise<string> {
  return await readFile(path, 'utf8');
}

/**
 * CLI entry point. Kept minimal so tests can call `runCli()` directly.
 */
async function main(): Promise<void> {
  const outcome = await runCli({
    argv: process.argv.slice(2),
    env: process.env,
    stdout: (line) => process.stdout.write(line),
    stderr: (line) => process.stderr.write(line),
  });
  process.exit(outcome.exitCode);
}

const invokedAsScript = (() => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  const scriptUrl = `file://${entry}`;
  return import.meta.url === scriptUrl;
})();

if (invokedAsScript) {
  void main();
}
