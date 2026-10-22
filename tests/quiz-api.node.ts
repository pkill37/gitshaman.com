import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { analyze } from '../packages/cli/src/analysis';
import { serveWorkspace } from '../packages/cli/src/server';
import { cliFixture } from './helpers/cli-fixture';
import { parseSharedQuiz, sharedQuizURL } from '../src/lib/quiz';

test('quiz API authenticates and validates requests before invoking Sphinx', async (t) => {
  const root = cliFixture();
  const bin = path.join(root, 'test-bin');
  fs.mkdirSync(bin);
  const log = path.join(root, 'quiz-calls.jsonl');
  const output = path.join(root, 'quiz-output.json');
  const hold = path.join(root, 'quiz-hold');
  const stopped = path.join(root, 'quiz-stopped');
  fs.writeFileSync(
    path.join(bin, 'sphinx'),
    `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (fs.existsSync(${JSON.stringify(hold)})) {
  process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(stopped)}, 'stopped'); process.exit(0); });
  setInterval(() => {}, 1000);
} else if (fs.existsSync(${JSON.stringify(output)})) process.stdout.write(fs.readFileSync(${JSON.stringify(output)}));
else
console.log(JSON.stringify({ id: 'fixture-check', status: args[0] === 'answer' ? 'passed' : 'pending', progress: { completed: args[0] === 'answer' ? 1 : 0, total: 1 }, ...(args[0] === 'answer' ? {} : { question: { id: 'q1', prompt: 'What happens on retry?', choices: [] } }) }));
`,
    { mode: 0o755 }
  );
  await analyze(root, { noEmbed: true });
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
  const workspace = await serveWorkspace(root, path.resolve('packages/cli/dist/workspace'));
  t.after(async () => {
    process.env.PATH = previousPath;
    workspace.server.closeAllConnections();
    await new Promise<void>((resolve) => workspace.server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const endpoint = new URL('/api/quiz', workspace.url);
  const headers = {
    Authorization: `Bearer ${workspace.token}`,
    'Content-Type': 'application/json',
  };
  assert.equal((await fetch(endpoint, { method: 'POST', body: '{}' })).status, 401);
  assert.equal(
    (
      await fetch(endpoint, {
        method: 'POST',
        headers: { ...headers, Origin: 'https://evil.invalid' },
        body: '{}',
      })
    ).status,
    403
  );
  assert.equal((await fetch(endpoint, { headers })).status, 405);
  for (const body of [
    { action: 'install' },
    { action: 'answer', id: '../other', text: 'x' },
    { action: 'answer', id: 'fixture-check', text: '' },
    { action: 'start', staged: 'yes' },
    null,
  ]) {
    assert.equal(
      (await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) })).status,
      400
    );
  }
  assert.equal(fs.existsSync(log), false);
  const start = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'start', staged: true }),
  });
  assert.equal(start.status, 200);
  assert.equal((await start.json()).question.prompt, 'What happens on retry?');
  const answer = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'answer', id: 'fixture-check', text: 'It retries safely.' }),
  });
  assert.equal(answer.status, 200);
  assert.equal((await answer.json()).status, 'passed');
  const calls = fs
    .readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(calls, [
    ['check', '--staged', '--json'],
    ['answer', 'fixture-check', '--text', 'It retries safely.', '--json'],
  ]);
  const post = (body: unknown, extraHeaders = headers, signal?: AbortSignal) =>
    fetch(endpoint, { method: 'POST', headers: extraHeaders, body: JSON.stringify(body), signal });
  assert.equal(
    (await post({ action: 'start' }, { ...headers, 'Content-Type': 'text/plain' })).status,
    415
  );
  assert.equal((await post({ action: 'start', text: 'x'.repeat(65536) })).status, 413);
  assert.equal(
    (
      await post(
        { action: 'resume', id: 'fixture-check' },
        { ...headers, 'Content-Type': 'application/json; charset=utf-8' }
      )
    ).status,
    200
  );
  assert.equal((await post({ action: 'explain', id: 'fixture-check' })).status, 200);
  for (const value of [
    null,
    { status: 'pending', question: { prompt: 'Broken' } },
    { status: 'pending', feedback: {} },
    { status: 'pending', progress: { completed: -1, total: 2 } },
  ]) {
    fs.writeFileSync(output, JSON.stringify(value));
    const invalid = await post({ action: 'start' });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /invalid assessment/);
  }
  fs.writeFileSync(output, '{');
  assert.equal((await post({ action: 'start' })).status, 400);
  fs.unlinkSync(output);
  fs.writeFileSync(hold, 'hold');
  const prior = fs.readFileSync(log, 'utf8');
  const controller = new AbortController();
  const pending = post({ action: 'start' }, headers, controller.signal);
  const rejected = assert.rejects(pending, /abort/i);
  const waitFor = async (condition: () => boolean) => {
    const deadline = Date.now() + 3000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('Quiz process did not reach expected state.');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  await waitFor(() => fs.readFileSync(log, 'utf8') !== prior);
  assert.equal((await post({ action: 'start' })).status, 409);
  controller.abort();
  await rejected;
  await waitFor(() => fs.existsSync(stopped));
  fs.unlinkSync(hold);
  const resumed = await post({ action: 'start' });
  assert.equal(resumed.status, 200, await resumed.text());
  fs.unlinkSync(path.join(bin, 'sphinx'));
  process.env.PATH = bin;
  const missing = await post({ action: 'start' });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /Sphinx is not installed/);
});

test('shared quiz round-trip strips private fields and rejects malformed or oversized content', () => {
  const quiz = parseSharedQuiz(
    JSON.stringify({
      version: 1,
      repository: 'example/project',
      revision: 'a'.repeat(40),
      answers: ['private answer'],
      apiKey: 'private key',
      assessmentId: 'private id',
      questions: [
        {
          prompt: 'What happens on retry? 🧠',
          explanation: 'The saved ID prevents a duplicate.',
          answer: 'private',
        },
      ],
    })
  );
  const link = new URL(sharedQuizURL(quiz));
  assert.equal(link.searchParams.get('view'), 'quiz');
  assert.deepEqual(parseSharedQuiz(decodeURIComponent(link.hash.slice(6))), quiz);
  assert.doesNotMatch(JSON.stringify(quiz), /private/);
  for (const input of [
    'null',
    '{}',
    '{',
    JSON.stringify({ ...quiz, repository: '../..' }),
    JSON.stringify({ ...quiz, revision: 'main' }),
    JSON.stringify({ ...quiz, questions: [] }),
    JSON.stringify({ ...quiz, questions: [{ prompt: 42 }] }),
    ' '.repeat(24001),
  ]) {
    assert.throws(() => parseSharedQuiz(input));
  }
});
