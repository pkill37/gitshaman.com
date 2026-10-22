import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { cliFixture } from './helpers/cli-fixture';
import { parseCommandLine } from '../packages/cli/src/arguments';

const loader = createRequire(import.meta.url).resolve('tsx');
const cli = path.resolve('packages/cli/src/cli.ts');

test('argument validation rejects unsupported combinations before accessing a repository', () => {
  for (const args of [
    ['unknown'],
    ['init', 'extra'],
    ['analyze', '--port', '1'],
    ['parser', '--force'],
    ['quiz', 'unknown'],
    ['quiz', 'status', '--staged'],
    ['quiz', '--local'],
    ['quiz', 'check', '--port='],
    ['quiz', 'install-hooks', '--json'],
    ['quiz', 'doctor', '--no-open'],
    ['quiz', 'check', 'extra'],
    ['parser', '../src'],
    ['parser', '/src'],
    ['parser', 'src/../src'],
    ['--unknown'],
    ['viz', '--port'],
  ])
    assert.throws(() => parseCommandLine(args), args.join(' '));
  for (const command of ['viz', 'quiz']) {
    for (const port of ['', ' ', '-1', '1.5', '65536', 'NaN', 'Infinity', '0x10', '1e3'])
      assert.throws(() => parseCommandLine([command, `--port=${port}`]), /port/);
    for (const port of ['0', '3001', '65535'])
      assert.equal(parseCommandLine([command, '--port', port]).port, Number(port));
  }
});

test('CLI entry point supports help, version, init, parser, checksum, analyze, and verify', async (t) => {
  const root = cliFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gitshaman-outside-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['--import', loader, cli, ...args], {
      cwd: outside,
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...process.env,
        CLANGD_PATH: path.join(outside, 'no-clangd'),
        TSX_TSCONFIG_PATH: path.resolve('tsconfig.json'),
      },
    });
  for (const args of [[], ['--help'], ['quiz', '--help']]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: gitshaman/);
  }
  const version = run(['version', '--json']);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(JSON.parse(version.stdout).clangd, 'unavailable');
  assert.equal(run(['init']).status, 1, 'init requires a worktree');
  const config = fs.readFileSync(path.join(root, 'gitshaman.json'), 'utf8');
  for (let index = 0; index < 2; index++) {
    const result = run(['init', '--repo', root, '--json']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).initialized, true);
  }
  assert.equal(fs.readFileSync(path.join(root, 'gitshaman.json'), 'utf8'), config);
  for (const target of ['./src/', 'src', '.', './']) {
    const result = run(['parser', target, '--repo', root, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const files = JSON.parse(result.stdout) as Array<{ path: string; provider: string }>;
    assert(files.some((file) => file.path === 'src/auth.ts' && file.provider === 'heuristic'));
  }
  const missing = run(['parser', 'missing', '--repo', root]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /excluded or does not exist/);
  const checksum = run(['checksum', '--repo', root, '--json']);
  assert.equal(checksum.status, 0, checksum.stderr);
  assert.equal(JSON.parse(checksum.stdout).stale, true);
  const analyzed = run(['analyze', '--repo', root, '--no-embed', '--json']);
  assert.equal(analyzed.status, 0, analyzed.stderr);
  assert.equal(JSON.parse(analyzed.stdout).embeddings, 'skipped');
  const verified = run(['verify', '--repo', root, '--json']);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).ok, true);
  fs.writeFileSync(path.join(root, 'gitshaman.json'), 'null');
  const invalid = run(['parser', '--repo', root]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Invalid gitshaman.json/);
  assert.doesNotMatch(invalid.stderr, /TypeError|Cannot read/);
});

test('viz and quiz start authenticated workspaces and stop cleanly on signals', async (t) => {
  const root = cliFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const analyzed = spawnSync(
    process.execPath,
    ['--import', loader, cli, 'analyze', '--repo', root, '--no-embed'],
    { encoding: 'utf8' }
  );
  assert.equal(analyzed.status, 0, analyzed.stderr);
  for (const command of ['viz', 'quiz']) {
    await t.test(command, { timeout: 10000 }, async (subtest) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          loader,
          cli,
          command,
          '--repo',
          root,
          '--no-open',
          ...(command === 'quiz' ? ['--staged'] : []),
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      subtest.after(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      });
      let stdout = '';
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      const exit = once(child, 'exit');
      const ready = await new Promise<string>((resolve, reject) => {
        child.on('error', reject);
        child.once('exit', () => reject(new Error(`Workspace exited before startup: ${stderr}`)));
        child.stdout.on('data', (chunk) => {
          stdout += chunk;
          if (stdout.includes('\n}')) resolve(stdout);
        });
      });
      const url = new URL(JSON.parse(ready).url);
      assert.match(url.hash, /^#[a-f0-9]{64}$/);
      assert.equal(url.searchParams.get('view'), command === 'quiz' ? 'quiz' : null);
      assert.equal(url.searchParams.get('staged'), command === 'quiz' ? '1' : null);
      const status = await fetch(new URL('/api/status', url), {
        headers: { Authorization: `Bearer ${url.hash.slice(1)}` },
      });
      assert.equal(status.status, 200);
      child.kill(command === 'quiz' ? 'SIGINT' : 'SIGTERM');
      assert.deepEqual(await exit, [0, null]);
    });
  }
});
