export {
  AIDER_INSTALL_MESSAGE,
  AiderBinaryNotFoundError,
  buildAiderArgs,
  runAiderProcess,
  type AiderProcessResult,
  type RunAiderProcessOptions,
} from './aider-runner.js';
export {
  createAiderHostAdapter,
  type AiderHostAdapterOptions,
  type AiderProcessRunner,
} from './aider-adapter.js';
export {
  parseAiderOutput,
  type AiderUsageTelemetry,
} from './aider-output-parser.js';
export {
  CLI_EXIT_CODES,
  runAider,
  runCli,
  type CliExitCode,
  type RunAiderOptions,
  type RunAiderResult,
  type RunCliOptions,
} from './cli.js';
