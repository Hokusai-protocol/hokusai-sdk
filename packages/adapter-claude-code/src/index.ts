import type {
  HarnessAdapter,
  HarnessContext,
  HokusaiClient,
  HokusaiTaskInput,
  RepositoryScale,
  TaskFamily,
  TaskPacket,
} from '@hokusai/core';
import {
  DEFAULT_REDACTION_CONFIG,
  TaskPacketBuildError,
  anonymizeTaskPacket,
  buildTaskPacket as buildCoreTaskPacket,
  type RedactionCategory,
  type RedactionConfig,
  type RedactionRecord,
} from '@hokusai/core';

// ─── Task-packet builder types ───────────────────────────────────────────────

export interface ClaudeCodeFileSummary {
  /** File extension including the leading dot, e.g. '.ts' or '.py'. */
  extension: string;
  /** Number of files with this extension in the repository snapshot. */
  count: number;
}

export interface ClaudeCodeConstraintsInput {
  latencyPreference?: 'low' | 'standard';
  costPreference?: 'low' | 'standard';
  reasoningDepth?: 'shallow' | 'standard' | 'deep';
  tools?: string[];
  modelConstraints?: string[];
  providerConstraints?: string[];
}

export interface ClaudeCodeTaskInput {
  userIntent: string;
  /** Coarse file-extension counts; never raw file paths. */
  files?: ClaudeCodeFileSummary[];
  /** Manifest filenames or known dependency names for framework detection. */
  deps?: string[];
  constraints?: ClaudeCodeConstraintsInput;
}

export interface ClaudeCodeBuilderOptions {
  /**
   * Redaction configuration. Defaults to DEFAULT_REDACTION_CONFIG.
   * Supply a custom salt in production — the default salt is public.
   */
  redaction?: RedactionConfig;
}

export interface ClaudeCodeTaskPacketPreview {
  packet: TaskPacket;
  redactionSummary: Array<{ category: RedactionCategory; count: number }>;
  /** Deterministic JSON representation of the packet (keys sorted). */
  json: string;
}

// ─── Extension → language map ────────────────────────────────────────────────

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.pyw': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.swift': 'Swift',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.cs': 'C#',
  '.cpp': 'C++',
  '.cxx': 'C++',
  '.cc': 'C++',
  '.c': 'C',
  '.h': 'C/C++',
  '.hpp': 'C++',
  '.scala': 'Scala',
  '.ex': 'Elixir',
  '.exs': 'Elixir',
  '.clj': 'Clojure',
  '.hs': 'Haskell',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.lua': 'Lua',
  '.r': 'R',
  '.dart': 'Dart',
  '.tf': 'Terraform (HCL)',
  '.sql': 'SQL',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.css': 'CSS',
  '.scss': 'CSS',
  '.sass': 'CSS',
};

// Manifest filenames and common dep names → framework label
const DEP_FRAMEWORK_MAP: Record<string, string> = {
  'package.json': 'Node.js',
  'Cargo.toml': 'Rust/Cargo',
  'go.mod': 'Go modules',
  'requirements.txt': 'Python/pip',
  'pyproject.toml': 'Python',
  'setup.py': 'Python',
  'Pipfile': 'Python/pipenv',
  'build.gradle': 'Java/Gradle',
  'pom.xml': 'Java/Maven',
  'build.gradle.kts': 'Kotlin/Gradle',
  Gemfile: 'Ruby/Bundler',
  'composer.json': 'PHP/Composer',
  Dockerfile: 'Docker',
  'docker-compose.yml': 'Docker',
  'docker-compose.yaml': 'Docker',
  'main.tf': 'Terraform',
  'next.config.js': 'Next.js',
  'next.config.ts': 'Next.js',
  'next.config.mjs': 'Next.js',
  'vite.config.ts': 'Vite',
  'vite.config.js': 'Vite',
  'nuxt.config.ts': 'Nuxt.js',
  'angular.json': 'Angular',
  'svelte.config.js': 'Svelte',
  'remix.config.js': 'Remix',
  'astro.config.mjs': 'Astro',
  react: 'React',
  vue: 'Vue',
  angular: 'Angular',
  svelte: 'Svelte',
  express: 'Express',
  fastapi: 'FastAPI',
  django: 'Django',
  flask: 'Flask',
  rails: 'Rails',
  laravel: 'Laravel',
  spring: 'Spring',
};

// ─── Heuristics ──────────────────────────────────────────────────────────────

