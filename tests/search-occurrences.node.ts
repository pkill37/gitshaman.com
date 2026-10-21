import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSearchOccurrences } from '../src/lib/code-index';

test('returns every occurrence on every matching line with original columns', () => {
  assert.deepEqual(buildSearchOccurrences('  foo foo\r\nnone\r\nFOO', 'foo'), [
    { line: 1, column: 3, preview: 'foo foo' },
    { line: 1, column: 7, preview: 'foo foo' },
    { line: 3, column: 1, preview: 'FOO' },
  ]);
});

test('filename terms do not suppress content occurrences on other lines', () => {
  assert.deepEqual(
    buildSearchOccurrences('foo\nfoo\nfoo', 'module.py foo').map((match) => match.line),
    [1, 2, 3]
  );
});

test('quoted phrases stay intact and duplicate terms do not duplicate results', () => {
  assert.equal(buildSearchOccurrences('foo bar foo\nbar foo bar', '"foo bar"').length, 2);
  assert.equal(buildSearchOccurrences('foo foo', 'foo foo').length, 2);
  assert.deepEqual(buildSearchOccurrences('unrelated', 'missing'), []);
  assert.deepEqual(buildSearchOccurrences('content', ' '), []);
});
