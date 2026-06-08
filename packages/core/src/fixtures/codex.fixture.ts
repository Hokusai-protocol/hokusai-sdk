export const codexFixture = {
  raw: `OpenAI Codex asked to inspect worker codex-worker-01.internal with AKIA1234567890ABCDEF.
Model reference gpt-5-codex is fine, but email ops@openai-codex.internal and URL https://codex-worker-01.internal/tasks/42 should not be sent.

\`\`\`tsx
export async function run() {
  return fetch("https://codex-worker-01.internal/tasks/42");
}
\`\`\`

INFO retrying deployment for OpenAI Codex`,
  knownNames: ['OpenAI Codex'],
  expectedRedactedValues: [
    'OpenAI Codex',
    'codex-worker-01.internal',
    'AKIA1234567890ABCDEF',
    'ops@openai-codex.internal',
    'https://codex-worker-01.internal/tasks/42',
    'export async function run() {',
    'INFO retrying deployment for OpenAI Codex',
  ],
};
