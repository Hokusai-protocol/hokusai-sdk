import type { LatestRoutingDecision } from './types.js';

const COMPLETION_TERMS = [
  'task completed',
  'task succeeded',
  'completed successfully',
  'successfully completed',
  'tests passed',
  'test passed',
  'all tests passed',
  'pr merged',
  'pull request merged',
  'merged pull request',
  'issue closed',
  'closed issue',
];

export type OutcomeCompletionSignal =
  | 'task_completed'
  | 'tests_passed'
  | 'pr_merged'
  | 'issue_closed';

export interface OutcomePromptDetection {
  shouldPrompt: boolean;
  signals: OutcomeCompletionSignal[];
}

export interface BuildOutcomeContributionPromptInput {
  event?: unknown;
  latestRoute?: LatestRoutingDecision;
  outcomeOptIn: boolean;
  reportCommand: string;
  actualModel?: string;
}

export interface OutcomeContributionPrompt {
  shouldPrompt: boolean;
  status:
    | 'ready'
    | 'no_completion_signal'
    | 'no_route'
    | 'needs_outcome_opt_in'
    | 'missing_model';
  message: string;
  signals: OutcomeCompletionSignal[];
  reportArgs?: string[];
  reportCommand?: string;
  remediation?: string;
}

export function detectOutcomeCompletionSignal(
  event: unknown,
): OutcomePromptDetection {
  const signals = new Set<OutcomeCompletionSignal>();

  collectCompletionSignals(event, signals);

  return {
    shouldPrompt: signals.size > 0,
    signals: [...signals],
  };
}

export function buildOutcomeContributionPrompt(
  input: BuildOutcomeContributionPromptInput,
): OutcomeContributionPrompt {
  const detection = detectOutcomeCompletionSignal(input.event);
  if (!detection.shouldPrompt) {
    return {
      shouldPrompt: false,
      status: 'no_completion_signal',
      message: 'No successful completion signal detected.',
      signals: [],
    };
  }

  if (!input.latestRoute) {
    return {
      shouldPrompt: false,
      status: 'no_route',
      message:
        'Looks like this task succeeded, but no Hokusai route was found to attach the outcome to.',
      signals: detection.signals,
      remediation: 'Route a task with Hokusai before contributing an outcome.',
    };
  }

  if (!input.outcomeOptIn) {
    return {
      shouldPrompt: true,
      status: 'needs_outcome_opt_in',
      message:
        'Looks like this task succeeded - enable HOKUSAI_OUTCOME_OPT_IN=true before contributing this outcome.',
      signals: detection.signals,
      remediation:
        'Set HOKUSAI_OUTCOME_OPT_IN=true, then rerun the Hokusai report command.',
    };
  }

  const actualModel = input.actualModel ?? input.latestRoute.recommendedModelId;
  if (!actualModel) {
    return {
      shouldPrompt: true,
      status: 'missing_model',
      message:
        'Looks like this task succeeded - contribute this outcome after supplying the actual model used.',
      signals: detection.signals,
      remediation:
        'Run the report command with --actual-model set to the model that completed the task.',
    };
  }

  const reportArgs = [
    '--use-latest',
    '--recommended-model',
    input.latestRoute.recommendedModelId ?? actualModel,
    '--actual-model',
    actualModel,
    '--accepted',
    '--status',
    'succeeded',
    '--latency-bucket',
    'medium',
    '--cost-bucket',
    'medium',
    '--token-bucket',
    'medium',
  ];

  if (detection.signals.includes('tests_passed')) {
    reportArgs.push('--test-status', 'passed');
  }

  return {
    shouldPrompt: true,
    status: 'ready',
    message:
      'Looks like this task succeeded - contribute this outcome to improve routing?',
    signals: detection.signals,
    reportArgs,
    reportCommand: `${input.reportCommand} ${quoteArgs(reportArgs)}`,
  };
}

function collectCompletionSignals(
  value: unknown,
  signals: Set<OutcomeCompletionSignal>,
): void {
  if (value === null || value === undefined) {
    return;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    collectStringSignals(String(value), signals);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectCompletionSignals(entry, signals));
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  const record = value as Record<string, unknown>;
  collectStructuredSignals(record, signals);
  Object.values(record).forEach((entry) =>
    collectCompletionSignals(entry, signals),
  );
}

function collectStructuredSignals(
  record: Record<string, unknown>,
  signals: Set<OutcomeCompletionSignal>,
): void {
  const status = normalizeTerm(
    record.status ?? record.conclusion ?? record.result,
  );
  if (['success', 'succeeded', 'completed', 'passed'].includes(status)) {
    signals.add(status === 'passed' ? 'tests_passed' : 'task_completed');
  }

  if (status === 'merged') {
    signals.add('pr_merged');
  }

  if (status === 'closed') {
    signals.add('issue_closed');
  }

  if (record.merged === true) {
    signals.add('pr_merged');
  }
}

function collectStringSignals(
  value: string,
  signals: Set<OutcomeCompletionSignal>,
): void {
  const normalized = normalizeTerm(value);
  if (!COMPLETION_TERMS.some((term) => normalized.includes(term))) {
    return;
  }

  if (normalized.includes('test') && normalized.includes('passed')) {
    signals.add('tests_passed');
  }
  if (
    normalized.includes('pr merged') ||
    normalized.includes('pull request merged')
  ) {
    signals.add('pr_merged');
  }
  if (
    normalized.includes('issue closed') ||
    normalized.includes('closed issue')
  ) {
    signals.add('issue_closed');
  }
  if (
    normalized.includes('task completed') ||
    normalized.includes('task succeeded') ||
    normalized.includes('completed successfully') ||
    normalized.includes('successfully completed')
  ) {
    signals.add('task_completed');
  }
}

function normalizeTerm(value: unknown): string {
  return String(value)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function quoteArgs(args: string[]): string {
  return args
    .map((arg) => (arg.includes(' ') ? JSON.stringify(arg) : arg))
    .join(' ');
}
