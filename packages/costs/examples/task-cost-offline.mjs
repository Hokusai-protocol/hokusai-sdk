// Offline task-cost measurement, end to end: no network, no HOKUSAI_API_KEY.
// The fixture is a sanitized Claude Code session transcript (usage counters
// and identifiers only — no prompts, code, or account identity).
import { fileURLToPath } from 'node:url';
import { measureTask } from '@hokusai/costs';

const sessionFile = fileURLToPath(
  new URL('./fixtures/claude-code-session.jsonl', import.meta.url),
);

const { cost } = await measureTask(
  { taskId: 'example-task', harness: 'claude-code', sessionFile },
  async () => {
    // Your task runs here; usage is collected from the session file after it.
  },
);

console.log(JSON.stringify(cost, null, 2));
