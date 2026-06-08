import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const rootDir = path.resolve(import.meta.dirname, '..');
const coreDir = path.join(rootDir, 'packages', 'core', 'src');
const packageJsonPath = path.join(rootDir, 'packages', 'core', 'package.json');

const forbiddenPackagePattern = /^@hokusai\/adapter-/;
const forbiddenPathSegments = [
  `${path.sep}packages${path.sep}adapter-`,
  `${path.sep}examples${path.sep}`,
];

async function listTypeScriptFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        return listTypeScriptFiles(entryPath);
      }

      return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
    }),
  );

  return files.flat();
}

function collectSpecifiers(sourceText, filePath) {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers = [];

  sourceFile.forEachChild((node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push({
        filePath,
        specifier: node.moduleSpecifier.text,
      });
    }
  });

  return specifiers;
}

function isForbiddenSpecifier(filePath, specifier) {
  if (forbiddenPackagePattern.test(specifier)) {
    return true;
  }

  if (!specifier.startsWith('.')) {
    return false;
  }

  const resolved = path.resolve(path.dirname(filePath), specifier);
  return forbiddenPathSegments.some((segment) => resolved.includes(segment));
}

export async function checkCoreBoundaries() {
  const violations = [];
  const files = await listTypeScriptFiles(coreDir);

  for (const filePath of files) {
    const sourceText = await readFile(filePath, 'utf8');

    for (const { specifier } of collectSpecifiers(sourceText, filePath)) {
      if (isForbiddenSpecifier(filePath, specifier)) {
        violations.push({
          filePath,
          specifier,
          message: 'Core must not import adapters or examples.',
        });
      }
    }
  }

  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const dependencyBuckets = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ];

  for (const bucket of dependencyBuckets) {
    const dependencies = packageJson[bucket] ?? {};
    for (const dependency of Object.keys(dependencies)) {
      if (forbiddenPackagePattern.test(dependency)) {
        violations.push({
          filePath: packageJsonPath,
          specifier: dependency,
          message: `Core ${bucket} must not reference adapter packages.`,
        });
      }
    }
  }

  return violations;
}
