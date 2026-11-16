import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createRepositoryVisit,
  readRepositoryHistory,
  recordRepositoryVisit,
} from '../src/lib/repository-history';

test('repository trail retains all visits when jumping back and updates the latest file', () => {
  const python = createRepositoryVisit('python', 'cpython', 'Python/ceval.c', 'v3.14.0', '');
  const linux = createRepositoryVisit('torvalds', 'linux', 'kernel/fork.c', 'v6.1', '');
  let history = recordRepositoryVisit([], python);
  const originalId = history[0].id;
  history = recordRepositoryVisit(history, {
    ...python,
    file: 'Python/pystate.c',
    href: '/cpython/?file=Python%2Fpystate.c',
  });
  assert.equal(history.length, 1);
  assert.equal(history[0].id, originalId);
  history = recordRepositoryVisit(history, linux);
  history = recordRepositoryVisit(history, python);
  assert.deepEqual(
    history.map((visit) => visit.repo),
    ['cpython', 'linux', 'cpython']
  );
  assert.equal(new Set(history.map((visit) => visit.id)).size, 3);
  assert.deepEqual(readRepositoryHistory(JSON.stringify(history)), history);
});

test('history saves the file and revision and discards stale search locations', () => {
  const visit = createRepositoryVisit(
    'torvalds',
    'linux',
    'kernel/fork.c',
    'v6.1',
    'file=old.c&line=12&search=old&dir=kernel'
  );
  const url = new URL(visit.href, 'https://gitshaman.com');
  assert.equal(url.searchParams.get('file'), 'kernel/fork.c');
  assert.equal(url.searchParams.get('ref'), 'v6.1');
  for (const key of ['line', 'search', 'dir']) assert.equal(url.searchParams.has(key), false);
  const focused = createRepositoryVisit(
    'torvalds',
    'linux',
    'kernel/fork.c',
    'v6.1',
    'file=kernel%2Ffork.c&line=12&search=clone'
  );
  assert.equal(new URL(focused.href, 'https://gitshaman.com').searchParams.get('line'), '12');
});

test('invalid storage and unsafe navigation targets do not enter history', () => {
  assert.deepEqual(readRepositoryHistory('{'), []);
  assert.deepEqual(readRepositoryHistory('{}'), []);
  const visit = createRepositoryVisit('python', 'cpython', '', '', '');
  assert.deepEqual(
    readRepositoryHistory(
      JSON.stringify([
        { ...visit, href: 'javascript:alert(1)' },
        null,
        { ...visit, href: '//evil.test' },
      ])
    ),
    []
  );
});
