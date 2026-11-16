import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { generateContributions } from '../scripts/curated-contributions';

test('generates equivalent JSON and importable module registries from contributions', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitshaman-registry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  const directory = path.join(root, 'src/curated');
  fs.mkdirSync(directory, { recursive: true });
  const record = {
    version: 1,
    owner: 'fixture',
    repo: 'example',
    revision: 'a'.repeat(40),
    slug: 'fixture-example',
    displayName: 'Example',
    description: 'A "quoted" description.\nWith another line.',
    analyzerVersion: '0.1.0',
    sourceFingerprint: 'b'.repeat(64),
    analysis: { exclude: [], languages: [], enrichment: 'off' },
    summary: { fileCount: 1, symbolCount: 0, edgeCount: 0, truncatedFileCount: 0 },
    capabilities: [],
  };
  fs.writeFileSync(path.join(directory, 'fixture_example.json'), JSON.stringify(record));

  assert.deepEqual(generateContributions(root), [record]);
  const json = JSON.parse(fs.readFileSync(path.join(directory, 'registry.json'), 'utf8'));
  const registryModule = await import(pathToFileURL(path.join(directory, 'registry.ts')).href);
  assert.deepEqual(json, [record]);
  assert.deepEqual(registryModule.default, json);
  // Generated registries must not be mistaken for contribution inputs on reruns.
  assert.deepEqual(generateContributions(root), [record]);
});
