import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  TASK_PACKET_SCHEMA_VERSION,
  OUTCOME_REPORT_SCHEMA_VERSION,
  validateOutcomeReport,
  validateTaskPacket,
} from '@hokusai/core';

const fixtureDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'examples',
);

const suspiciousPatterns = [
  /\bsk-[A-Za-z0-9]+\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bghp_[A-Za-z0-9]{20,}\b/u,
  /\bhttps?:\/\/(?!api\.example\.com\b)[a-z0-9.-]+\.[a-z]{2,}\b/iu,
  /\b(?!example\.com\b)[a-z0-9.-]+\.(com|net|org|io|dev|app|ai)\b/iu,
] as const;

async function readJsonFixture(name: string): Promise<unknown> {
  const filePath = resolve(fixtureDir, name);
  const contents = await readFile(filePath, 'utf8');
  return JSON.parse(contents) as unknown;
}

describe('published example payloads', () => {
  it('validates the task packet example against the core schema', async () => {
    const taskPacket = await readJsonFixture('task-packet.example.json');
    const result = validateTaskPacket(taskPacket);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      expect(result.errors).toEqual([]);
      return;
    }

    expect(result.packet.schemaVersion).toBe(TASK_PACKET_SCHEMA_VERSION);
  });

  it('validates the outcome report example against the core schema', async () => {
    const outcomeReport = await readJsonFixture('outcome-report.example.json');
    const errors = validateOutcomeReport(outcomeReport);

    expect(errors).toEqual([]);
    if (errors.length > 0) {
      return;
    }

    expect((outcomeReport as { schemaVersion?: string }).schemaVersion).toBe(
      OUTCOME_REPORT_SCHEMA_VERSION,
    );
  });

  it('contains only fake data patterns that are safe to publish', async () => {
    const [taskPacket, outcomeReport] = await Promise.all([
      readJsonFixture('task-packet.example.json'),
      readJsonFixture('outcome-report.example.json'),
    ]);
    const serialized = JSON.stringify({ taskPacket, outcomeReport });

    for (const pattern of suspiciousPatterns) {
      expect(serialized).not.toMatch(pattern);
    }
  });
});
