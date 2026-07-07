import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const adapterRoot = path.join(repoRoot, 'packages', 'adapter-claude-code');
const sourceFile = path.join(adapterRoot, 'dist-bundle', 'index.js');
const targetDir = path.join(adapterRoot, 'plugin', 'dist');
const targetFile = path.join(targetDir, 'index.js');

if (!existsSync(sourceFile)) {
  throw new Error(
    'missing packages/adapter-claude-code/dist-bundle/index.js; run pnpm --filter @hokusai/adapter-claude-code bundle:plugin first',
  );
}

mkdirSync(targetDir, { recursive: true });
copyFileSync(sourceFile, targetFile);

console.log(`Synced ${path.relative(repoRoot, targetFile)}`);
