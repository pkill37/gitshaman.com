import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scanArtifacts, selectUploads } from '../scripts/deploy-inventory';
import { createHash } from 'node:crypto';

test('inventory follows symlinks, detects target changes, and rejects directory cycles', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deploy-inventory-test-'));
  try {
    const dir = path.join(root, 'repo');
    const cache = path.join(root, 'cache.json');
    await fs.mkdir(path.join(dir, 'process'), { recursive: true });
    const target = path.join(dir, 'process/changes.rst');
    await fs.writeFile(target, 'aaaa');
    await fs.symlink('process/changes.rst', path.join(dir, 'Changes'));
    await fs.symlink('process', path.join(dir, 'alias'));
    const first = await scanArtifacts(dir, cache);
    assert.deepEqual(first.files.Changes, {
      size: 4,
      hash: createHash('md5').update('aaaa').digest('hex'),
    });
    assert.deepEqual(first.files.Changes, first.files['process/changes.rst']);
    assert.deepEqual(first.files['alias/changes.rst'], first.files.Changes);
    assert.equal(first.bytes, 12);
    assert.equal((await scanArtifacts(dir, cache)).hashed, 0);
    await fs.writeFile(target, 'bbbb');
    const edited = await scanArtifacts(dir, cache);
    assert.equal(edited.hashed, 3);
    assert.notEqual(edited.files.Changes.hash, first.files.Changes.hash);
    assert.deepEqual(edited.files.Changes, edited.files['process/changes.rst']);
    assert.deepEqual(edited.files.Changes, edited.files['alias/changes.rst']);
    await fs.symlink('..', path.join(dir, 'process', 'cycle'));
    await assert.rejects(scanArtifacts(dir, cache), /Corpus directory cycle:/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('inventory detects same-size edits, repairs missing files, and ignores remote extras', () => {
  const hash = 'a'.repeat(32);
  const edited = 'b'.repeat(32);
  const local = {
    unchanged: { size: 4, hash },
    edited: { size: 4, hash: edited },
    missing: { size: 4, hash },
    multipart: { size: 100, hash },
  };
  const remote = {
    unchanged: { size: 4, etag: hash },
    edited: { size: 4, etag: hash },
    multipart: { size: 100, etag: 'multipart-2' },
    obsolete: { size: 4, etag: hash },
  };
  const published = { multipart: { size: 100, hash, etag: 'multipart-2' } };
  assert.deepEqual(selectUploads(local, remote, published), ['edited', 'missing']);
  assert.deepEqual(selectUploads(local, remote, {}), ['edited', 'missing', 'multipart']);
  remote.multipart.etag = 'replacement-2';
  assert.deepEqual(selectUploads(local, remote, published), ['edited', 'missing', 'multipart']);
});

test('hash cache reuses unchanged files but detects same-size edits and added files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deploy-inventory-test-'));
  try {
    const dir = path.join(root, 'repo');
    const cache = path.join(root, 'cache.json');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'source'), 'aaaa');
    const first = await scanArtifacts(dir, cache);
    assert.equal(first.hashed, 1);
    assert.equal((await scanArtifacts(dir, cache)).hashed, 0);
    await fs.writeFile(path.join(dir, 'source'), 'bbbb');
    await fs.writeFile(path.join(dir, 'new'), 'new');
    const edited = await scanArtifacts(dir, cache);
    assert.equal(edited.hashed, 2);
    assert.notEqual(edited.files.source.hash, first.files.source.hash);
    assert.equal(edited.bytes, 7);
    assert.equal((await scanArtifacts(dir, cache, true)).hashed, 2);
    await fs.unlink(path.join(dir, 'new'));
    assert.deepEqual(Object.keys((await scanArtifacts(dir, cache)).files), ['source']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
