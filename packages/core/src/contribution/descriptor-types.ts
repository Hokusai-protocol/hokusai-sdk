/**
 * Hokusai task descriptor and model types used by contribution rows.
 *
 * Self-contained subset extracted from wavemill's hokusai-schema module.
 *
 * @module contribution/descriptor-types
 */

export const HOKUSAI_TASK_TYPES = [
  'bugfix',
  'feature',
  'refactor',
  'infra',
  'tests',
  'migration',
  'docs',
  'unknown',
] as const;

export const HOKUSAI_LANGUAGES = [
  'python',
  'typescript',
  'javascript',
  'go',
  'rust',
  'java',
  'bash',
  'multi',
  'unknown',
] as const;

export const HOKUSAI_DOMAINS = [
  'backend',
  'frontend',
  'fullstack',
  'devops',
  'data',
  'ml',
  'mobile',
  'unknown',
] as const;

export const HOKUSAI_REPO_SIZE_BUCKETS = [
  'small',
  'medium',
  'large',
  'xlarge',
] as const;
export const HOKUSAI_FILES_TOUCHED_BUCKETS = [
  '1',
  '2_5',
  '6_15',
  '16_plus',
] as const;
export const HOKUSAI_DESCRIPTION_LENGTH_BUCKETS = [
  'short',
  'medium',
  'long',
] as const;
export const HOKUSAI_RISK_LEVELS = ['low', 'medium', 'high'] as const;

export type HokusaiTaskType = (typeof HOKUSAI_TASK_TYPES)[number];
export type HokusaiLanguage = (typeof HOKUSAI_LANGUAGES)[number];
export type HokusaiDomain = (typeof HOKUSAI_DOMAINS)[number];
export type HokusaiRepoSizeBucket = (typeof HOKUSAI_REPO_SIZE_BUCKETS)[number];
export type HokusaiFilesTouchedBucket =
  (typeof HOKUSAI_FILES_TOUCHED_BUCKETS)[number];
export type HokusaiDescriptionLengthBucket =
  (typeof HOKUSAI_DESCRIPTION_LENGTH_BUCKETS)[number];
export type HokusaiRiskLevel = (typeof HOKUSAI_RISK_LEVELS)[number];

export interface HokusaiTaskDescriptor {
  task_type: HokusaiTaskType;
  language: HokusaiLanguage;
  domain: HokusaiDomain;
  complexity: number;
  repo_size_bucket: HokusaiRepoSizeBucket;
  files_touched_bucket: HokusaiFilesTouchedBucket;
  description_length_bucket: HokusaiDescriptionLengthBucket;
  is_greenfield: boolean;
  is_migration: boolean;
  requires_tests: boolean;
  cross_service: boolean;
  ui_heavy: boolean;
  risk_level: HokusaiRiskLevel;
}

export interface HokusaiAvailableModels {
  planner_models: string[];
  coder_models: string[];
  reviewer_models: string[];
}
