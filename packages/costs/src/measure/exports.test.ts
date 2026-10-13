/**
 * REQ-F1: the drop-in API resolves from the package root exactly as the
 * README's quickstart imports it.
 */

import { describe, expect, it } from 'vitest';
import {
  MEASURE_DIAGNOSTIC_CODES,
  MeasureError,
  createTaskCostTracker,
  measureTask,
} from '../index.js';

describe('package root exports', () => {
  it('exposes the drop-in measurement API', () => {
    expect(typeof measureTask).toBe('function');
    expect(typeof createTaskCostTracker).toBe('function');
    expect(Array.isArray(MEASURE_DIAGNOSTIC_CODES)).toBe(true);
    expect(new MeasureError('INVALID_ARGUMENT', 'x').code).toBe(
      'INVALID_ARGUMENT',
    );
  });

  it('keeps the existing engine/ledger surface unchanged', async () => {
    const existing = await import('../index.js');
    expect(typeof existing.createTaskCostEngine).toBe('function');
    expect(typeof existing.openTaskCostLedger).toBe('function');
    expect(typeof existing.resolveEventPrice).toBe('function');
  });
});
