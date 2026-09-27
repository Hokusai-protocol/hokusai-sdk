/**
 * @hokusai/scan shadow mode (HOK-2820).
 */

export { ShadowError } from './errors.js';
export { BASELINE_V0, BASELINE_V0_WEIGHTS, NULL_STATIC_FEATURES, type ShadowScorer } from './scorer.js';
export { discoverMerges, isAncestor, type DiscoveredMerge, type DiscoverMergesResult } from './discover.js';
export { ensureWritableDataDir, readJsonl, appendJsonl, readState, writeState, writeReport, type JsonlResult } from './store.js';
export { runShadowScore, type RunShadowScoreOptions, type RunShadowScoreResult } from './score.js';
export { runShadowBackfill, type RunShadowBackfillOptions, type RunShadowBackfillResult } from './backfill.js';
export { runShadowReport, computeShadowReport, type RunShadowReportOptions, type ShadowReport, type ReportMetrics } from './report.js';
export { runShadowCli, type ShadowCliIO } from './cli.js';
