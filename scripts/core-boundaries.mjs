import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const rootDir = path.resolve(import.meta.dirname, '..');
const coreDir = path.join(rootDir, 'packages', 'core', 'src');
const packageJsonPath = path.join(rootDir, 'packages', 'core', 'package.json');
const scanDir = path.join(rootDir, 'packages', 'scan', 'src');
const scanPackageJsonPath = path.join(rootDir, 'packages', 'scan', 'package.json');

// Core holds wire-format contracts only: it must not depend on adapters or on
// the scanner runtime (@hokusai/scan → @hokusai/core is the only allowed edge).
const forbiddenPackagePattern = /^@hokusai\/(adapter-|scan$)/;
const forbiddenPathSegments = [
  `${path.sep}packages${path.sep}adapter-`,
  `${path.sep}packages${path.sep}scan${path.sep}`,
  `${path.sep}examples${path.sep}`,
];

// The scanner is adapter-agnostic: it may import @hokusai/core, never adapters.
const scanForbiddenPackagePattern = /^@hokusai\/adapter-/;
const scanForbiddenPathSegments = [
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

function isForbiddenSpecifier(filePath, specifier, packagePattern, pathSegments) {
  if (packagePattern.test(specifier)) {
    return true;
  }

  if (!specifier.startsWith('.')) {
    return false;
  }

  const resolved = path.resolve(path.dirname(filePath), specifier);
  return pathSegments.some((segment) => resolved.includes(segment));
}

const dependencyBuckets = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

async function checkPackage(violations, {
  srcDir,
  packageJsonFile,
  packagePattern,
  pathSegments,
  importMessage,
  dependencyMessage,
}) {
  const files = await listTypeScriptFiles(srcDir);

  for (const filePath of files) {
    const sourceText = await readFile(filePath, 'utf8');

    for (const { specifier } of collectSpecifiers(sourceText, filePath)) {
      if (isForbiddenSpecifier(filePath, specifier, packagePattern, pathSegments)) {
        violations.push({
          filePath,
          specifier,
          message: importMessage,
        });
      }
    }
  }

  const packageJson = JSON.parse(await readFile(packageJsonFile, 'utf8'));
  for (const bucket of dependencyBuckets) {
    const dependencies = packageJson[bucket] ?? {};
    for (const dependency of Object.keys(dependencies)) {
      if (packagePattern.test(dependency)) {
        violations.push({
          filePath: packageJsonFile,
          specifier: dependency,
          message: `${dependencyMessage} (${bucket})`,
        });
      }
    }
  }
}

export async function checkCoreBoundaries() {
  const violations = [];

  await checkPackage(violations, {
    srcDir: coreDir,
    packageJsonFile: packageJsonPath,
    packagePattern: forbiddenPackagePattern,
    pathSegments: forbiddenPathSegments,
    importMessage: 'Core must not import adapters, scan, or examples.',
    dependencyMessage: 'Core must not reference adapter or scan packages.',
  });

  await checkPackage(violations, {
    srcDir: scanDir,
    packageJsonFile: scanPackageJsonPath,
    packagePattern: scanForbiddenPackagePattern,
    pathSegments: scanForbiddenPathSegments,
    importMessage: 'Scan must not import adapters or examples.',
    dependencyMessage: 'Scan must not reference adapter packages.',
  });

  return violations;
}
