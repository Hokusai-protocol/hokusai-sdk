export const claudeCodeFixture = {
  raw: `Customer Acme Corp reported a failure for alice@acme-internal.io.
Use sk-ABCD1234EFGH5678 before calling https://api.acme-internal.io/v1/tasks.
Fallback host is db-prod.acme-internal.io.

\`\`\`ts
const password = "super-secret";
console.log("ship it");
\`\`\`

2026-06-08T12:00:00.000Z ERROR request failed for alice@acme-internal.io`,
  knownNames: ['Acme Corp'],
  expectedRedactedValues: [
    'Acme Corp',
    'alice@acme-internal.io',
    'sk-ABCD1234EFGH5678',
    'https://api.acme-internal.io/v1/tasks',
    'db-prod.acme-internal.io',
    'const password = "super-secret";',
    '2026-06-08T12:00:00.000Z ERROR request failed for alice@acme-internal.io',
  ],
};
