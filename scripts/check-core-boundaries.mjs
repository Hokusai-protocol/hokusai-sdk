import path from 'node:path';
import { checkCoreBoundaries } from './core-boundaries.mjs';

const violations = await checkCoreBoundaries();

if (violations.length > 0) {
  console.error('Core boundary check failed.');
  for (const violation of violations) {
    console.error(
      `- ${path.relative(process.cwd(), violation.filePath)}: ${violation.specifier} (${violation.message})`,
    );
  }
  process.exitCode = 1;
} else {
  console.log('Core boundary check passed.');
}
