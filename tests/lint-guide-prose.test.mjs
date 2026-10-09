import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { lintMarkdown } from '../scripts/lint-guide-prose.ts';

const lint = (markdown) => lintMarkdown('fixture.md', markdown);
const script = resolve('scripts/lint-guide-prose.ts');
const tsx = resolve('node_modules/tsx/dist/cli.mjs');

for (const phrase of [
  'You can inspect the file.',
  'You\ncan inspect the file.',
  'You **can** inspect the file.',
  '**You** _can_ inspect the file.',
  '[You **can** inspect](https://example.com) the file.',
  '[You can inspect][target]\n\n[target]: https://example.com',
  '> You\n> can inspect the file.',
  '- You\n  can inspect the file.',
  'You  \ncan inspect the file.',
  'You&nbsp;can inspect the file.',
  'You &#99;an inspect the file.',
  '## You can inspect the file.',
  '| Action |\n| --- |\n| You **can** inspect the file. |',
]) {
  test(`flags rendered prose: ${JSON.stringify(phrase)}`, () => {
    assert.ok(lint(phrase).some((issue) => /direct guide voice/.test(issue.message)));
  });
}

test('enforces wordiness, adverbs, weasel words, repetitions, and cliches by default', () => {
  for (const phrase of [
    'In order to inspect it.',
    'Inspect it quickly.',
    'Very large files.',
    'Read the the file.',
    'This is a clean slate.',
  ]) {
    assert.ok(lint(phrase).length > 0, phrase);
  }
});

test('flags all custom instruction patterns', () => {
  for (const phrase of [
    'You should',
    'You may want to',
    'You might want to',
    'Try to',
    'It is useful to',
    'It can be useful to',
    'Take a look at',
    'Dive into',
    'Keep in mind',
    'Note that',
    'Due to the fact that',
    'The fact that',
  ]) {
    assert.ok(lint(`${phrase} inspect the file.`).length > 0, phrase);
  }
});

test('preserves exact source locations after metadata, code, indentation, and links', () => {
  const markdown = [
    '---',
    'title: Fixture',
    '---',
    '```text',
    'example',
    '```',
    '  You can inspect the file.',
    '',
    'Read [the file](https://example.com/long/path). You **can** inspect it.',
  ].join('\n');
  const diagnostics = lint(markdown).filter((issue) => /direct guide voice/.test(issue.message));
  assert.deepEqual(
    diagnostics.map(({ lineNumber, column }) => ({ lineNumber, column })),
    [
      { lineNumber: 7, column: 3 },
      { lineNumber: 9, column: 49 },
    ]
  );
});

test('maps decoded entities and CRLF to original columns and lines', () => {
  const markdown =
    '---\r\ntitle: Fixture\r\n---\r\nRead &amp; inspect. You **can** inspect.\r\n> Read\r\n> quickly.';
  const issues = lint(markdown);
  const hedged = issues.find((issue) => /direct guide voice/.test(issue.message));
  assert.equal(hedged.lineNumber, 4);
  assert.equal(hedged.column, 21);
  const adverb = issues.find((issue) => issue.excerpt === 'quickly');
  assert.equal(adverb.lineNumber, 6);
  assert.equal(adverb.column, 3);
});

test('ignores metadata, code, destinations, and comments', () => {
  assert.deepEqual(
    lint(
      [
        '---',
        'description: You can leave metadata alone.',
        '---',
        '',
        'Use `you can leave code alone` and ``you can use ` here``.',
        'Read [the link](https://example.com/you_can "You can ignore titles").',
        '',
        '~~~text',
        'You can leave this fence alone.',
        '~~~',
        '',
        '````text',
        'You can leave this fence alone.',
        '```',
        '````',
        '',
        '    You can leave indented code alone.',
        '',
        '<!-- You can leave comments alone. -->',
        '',
        '---',
        'id: ch1',
        'description: You can leave chapter metadata alone.',
        '---',
        '',
        'Open the file.',
      ].join('\n')
    ),
    []
  );
});

test('does not combine separate paragraphs, table cells, list items, or code boundaries', () => {
  for (const markdown of [
    'You\n\ncan inspect.',
    '- You\n- can inspect.',
    '| You | can inspect |\n| --- | --- |',
    'You `x` can inspect.',
  ]) {
    assert.deepEqual(lint(markdown), [], markdown);
  }
});

test('accepts direct prose and technical exceptions at the start and middle of text', () => {
  assert.deepEqual(
    lint('Open the file, trace the call, compare the states, and verify the result.'),
    []
  );
  assert.deepEqual(
    lint('Only inspect read-only user-space memory. A simple single kernel-space mapping.'),
    []
  );
  assert.ok(lint('Simply inspect it.').length > 0);
  assert.deepEqual(lint('Objective-C uses message dispatch.'), []);
  assert.ok(lint('State the objective.').length > 0);
  assert.ok(lint('In order\n  to inspect it.').length > 0);
});

function runFixture(t, files, env = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'guide-prose-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'docs'));
  for (const [name, markdown] of Object.entries(files)) {
    const path = join(cwd, 'docs', name);
    mkdirSync(resolve(path, '..'), { recursive: true });
    writeFileSync(path, markdown);
  }
  return spawnSync(process.execPath, [tsx, script], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('CLI rejects violations in nested guides, even with the old opt-out variable', (t) => {
  const result = runFixture(
    t,
    { 'nested/fixture.md': 'Inspect it quickly.' },
    { GUIDE_PROSE_SUGGESTIONS: '0' }
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /docs\/nested\/fixture.md:1:12/);
});

test('CLI accepts clean guides and excludes templates', (t) => {
  const result = runFixture(t, {
    'fixture.md': 'Open the file.',
    '_template.md': 'You can inspect.',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 guide files/);
});

test('CLI fails closed on an empty corpus', (t) => {
  const result = runFixture(t, {});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No guide Markdown files/);
});

test('guide validation and the build include prose linting', () => {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.match(scripts['guides:validate'], /&& npm run lint:guide-prose &&/);
  assert.match(scripts.lint, /&& npm run lint:guide-prose &&/);
  assert.match(
    readFileSync('scripts/build.ts', 'utf8'),
    /args: \['scripts\/lint-guide-prose.ts'\]/
  );
});

test('checked-in guide corpus passes the strict CLI', () => {
  const result = spawnSync(process.execPath, [tsx, script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Validated \d+ guide files/);
});
