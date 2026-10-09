import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { buildCodeIndex } from '../scripts/code-index-builder';
import { enrichCodeIndexWithClangd } from '../scripts/clangd-semantic-index';
import { prepareCompilationDatabase } from '../scripts/compilation-database';

test('clangd analyzes generated commands and reports partial coverage', async (t) => {
  if (spawnSync(process.env.CLANGD_PATH || 'clangd', ['--version']).status !== 0) {
    t.skip('clangd is not installed');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clangd-snapshot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'main.c'), 'int main(void) { return 0; }');
  const logger = { log() {}, warn() {} };
  const index = buildCodeIndex(
    root,
    [{ name: 'main.c', path: 'main.c', type: 'file' }],
    'test',
    logger
  );
  const stats = await enrichCodeIndexWithClangd(root, index.dbPath, logger);
  assert.equal(stats.status, 'partial', stats.detail);
  assert.equal(stats.filesAnalyzed, 1);
  assert.match(stats.detail!, /Source-only compilation commands/);
});

test('source-only commands handle languages and spaces, exclude symlinks, and preserve native databases', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compilation database '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'include'));
  fs.writeFileSync(path.join(root, 'main.c'), 'int main(void) { return 0; }');
  fs.writeFileSync(path.join(root, 'other.C'), 'class Example {};');
  fs.symlinkSync(root, path.join(root, 'loop'));
  const result = prepareCompilationDatabase(root);
  assert.equal(result.status, 'generated');
  assert.equal(result.commandCount, 2);
  const original = fs.readFileSync(result.databasePath!, 'utf8');
  const commands = JSON.parse(original);
  assert.deepEqual(
    commands.map((command: { arguments: string[] }) => command.arguments.slice(0, 3)),
    [
      ['clang', '-x', 'c'],
      ['clang++', '-x', 'c++'],
    ]
  );
  assert.ok(commands[0].arguments.includes(path.join(root, 'include')));
  assert.equal(prepareCompilationDatabase(root).status, 'existing');
  assert.equal(fs.readFileSync(result.databasePath!, 'utf8'), original);
  fs.mkdirSync(path.join(root, 'build'));
  const nativePath = path.join(root, 'build', 'compile_commands.json');
  fs.writeFileSync(nativePath, '[]');
  assert.equal(prepareCompilationDatabase(root).databasePath, nativePath);
});

test('non-C-family snapshots do not get an empty compilation database', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compilation-database-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'main.go'), 'package main');
  assert.deepEqual(prepareCompilationDatabase(root), {
    status: 'not-applicable',
    databasePath: null,
    commandCount: 0,
  });
  assert.equal(fs.existsSync(path.join(root, 'compile_commands.json')), false);
});
