// Session-file capture: measure a task from a bundled, sanitized Claude Code
// session fixture. The boundary is explicit — task id, session ids, and a
// time window — because files are never picked for being "the newest". The
// window here names the fixture's recording time (the run happens later).
import { fileURLToPath } from 'node:url';
import { measureTask } from '@hokusai/costs';

const fixture = fileURLToPath(
  new URL('./fixtures/claude-code-session.jsonl', import.meta.url),
);

const { cost } = await measureTask(
  {
    taskId: 'task-offline-example',
    sessionFiles: {
      harness: 'claude-code',
      sessionIds: ['example-session-0001'],
      paths: [fixture],
      window: { startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T01:00:00Z' },
    },
  },
  () => 42,
);

if (!(cost.totalUsd > 0)) throw new Error('expected a priced total');
if (cost.coverage.status !== 'complete') throw new Error('expected complete coverage');
if (cost.source.sessionFileCount !== 1) throw new Error('expected one session file');
console.log(JSON.stringify(cost, null, 2));
