import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { buildCodeIndex } from '../scripts/code-index-builder';
import { enrichCodeIndexWithClangd } from '../scripts/clangd-semantic-index';
import { prepareCompilationDatabase } from '../scripts/compilation-database';

for (const mode of ['absent', 'prepare', 'outgoing', 'fatal', 'supported']) {
  test(`clangd call hierarchy compatibility: ${mode}`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clangd-compat-'));
    const executable = path.join(root, 'clangd.mjs');
    fs.copyFileSync(new URL('./fixtures/clangd-call-hierarchy.mjs', import.meta.url), executable);
    fs.chmodSync(executable, 0o755);
    const previousPath = process.env.CLANGD_PATH;
    const previousMode = process.env.TEST_CLANGD_CALL_HIERARCHY;
    process.env.CLANGD_PATH = executable;
    process.env.TEST_CLANGD_CALL_HIERARCHY = mode;
    t.after(() => {
      if (previousPath === undefined) delete process.env.CLANGD_PATH;
      else process.env.CLANGD_PATH = previousPath;
      if (previousMode === undefined) delete process.env.TEST_CLANGD_CALL_HIERARCHY;
      else process.env.TEST_CLANGD_CALL_HIERARCHY = previousMode;
      fs.rmSync(root, { recursive: true, force: true });
    });
    fs.writeFileSync(root + '/main.c', 'int main(void) { return 0; }');
    const logger = { log() {}, warn() {} };
    const index = buildCodeIndex(
      root,
      [{ name: 'main.c', path: 'main.c', type: 'file' }],
      'test',
      logger
    );
    const stats = await enrichCodeIndexWithClangd(root, index.dbPath, logger);
    assert.equal(stats.status, mode === 'fatal' ? 'unavailable' : 'partial', stats.detail);
    if (mode === 'fatal') {
      assert.match(stats.detail, /internal failure/);
      return;
    }
    assert.equal(stats.filesAnalyzed, 1);
    const db = new Database(index.dbPath, { readonly: true });
    t.after(() => db.close());
    const capabilities = db
      .prepare("SELECT Feature, Status FROM AnalysisCapabilities WHERE Provider = 'clangd'")
      .all() as Array<{ Feature: string; Status: string }>;
    for (const capability of capabilities) {
      assert.equal(
        capability.Status,
        capability.Feature === 'calls' && mode !== 'supported' ? 'unavailable' : 'partial',
        capability.Feature
      );
    }
    const symbols = db.prepare('SELECT Name, Doc FROM Symbols ORDER BY Name').all();
    assert.deepEqual(symbols, [
      { Name: 'helper', Doc: 'Semantic hover from clangd' },
      { Name: 'main', Doc: 'Semantic hover from clangd' },
    ]);
  });
}

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
