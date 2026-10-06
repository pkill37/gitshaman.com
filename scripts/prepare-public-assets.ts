#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { CORPUS_REPOS_DIR, PUBLIC_REPOS_DIR } from './static-asset-paths';

const SQLITE_WASM_SOURCE_DIR = path.join(process.cwd(), 'node_modules', 'sql.js', 'dist');
const SQLITE_WASM_TARGET_DIR = path.join(process.cwd(), 'public', 'sqljs');
const SQLITE_RUNTIME_FILES = ['sql-wasm-browser.wasm', 'sql-wasm.wasm'];

type PrepareMode = 'dev' | 'shell' | 'sqljs';

function formatTarget(targetPath: string): string {
  return path.relative(process.cwd(), targetPath) || '.';
}

function isSymlinkTo(targetPath: string, sourcePath: string): boolean {
  try {
    const stat = fs.lstatSync(targetPath);
    if (!stat.isSymbolicLink()) {
      return false;
    }

    const linkTarget = fs.readlinkSync(targetPath);
    return path.resolve(path.dirname(targetPath), linkTarget) === sourcePath;
  } catch {
    return false;
  }
}

function ensurePublicSymlink(sourceDir: string, targetDir: string): void {
  if (!fs.existsSync(sourceDir)) {
    console.warn(`Missing source for ${formatTarget(targetDir)}: ${sourceDir}`);
    return;
  }

  if (isSymlinkTo(targetDir, sourceDir)) {
    console.log(`Current ${formatTarget(targetDir)} -> ${fs.readlinkSync(targetDir)}`);
    return;
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });

  const relativeSource = path.relative(path.dirname(targetDir), sourceDir);
  fs.symlinkSync(relativeSource, targetDir, 'dir');
  console.log(`Linked ${formatTarget(targetDir)} -> ${relativeSource}`);
}

function removePublicCorpusTarget(targetDir: string): void {
  if (!fs.existsSync(targetDir)) {
    return;
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  console.log(`Removed ${formatTarget(targetDir)}`);
}

function filesMatch(sourcePath: string, targetPath: string): boolean {
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  const sourceStat = fs.statSync(sourcePath);
  const targetStat = fs.statSync(targetPath);
  if (sourceStat.size !== targetStat.size) {
    return false;
  }

  return fs.readFileSync(sourcePath).equals(fs.readFileSync(targetPath));
}

function prepareSqlJsRuntime(): void {
  let availableRuntimeFiles = 0;

  for (const fileName of SQLITE_RUNTIME_FILES) {
    const sourcePath = path.join(SQLITE_WASM_SOURCE_DIR, fileName);
    const targetPath = path.join(SQLITE_WASM_TARGET_DIR, fileName);

    if (!fs.existsSync(sourcePath)) {
      console.warn(`sql.js runtime not found at ${sourcePath}; skipping`);
      continue;
    }

    availableRuntimeFiles++;
    fs.mkdirSync(SQLITE_WASM_TARGET_DIR, { recursive: true });

    if (filesMatch(sourcePath, targetPath)) {
      console.log(`Current ${formatTarget(targetPath)}`);
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
    console.log(`Copied ${formatTarget(targetPath)}`);
  }

  if (availableRuntimeFiles === 0) {
    console.warn('sql.js runtime not found; skipping wasm preparation');
  }
}

function parseModes(argv: string[]): Set<PrepareMode> {
  const modes = new Set<PrepareMode>();

  for (const arg of argv) {
    if (arg === '--dev') {
      modes.add('dev');
    } else if (arg === '--shell') {
      modes.add('shell');
    } else if (arg === '--sqljs') {
      modes.add('sqljs');
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (modes.size === 0) {
    modes.add('sqljs');
  }

  return modes;
}

export function preparePublicAssets(argv: string[] = process.argv.slice(2)): void {
  const modes = parseModes(argv);

  if (modes.has('dev')) {
    ensurePublicSymlink(CORPUS_REPOS_DIR, PUBLIC_REPOS_DIR);
  }

  if (modes.has('shell')) {
    removePublicCorpusTarget(PUBLIC_REPOS_DIR);
    prepareSqlJsRuntime();
  } else if (modes.has('sqljs')) {
    prepareSqlJsRuntime();
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    preparePublicAssets();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
