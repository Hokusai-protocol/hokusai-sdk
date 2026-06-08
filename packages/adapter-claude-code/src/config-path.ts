import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CLAUDE_CODE_STATE_FILE = 'state.json';

export interface ClaudeCodeConfigPath {
  dir: string;
  exists: boolean;
}

export function resolveClaudeCodeConfigPath(options?: {
  override?: string;
}): ClaudeCodeConfigPath {
  const dir =
    options?.override?.trim() ||
    process.env.HOKUSAI_CONFIG_DIR?.trim() ||
    path.join(os.homedir(), '.claude', 'hokusai');

  return {
    dir,
    exists: existsSync(dir),
  };
}

export function getClaudeCodeStateFilePath(configDir: string): string {
  return path.join(configDir, CLAUDE_CODE_STATE_FILE);
}
