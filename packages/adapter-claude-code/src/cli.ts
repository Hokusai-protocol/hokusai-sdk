import {
  CLI_EXIT_CODES,
  createRunCli,
  type CliExitCode,
  type CliRunResult,
} from '@hokusai/core';
import {
  claudeCodeHarnessProfile,
  type RouteInput,
} from './profile.js';
import { declineRecommendation, routeTask } from './commands.js';

export { CLI_EXIT_CODES };
export type { CliExitCode, CliRunResult };

export const runCli = createRunCli(claudeCodeHarnessProfile, {
  routeTask,
  declineRecommendation,
  buildRouteInput(taskText: string): RouteInput {
    return { taskText };
  },
});
