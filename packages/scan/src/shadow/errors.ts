/**
 * Shadow mode error class.
 */

import type { ArbiterShadowErrorCode } from '@hokusai/core';

export class ShadowError extends Error {
  readonly code: ArbiterShadowErrorCode;

  constructor(code: ArbiterShadowErrorCode, message?: string) {
    super(message || code);
    this.name = 'ShadowError';
    this.code = code;
  }
}
