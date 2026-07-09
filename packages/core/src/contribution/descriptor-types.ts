/**
 * Hokusai task descriptor and model types used by contribution rows.
 *
 * Self-contained subset extracted from wavemill's hokusai-schema module.
 *
 * @module contribution/descriptor-types
 */

export type HokusaiTaskType =
  | 'bugfix'
  | 'feature'
  | 'refactor'
  | 'infra'
  | 'tests'
  | 'migration'
  | 'docs'
  | 'unknown';

export type HokusaiLanguage =
  | 'python'
  | 'typescript'
  | 'javascript'
  | 'go'
  | 'rust'
  | 'java'
  | 'bash'
  | 'multi'
  | 'unknown';

export type HokusaiDomain =
  | 'backend'
  | 'frontend'
  | 'fullstack'
  | 'devops'
  | 'data'
  | 'ml'
  | 'mobile'
  | 'unknown';

export type HokusaiRepoSizeBucket = 'small' | 'medium' | 'large' | 'xlarge';
export type HokusaiFilesTouchedBucket = '1' | '2_5' | '6_15' | '16_plus';
export type HokusaiDescriptionLengthBucket = 'short' | 'medium' | 'long';
export type HokusaiRiskLevel = 'low' | 'medium' | 'high';

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
