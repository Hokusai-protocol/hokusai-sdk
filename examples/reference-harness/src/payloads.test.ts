import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HARNESS_OUTCOME_ROW_SCHEMA_VERSION,
  TASK_PACKET_SCHEMA_VERSION,
  isHarnessOutcomeRowV1,
  validateContributionRow,
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

  it('validates the contribution row example against the core schema', async () => {
    const row = await readJsonFixture('contribution-row.example.json');

    expect(isHarnessOutcomeRowV1(row)).toBe(true);
    expect(() => validateContributionRow(row)).not.toThrow();
    expect((row as { schema_version?: string }).schema_version).toBe(
      HARNESS_OUTCOME_ROW_SCHEMA_VERSION,
    );
  });

  it('publishes a row carrying the fields training eligibility requires', async () => {
    const row = (await readJsonFixture('contribution-row.example.json')) as Record<
      string,
      unknown
    >;

    expect(row.inference_log_id).toBeTypeOf('string');
    expect(row.budget_usd).toBeTypeOf('number');
    expect(row.actual_cost_usd).toBeTypeOf('number');
    expect(row.task_descriptor).not.toEqual({});
    expect(row.allowed_models).not.toEqual([]);
  });

  it('contains only fake data patterns that are safe to publish', async () => {
    const [taskPacket, contributionRow] = await Promise.all([
      readJsonFixture('task-packet.example.json'),
      readJsonFixture('contribution-row.example.json'),
    ]);
    const serialized = JSON.stringify({ taskPacket, contributionRow });

    for (const pattern of suspiciousPatterns) {
      expect(serialized).not.toMatch(pattern);
    }
  });
});
