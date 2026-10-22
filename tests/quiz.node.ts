import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ankiQuizText } from '../src/lib/quiz';

test('Anki export preserves card boundaries and literal code without exporting private fields', () => {
  const questions = [
    {
      prompt: '#Why <T> & "quotes"?\r\nNext\tline 🧠',
      explanation: '<script>alert(1)</script>\nSafe',
      answer: 'PRIVATE',
    },
    { prompt: 'No explanation' },
    { prompt: 'Blank explanation', explanation: '   ' },
  ];
  const exported = ankiQuizText(questions);
  const lines = exported.trimEnd().split('\n');
  assert.deepEqual(lines.slice(0, 3), ['#separator:Tab', '#html:true', '#columns:Front\tBack']);
  assert.equal(lines.length, 6);
  assert.ok(lines.slice(3).every((line) => line.split('\t').length === 2));
  assert.match(lines[3], /&lt;T&gt; &amp; &quot;quotes&quot;\?<br>Next&#9;line 🧠/);
  assert.match(lines[3], /&lt;script&gt;alert\(1\)&lt;\/script&gt;<br>Safe/);
  assert.match(lines[4], /No explanation was included/);
  assert.match(lines[5], /No explanation was included/);
  assert.doesNotMatch(exported, /PRIVATE|<script>/);
  assert.throws(() => ankiQuizText([]), /Generate or import/);
});

const cli = path.resolve('packages/cli/src/cli.ts');

test('quiz delegates to Sphinx in the target worktree without requiring analysis or init', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitshaman quiz '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repository with spaces');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(repo);
  fs.mkdirSync(bin);
  execFileSync('git', ['init', repo]);
  fs.symlinkSync(
    execFileSync('which', ['git'], { encoding: 'utf8' }).trim(),
    path.join(bin, 'git')
  );
  fs.writeFileSync(
    path.join(bin, 'sphinx'),
    `#!${process.execPath}
console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));
if (process.env.QUIZ_TEST_SIGNAL) process.kill(process.pid, 'SIGTERM');
else process.exitCode = Number(process.env.QUIZ_TEST_EXIT || 0);
`,
    { mode: 0o755 }
  );
  const run = (args: string[], extra: Record<string, string> = {}) =>
    spawnSync(process.execPath, ['--import', 'tsx', cli, 'quiz', '--repo', repo, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: bin, ...extra },
    });

  for (const [args, expected] of [
    [['check'], ['check']],
    [
      ['--staged', '--json'],
      ['check', '--staged', '--json'],
    ],
    [
      ['init', '--json'],
      ['init', '--json'],
    ],
    [['status'], ['status']],
    [['doctor'], ['doctor']],
    [['install-hooks'], ['install', '--agents', 'none', '--no-launch']],
    [
      ['install-hooks', '--local'],
      ['install', '--repo'],
    ],
    [
      ['uninstall-hooks', '--local'],
      ['uninstall', '--repo'],
    ],
    [['uninstall-hooks'], ['uninstall']],
  ]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { args: expected, cwd: fs.realpathSync(repo) });
  }

  const rejected = run(['check'], { QUIZ_TEST_EXIT: '23' });
  assert.equal(rejected.status, 23, 'Sphinx rejection must remain a CLI failure');
  assert.equal(run(['check'], { QUIZ_TEST_SIGNAL: '1' }).status, 143);

  for (const args of [
    ['unknown'],
    ['status', '--staged'],
    ['--local'],
    ['install-hooks', '--json'],
    ['uninstall-hooks', '--json'],
    ['check', 'extra'],
    ['--force'],
  ]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '', 'Invalid options must not start Sphinx');
  }

  fs.unlinkSync(path.join(bin, 'sphinx'));
  const missing = run(['check']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /npm install -g sphinx-understand/);
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /machine-wide/);
  assert.match(help.stdout, /--staged/);
});