const FAMILY_RULES: Array<{ family: TaskFamily; pattern: RegExp }> = [
  {
    family: 'migration',
    pattern: /\b(migrat\w*|schema\s+change|alembic|database\s+migration)\b/i,
  },
  {
    family: 'infra',
    pattern: /\b(infra\w*|docker|ci\/cd|terraform|deploy\w*|kubernetes|k8s|devops)\b/i,
  },
  {
    family: 'bug',
    pattern: /\b(fix\w*|crash\w*|error\w*|\bbug\b|regression\w*|null\s+pointer|hotfix\w*)\b/i,
  },
  {
    family: 'feature',
    pattern: /\b(add\s+\w|new\s+\w|feature\w*|implement\w*|support\w*|build\s+\w|create\s+\w)\b/i,
  },
  {
    family: 'refactor',
    pattern: /\b(refactor\w*|clean\s*up\w*|restructure\w*|extract\w*|rewrite\w*)\b/i,
  },
  {
    family: 'test',
    pattern: /\b(test\w*|coverage\w*|flaky\w*|spec\w*|e2e\w*)\b/i,
  },
  {
    family: 'docs',
    pattern: /\b(doc\w*|readme\w*|comment\w*|changelog\w*|jsdoc\w*)\b/i,
  },
];

export function classifyTaskFamily(intent: string): TaskFamily {
  const matched = new Set<TaskFamily>();
  for (const { family, pattern } of FAMILY_RULES) {
    if (pattern.test(intent)) {
      matched.add(family);
    }
  }
  if (matched.size === 1) {
    const [family] = matched;
    return family!;
  }
  return 'mixed';
}

export function bucketRepositoryScale(fileCount: number): RepositoryScale {
  if (fileCount < 50) return 'small';
  if (fileCount < 500) return 'medium';
  if (fileCount < 5000) return 'large';
  return 'xlarge';
}

export function deriveLanguageSignals(files: ClaudeCodeFileSummary[]): string[] {
  const seen = new Set<string>();
  for (const { extension } of files) {
    const language = EXTENSION_LANGUAGE_MAP[extension.toLowerCase()];
    if (language !== undefined) {
      seen.add(language);
    }
  }
  return [...seen].sort();
}

export function deriveFrameworkSignals(deps: string[]): string[] {
  const seen = new Set<string>();
  for (const dep of deps) {
    const framework = DEP_FRAMEWORK_MAP[dep];
    if (framework !== undefined) {
      seen.add(framework);
    }
  }
  return [...seen].sort();
}

// ─── Internal compose ────────────────────────────────────────────────────────

interface ComposeResult {
  packet: TaskPacket;
  redactions: RedactionRecord[];
  raw: TaskPacket;
}

function aggregateRedactions(
  redactions: RedactionRecord[],
): Array<{ category: RedactionCategory; count: number }> {
  const counts = new Map<RedactionCategory, number>();
  for (const { category, count } of redactions) {
    counts.set(category, (counts.get(category) ?? 0) + count);
  }
  return [...counts.entries()].map(([category, count]) => ({ category, count }));
}

function sortedJsonStringify(value: unknown): string {
  function sortKeys(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, sortKeys(val)]),
      );
    }
    return v;
  }
  return JSON.stringify(sortKeys(value), null, 2);
}

