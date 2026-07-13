import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const zipFile = path.join(
  repoRoot,
  'dist-zip',
  'hokusai-codex-plugin-latest.zip',
);
const expectedRootName = 'hokusai-codex-plugin';
const failures = [];

function fail(message) {
  failures.push(message);
  console.error(`[FAIL] ${message}`);
}

function pass(message) {
  console.log(`[PASS] ${message}`);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
    return false;
  }

  pass(message);
  return true;
}

function readJson(filePath, description) {
  try {
    const value = JSON.parse(readFileSync(filePath, 'utf8'));
    pass(`${description} parses as JSON`);
    return value;
  } catch (error) {
    fail(
      `${description} parse failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function assertNoStandardHooksRef(manifest) {
  if (!manifest?.hooks) {
    return;
  }

  const hooks = Array.isArray(manifest.hooks) ? manifest.hooks : [manifest.hooks];
  const hasStandardHooksRef = hooks.some(
    (hook) => hook === './hooks/hooks.json' || hook === 'hooks/hooks.json',
  );
  assert(
    !hasStandardHooksRef,
    'plugin manifest must not reference the standard hooks/hooks.json',
  );
}

function assertFileExists(filePath, description) {
  return assert(
    existsSync(filePath),
    `${description}: ${path.relative(repoRoot, filePath)}`,
  );
}

function collectFiles(rootDir) {
  const files = [];

  function walk(currentDir) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else {
        files.push(absolutePath);
      }
    }
  }

  if (existsSync(rootDir)) {
    walk(rootDir);
  }

  return files;
}

async function requestMcp(commandPath, env, method, params, id) {
  const child = spawn(commandPath, [], {
    cwd: path.dirname(commandPath),
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const responses = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    responses.push(...chunk.split('\n').filter(Boolean));
  });

  child.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`,
  );
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
  );
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`,
  );

  await new Promise((resolve) => setTimeout(resolve, 1000));
  child.kill();

  const parsed = responses.map((line) => JSON.parse(line));
  return parsed.find((entry) => entry.id === id);
}

async function main() {
  assert(
    existsSync(zipFile),
    `plugin zip exists: ${path.relative(repoRoot, zipFile)}`,
  );
  if (failures.length > 0) {
    return finish();
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'hokusai-codex-smoke-'));
  const extractDir = path.join(tempDir, 'unzipped');

  try {
    execFileSync('unzip', ['-q', zipFile, '-d', extractDir], {
      stdio: 'inherit',
    });
    pass('zip extracted');

    const extractedRoot = path.join(extractDir, expectedRootName);
    const pluginRoot = path.join(extractedRoot, 'plugins', 'hokusai');
    const manifestPath = path.join(pluginRoot, '.codex-plugin', 'plugin.json');
    // Codex reads the marketplace manifest from `.agents/plugins/` and nowhere
    // else. Asserting it at the archive root is what let a zip that `codex
    // plugin marketplace add` rejects ship through a green CI run.
    const marketplacePath = path.join(
      extractedRoot,
      '.agents',
      'plugins',
      'marketplace.json',
    );
    const mcpConfigPath = path.join(pluginRoot, '.mcp.json');
    const binPath = path.join(pluginRoot, 'bin', 'hokusai-codex-mcp');

    assertFileExists(manifestPath, 'plugin manifest exists');
    assertFileExists(marketplacePath, 'marketplace manifest is at .agents/plugins/');
    assertFileExists(mcpConfigPath, 'mcp config exists');
    assertFileExists(binPath, 'mcp launcher exists');

    assert(
      !existsSync(path.join(extractedRoot, 'marketplace.json')),
      'no stray marketplace.json at the archive root',
    );
    assert(
      !existsSync(path.join(pluginRoot, 'marketplace.json')),
      'no stray marketplace.json inside the plugin dir',
    );

    const manifest = readJson(manifestPath, 'plugin manifest');
    const marketplace = readJson(marketplacePath, 'marketplace');
    const mcpConfig = readJson(mcpConfigPath, 'mcp config');

    if (manifest) {
      assert(manifest.name === 'hokusai', 'manifest uses expected plugin name');
      assert(
        manifest.skills === './skills/',
        'manifest points at bundled skills',
      );
      assert(
        manifest.mcpServers === './.mcp.json',
        'manifest points at bundled mcp config',
      );
      assertNoStandardHooksRef(manifest);
    }
    if (marketplace) {
      assert(
        Array.isArray(marketplace.plugins) && marketplace.plugins.length === 1,
        'marketplace exposes exactly one plugin',
      );
      // The install id is `<plugin>@<marketplace>`, so this name is public
      // surface: it makes the documented command `codex plugin add
      // hokusai@hokusai`.
      assert(
        marketplace.name === 'hokusai',
        'marketplace is named hokusai (install id is hokusai@hokusai)',
      );
    }
    if (mcpConfig) {
      assert(
        Boolean(mcpConfig.hokusai),
        'mcp config exposes the hokusai server',
      );
    }

    const configDir = path.join(tempDir, 'config');
    const env = {
      ...process.env,
      HOKUSAI_CONFIG_DIR: configDir,
      HOKUSAI_API_KEY: '',
      HOKUSAI_ROUTING_CONSENT: '',
      HOKUSAI_OUTCOME_OPT_IN: '',
    };

    const listResult = await requestMcp(binPath, env, 'tools/list', {}, 10);
    const toolNames = (listResult?.result?.tools ?? []).map(
      (tool) => tool.name,
    );
    assert(
      JSON.stringify(toolNames) ===
        JSON.stringify([
          'hokusai_route',
          'hokusai_preview_route_payload',
          'hokusai_submit_outcome',
          'hokusai_latest_route',
          'hokusai_privacy_status',
          'hokusai_prompt_outcome_contribution',
        ]),
      'mcp server exposes the expected tools',
    );

    const previewResult = await requestMcp(
      binPath,
      env,
      'tools/call',
      {
        name: 'hokusai_preview_route_payload',
        arguments: { task: 'Preview a route payload without network.' },
      },
      11,
    );
    const previewStructured = previewResult?.result?.structuredContent;
    assert(
      Boolean(previewStructured?.payload),
      'preview route returns a payload',
    );

    const routeError = await requestMcp(
      binPath,
      env,
      'tools/call',
      {
        name: 'hokusai_route',
        arguments: { task: 'Route this task.' },
      },
      12,
    );
    const routeErrorPayload = routeError?.result?.structuredContent;
    assert(
      routeErrorPayload?.code === 'E_MISSING_API_KEY',
      'route returns missing-key error without env',
    );

    const outcomePreview = await requestMcp(
      binPath,
      env,
      'tools/call',
      {
        name: 'hokusai_submit_outcome',
        arguments: {
          actualModel: 'gpt-5-codex',
          recommendationAccepted: true,
          completionStatus: 'succeeded',
          latencyBucket: 'low',
          costBucket: 'low',
          tokenBucket: 'low',
        },
      },
      13,
    );
    const outcomeErrorPayload = outcomePreview?.result?.structuredContent;
    assert(
      outcomeErrorPayload?.code === 'E_NOT_FOUND',
      'outcome preview fails clearly when no route exists',
    );

    const leakedContent = collectFiles(configDir)
      .map((filePath) => readFileSync(filePath, 'utf8'))
      .join('\n');
    assert(
      !/rawTaskText|rawCode|rawLog|rawPrompt|customer/i.test(leakedContent),
      'local state does not contain raw denylisted fields',
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  finish();
}

function finish() {
  if (failures.length > 0) {
    process.exitCode = 1;
    return;
  }

  pass('codex plugin smoke test completed');
}

void main();
