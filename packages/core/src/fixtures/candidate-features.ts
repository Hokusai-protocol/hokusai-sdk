import {
  finalizeCandidateFeaturesV1,
  type CandidateFeaturesV1,
} from '../candidate-features.js';

/** Representative fully populated candidate vector for consumer contract tests. */
export const completeCandidateFeaturesV1Fixture: CandidateFeaturesV1 =
  finalizeCandidateFeaturesV1({
    files_touched: 4,
    lines_added: 80,
    lines_deleted: 12,
    loc_touched: 92,
    dependency_depth: 2,
    module_hotspot_score: 37.5,
    diff_uncertain: false,
    type_errors: 0,
    lint_errors: 0,
    build_ok: true,
    complexity_delta: -1.25,
    tests_changed: true,
    test_pass_rate: 1,
    test_runtime_seconds: 12.4,
    task_type: 'feature',
    language: 'typescript',
    domain: 'backend',
    complexity: 5,
    repo_size_bucket: 'medium',
    files_touched_bucket: '2_5',
    description_length_bucket: 'medium',
    is_greenfield: false,
    is_migration: false,
    requires_tests: true,
    cross_service: false,
    ui_heavy: false,
    risk_level: 'medium',
    touched_out_of_scope_files: 0,
    human_intervention_count: 0,
    review_rounds: 1,
    change_requests: 0,
    self_review_iterations: 1,
    agent_iterations: 3,
  });

/** Sparse vector proving every unavailable signal is represented explicitly. */
export const sparseCandidateFeaturesV1Fixture: CandidateFeaturesV1 =
  finalizeCandidateFeaturesV1({
    files_touched: 1,
    lines_added: 0,
    lines_deleted: 0,
    loc_touched: 0,
    diff_uncertain: true,
  });

/** Vector proving known zero and false values are not rewritten to null. */
export const observedZeroCandidateFeaturesV1Fixture: CandidateFeaturesV1 =
  finalizeCandidateFeaturesV1({
    files_touched: 0,
    lines_added: 0,
    lines_deleted: 0,
    loc_touched: 0,
    diff_uncertain: false,
    type_errors: 0,
    lint_errors: 0,
    build_ok: false,
    complexity_delta: 0,
    tests_changed: false,
    test_pass_rate: 0,
    test_runtime_seconds: 0,
    touched_out_of_scope_files: 0,
    human_intervention_count: 0,
    review_rounds: 0,
    change_requests: 0,
    self_review_iterations: 0,
    agent_iterations: 0,
  });