function composeAnonymizedPacket(
  input: ClaudeCodeTaskInput,
  options: ClaudeCodeBuilderOptions,
): ComposeResult {
  const taskFamily = classifyTaskFamily(input.userIntent);
  const reasoningDepth = input.constraints?.reasoningDepth ?? 'standard';

  const totalFiles = input.files?.reduce((sum, f) => sum + f.count, 0) ?? 0;
  const repositoryScale =
    input.files !== undefined && input.files.length > 0
      ? bucketRepositoryScale(totalFiles)
      : undefined;

  const languageSignals =
    input.files !== undefined ? deriveLanguageSignals(input.files) : undefined;
  const frameworkSignals =
    input.deps !== undefined ? deriveFrameworkSignals(input.deps) : undefined;

  const constraintTags: string[] = [];
  if (input.constraints?.latencyPreference === 'low') constraintTags.push('latency:low');
  if (input.constraints?.costPreference === 'low') constraintTags.push('cost:low');

  const tools = input.constraints?.tools;
  const dedupedTools = tools && tools.length > 0 ? [...new Set(tools)].sort() : undefined;

  const context: HarnessContext = {
    userIntent: input.userIntent,
    taskFamily,
    reasoningDepth,
  };

  if (repositoryScale !== undefined) context.repositoryScale = repositoryScale;
  if (languageSignals && languageSignals.length > 0) context.languageSignals = languageSignals;
  if (frameworkSignals && frameworkSignals.length > 0) context.frameworkSignals = frameworkSignals;
  if (constraintTags.length > 0) context.constraints = constraintTags;
  if (dedupedTools) context.availableTools = dedupedTools;

  const modelConstraints = input.constraints?.modelConstraints;
  if (modelConstraints && modelConstraints.length > 0) {
    context.modelConstraints = modelConstraints;
  }
  const providerConstraints = input.constraints?.providerConstraints;
  if (providerConstraints && providerConstraints.length > 0) {
    context.providerConstraints = providerConstraints;
  }

  const raw = buildCoreTaskPacket(context);

  const config = options.redaction ?? DEFAULT_REDACTION_CONFIG;
  const { packet, redactions } = anonymizeTaskPacket(raw, config);

  return { packet, redactions, raw };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build an anonymized TaskPacket from a Claude Code task description.
 * This is the payload-ready form — suitable for submission to Hokusai.
 */
export function buildTaskPacket(
  input: ClaudeCodeTaskInput,
  options: ClaudeCodeBuilderOptions = {},
): TaskPacket {
  if (input == null || typeof input !== 'object') {
    throw new TaskPacketBuildError('ClaudeCodeTaskInput must be a non-null object.', [
      { path: '', message: 'ClaudeCodeTaskInput must be a non-null object.' },
    ]);
  }
  return composeAnonymizedPacket(input, options).packet;
}

/**
 * Preview what would be sent to Hokusai without making any network calls.
 * The returned `packet` is byte-identical to what `buildTaskPacket` would return
 * with the same input and options.
 */
export function previewTaskPacket(
  input: ClaudeCodeTaskInput,
  options: ClaudeCodeBuilderOptions = {},
): ClaudeCodeTaskPacketPreview {
  const { packet, redactions } = composeAnonymizedPacket(input, options);
  return {
    packet,
    redactionSummary: aggregateRedactions(redactions),
    json: sortedJsonStringify(packet),
  };
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export interface ClaudeCodeAdapterOptions {
  apiClient?: HokusaiClient;
  modelId: string;
  packageVersion: string;
}

export interface ClaudeCodeAdapter {
  apiClient?: HokusaiClient;
  harness: 'claude-code';
  commands: Array<{
    name: 'hokusai.run';
    description: string;
  }>;
  manifest: {
    entrypoint: 'hokusai';
    modelId: string;
    version: string;
  };
  toTaskReference(task: HokusaiTaskInput): string;
}

export function createClaudeCodeAdapter(
  options: ClaudeCodeAdapterOptions,
): ClaudeCodeAdapter {
  return {
    ...(options.apiClient ? { apiClient: options.apiClient } : {}),
    harness: 'claude-code',
    commands: [
      {
        name: 'hokusai.run',
        description: 'Dispatch a Hokusai task from Claude Code.',
      },
    ],
    manifest: {
      entrypoint: 'hokusai',
      modelId: options.modelId,
      version: options.packageVersion,
    },
    toTaskReference(task) {
      return `claude-code:${task.id}`;
    },
  };
}

void ({
  context: {
    collectTaskContext() {
      return Promise.resolve({
        ok: true,
        value: {
          task: {
            id: 'task-1',
            prompt: 'Claude Code task',
          },
          harness: {
            name: 'claude-code',
          },
        },
      });
    },
  },
  models: {
    discoverModels(request) {
      void request;
      return Promise.resolve({
        ok: true,
        value: [
          {
            id: 'claude-sonnet-4',
            label: 'Claude Sonnet 4',
          },
        ],
      });
    },
    mapModel(request) {
      void request;
      return Promise.resolve({
        ok: true,
        value: {
          id: 'claude-sonnet-4',
          provider: 'anthropic',
          capabilities: ['reasoning', 'tool-use'],
        },
      });
    },
  },
  recommendations: {
    displayRecommendation() {
      return {
        ok: true,
        value: undefined,
      };
    },
  },
  outcomes: {
    collectOutcome(request) {
      void request;
      return Promise.resolve({
        ok: true,
        value: {
          taskId: 'task-1',
          status: 'accepted',
          summary: 'Accepted by Claude Code',
        },
      });
    },
  },
  payloads: {
    previewPayload(request) {
      return {
        ok: true,
        value: {
          summary: `Preview ${request.payload.task.id}`,
          promptPreview: request.payload.prompt,
          redactionCount: request.payload.redactions.length,
        },
      };
    },
  },
  consent: {
    promptConsent(request) {
      return Promise.resolve({
        ok: true,
        value: {
          outcome: 'granted',
          scope: request.scope,
        },
      });
    },
  },
  storage: {
    get(key) {
      void key;
      return Promise.resolve({
        ok: true,
        value: undefined,
      });
    },
    set(key, value) {
      void key;
      void value;
      return Promise.resolve({
        ok: true,
        value: undefined,
      });
    },
    delete(key) {
      void key;
      return Promise.resolve({
        ok: true,
        value: undefined,
      });
    },
  },
} satisfies HarnessAdapter);
