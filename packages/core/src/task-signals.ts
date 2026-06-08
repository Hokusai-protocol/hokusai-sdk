import type {
  ReasoningDepth,
  RepositoryScale,
  TaskFamily,
} from './task-packet.js';

export interface TaskFamilyClassificationInput {
  text: string;
  hints?: string[];
}

export interface ReasoningDepthInferenceInput {
  text: string;
  reasoningDepth?: ReasoningDepth;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  c: 'C',
  cc: 'C++',
  cpp: 'C++',
  cs: 'C#',
  css: 'CSS',
  go: 'Go',
  h: 'C/C++ Headers',
  hpp: 'C/C++ Headers',
  html: 'HTML',
  java: 'Java',
  js: 'JavaScript',
  jsx: 'JavaScript',
  kt: 'Kotlin',
  kts: 'Kotlin',
  md: 'Markdown',
  mjs: 'JavaScript',
  php: 'PHP',
  py: 'Python',
  rb: 'Ruby',
  rs: 'Rust',
  sh: 'Shell',
  sql: 'SQL',
  swift: 'Swift',
  ts: 'TypeScript',
  tsx: 'TypeScript',
  yaml: 'YAML',
  yml: 'YAML',
};

const FAMILY_KEYWORDS: Array<{
  family: Exclude<TaskFamily, 'bugfix' | 'mixed' | 'chore' | 'investigation'> | 'bug';
  patterns: RegExp[];
}> = [
  {
    family: 'migration',
    patterns: [/\bmigrat(?:e|ion|ing)\b/i, /\balembic\b/i, /\bbackfill\b/i],
  },
  {
    family: 'infra',
    patterns: [/\binfra(?:structure)?\b/i, /\bci\b/i, /\bdeploy(?:ment)?\b/i, /\bterraform\b/i],
  },
  {
    family: 'docs',
    patterns: [/\bdocs?\b/i, /\breadme\b/i, /\bdocumentation\b/i],
  },
  {
    family: 'test',
    patterns: [/\btests?\b/i, /\bvitest\b/i, /\bjest\b/i, /\bcypress\b/i],
  },
  {
    family: 'refactor',
    patterns: [/\brefactor\b/i, /\brename\b/i, /\brestructure\b/i, /\bcleanup\b/i],
  },
  {
    family: 'feature',
    patterns: [/\bfeature\b/i, /\bimplement\b/i, /\badd support\b/i, /\bsupport\b/i, /\benable\b/i],
  },
  {
    family: 'bug',
    patterns: [
      /\bbug\b/i,
      /\bregression\b/i,
      /\bbroken\b/i,
      /\bfailing\b/i,
      /\bfix(?:e[sd])?\b.{0,24}\b(?:bug|regression|failure|crash|timeout)\b/i,
    ],
  },
];

const INVESTIGATION_PATTERNS = [/\binvestigat(?:e|ion)\b/i, /\banaly[sz]e\b/i, /\bdebug\b/i];
const DEEP_REASONING_PATTERNS = [
  /\binvestigat(?:e|ion)\b/i,
  /\banaly[sz]e\b/i,
  /\bdeep(?:ly)?\b/i,
  /\broot cause\b/i,
  /\bcompare\b/i,
];

function normalizeText(text: string): string {
  return text.trim().toLowerCase();
}

export function classifyTaskFamily(input: TaskFamilyClassificationInput): TaskFamily {
  const haystack = [input.text, ...(input.hints ?? [])].join('\n');
  const matches = new Set<TaskFamily>();

  for (const entry of FAMILY_KEYWORDS) {
    if (entry.patterns.some((pattern) => pattern.test(haystack))) {
      matches.add(entry.family === 'bug' ? 'bugfix' : entry.family);
    }
  }

  if (matches.size > 1) {
    return 'mixed';
  }

  if (matches.size === 1) {
    return [...matches][0] as TaskFamily;
  }

  if (INVESTIGATION_PATTERNS.some((pattern) => pattern.test(haystack))) {
    return 'investigation';
  }

  return 'chore';
}

export function inferReasoningDepth(
  input: ReasoningDepthInferenceInput,
): ReasoningDepth {
  if (input.reasoningDepth) {
    return input.reasoningDepth;
  }

  const normalized = normalizeText(input.text);

  if (normalized.length > 0 && normalized.length < 40) {
    return 'shallow';
  }

  if (DEEP_REASONING_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'deep';
  }

  return 'standard';
}

export function bucketRepositoryScale(
  fileCount?: number,
): RepositoryScale | undefined {
  if (typeof fileCount !== 'number' || !Number.isFinite(fileCount) || fileCount < 0) {
    return undefined;
  }

  if (fileCount < 100) {
    return 'small';
  }

  if (fileCount < 1000) {
    return 'medium';
  }

  if (fileCount < 10000) {
    return 'large';
  }

  return 'xlarge';
}

export function summarizeLanguageSignals(
  extensionCounts: Record<string, number>,
): string[] {
  const languages = new Set<string>();

  for (const [extension, count] of Object.entries(extensionCounts)) {
    if (typeof count !== 'number' || count <= 0) {
      continue;
    }

    const normalized = extension.replace(/^\./, '').toLowerCase();
    const language = LANGUAGE_BY_EXTENSION[normalized];

    if (language) {
      languages.add(language);
    }
  }

  return [...languages].sort((left, right) => left.localeCompare(right));
}

export function summarizeFrameworkSignals(
  dependencyCategories: string[],
): string[] {
  return [...new Set(dependencyCategories.map((entry) => entry.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}
