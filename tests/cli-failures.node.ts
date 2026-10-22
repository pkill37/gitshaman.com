import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { cliFixture } from './helpers/cli-fixture';
import { analyze, currentGeneration } from '../packages/cli/src/analysis';
import {
  embedGeneration,
  embeddingRequest,
  embeddingSignature,
} from '../packages/cli/src/embeddings';
import {
  DEFAULT_CONFIG,
  readConfig,
  sha256,
  withWriter,
  writeJson,
} from '../packages/cli/src/repository';
import { verify } from '../packages/cli/src/verify';
import { search } from '../packages/cli/src/search';
import { serveWorkspace } from '../packages/cli/src/server';

test('writer locks are released after synchronous and asynchronous failures', async (t) => {
  const root = cliFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await assert.rejects(
    withWriter(root, () => {
      throw new Error('sync failure');
    }),
    /sync failure/
  );
  await assert.rejects(
    withWriter(root, async () => {
      throw new Error('async failure');
    }),
    /async failure/
  );
  assert.equal(await withWriter(root, () => 42), 42);
  assert.equal(fs.existsSync(path.join(root, '.gitshaman/writer.lock')), false);
});

test('config validation handles malformed JSON, nulls, invalid endpoints, and non-string API key names', (t) => {
  const root = cliFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'gitshaman.json');
  for (const value of [
    null,
    [],
    {},
    { ...DEFAULT_CONFIG, analysis: null },
    ...[
      'ftp://localhost',
      'https://user:pass@example.com',
      'https://example.com?key=1',
      'https://example.com#key',
      'invalid',
    ].map((endpoint) => ({
      ...DEFAULT_CONFIG,
      embeddings: { ...DEFAULT_CONFIG.embeddings, endpoint },
    })),
    ...[['API_KEY'], 123, null].map((apiKeyEnv) => ({
      ...DEFAULT_CONFIG,
      embeddings: { ...DEFAULT_CONFIG.embeddings, apiKeyEnv },
    })),
    { ...DEFAULT_CONFIG, embeddings: { ...DEFAULT_CONFIG.embeddings, model: ' ' } },
  ]) {
    writeJson(file, value);
    assert.throws(() => readConfig(root), /Invalid gitshaman.json|endpoint|apiKeyEnv/);
  }
  fs.writeFileSync(file, '{');
  assert.throws(() => readConfig(root), /Expected valid JSON/);
  fs.unlinkSync(file);
  assert.throws(() => readConfig(root), /gitshaman init/);
});

test('snapshot pointers reject corrupt and incompatible state', async (t) => {
  const root = cliFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => currentGeneration(root), /No analyzed snapshot/);
  for (const pointer of [null, {}, { generation: '../escape' }, { generation: '-'.repeat(36) }]) {
    writeJson(path.join(root, '.gitshaman/current.json'), pointer);
    assert.throws(() => currentGeneration(root), /Invalid snapshot pointer/);
  }
  fs.unlinkSync(path.join(root, '.gitshaman/current.json'));
  await analyze(root, { noEmbed: true });
  const { directory } = currentGeneration(root);
  writeJson(path.join(directory, 'snapshot.json'), null);
  assert.throws(() => currentGeneration(root), /Incompatible snapshot/);
});

test('unchanged analysis retries skipped embeddings and refreshes a changed model without reindexing', async (t) => {
  const root = cliFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let requests = 0;
  let unavailable = false;
  const provider = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests++;
    if (unavailable) {
      response.writeHead(400).end();
      return;
    }
    const input = JSON.parse(body).input as string[];
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ embeddings: input.map(() => [1, 2, 3]) }));
  });
  t.after(() => {
    provider.closeAllConnections();
    provider.close();
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const address = provider.address();
  assert(address && typeof address !== 'string');
  const config = readConfig(root);
  config.embeddings.endpoint = `http://127.0.0.1:${address.port}`;
  writeJson(path.join(root, 'gitshaman.json'), config);
  const initial = await analyze(root, { noEmbed: true });
  const { directory } = currentGeneration(root);
  const before = fs.readFileSync(path.join(directory, 'code-index.sqlite'));
  const ready = await analyze(root);
  assert.equal(ready.generation, initial.generation);
  assert.equal(ready.embeddings, 'ready');
  const count = requests;
  await analyze(root);
  assert.equal(requests, count, 'compatible embeddings should be reused');
  config.embeddings.model = 'new-model';
  writeJson(path.join(root, 'gitshaman.json'), config);
  const refreshed = await analyze(root);
  assert.equal(refreshed.embeddings, 'ready');
  assert.equal(refreshed.generation, initial.generation);
  assert(requests > count);
  assert.deepEqual(fs.readFileSync(path.join(directory, 'code-index.sqlite')), before);
  config.embeddings.model = 'temporarily-missing';
  writeJson(path.join(root, 'gitshaman.json'), config);
  unavailable = true;
  assert.equal((await analyze(root)).embeddings, 'skipped');
  unavailable = false;
  assert.equal((await analyze(root)).embeddings, 'ready');
  fs.rmSync(path.join(root, '.gitshaman/embedding-cache.sqlite'));
  fs.mkdirSync(path.join(root, '.gitshaman/embedding-cache.sqlite'));
  const retrieval = fs.readFileSync(path.join(directory, 'retrieval.sqlite'));
  await assert.rejects(embedGeneration(root, directory, config));
  assert.deepEqual(fs.readFileSync(path.join(directory, 'retrieval.sqlite')), retrieval);
  assert(!fs.readdirSync(directory).some((file) => file.startsWith('vectors-')));
});

test('OpenRouter embeddings validate authentication, response order, HTTP failures, retry, and cancellation', async (t) => {
  let mode = 'success';
  let calls = 0;
  const provider = http.createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* Drain request. */
    }
    calls++;
    assert.equal(request.headers.authorization, 'Bearer fixture-key');
    if (mode === 'retry' && calls === 1) {
      response.writeHead(503).end();
      return;
    }
    if (mode === 'cancel') {
      response.writeHead(429).end();
      return;
    }
    if (mode === 'error') {
      response.writeHead(401).end();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        data:
          mode === 'duplicate'
            ? [
                { index: 0, embedding: [1, 0] },
                { index: 0, embedding: [0, 1] },
              ]
            : [
                { index: 1, embedding: [0, 1] },
                { index: 0, embedding: [1, 0] },
              ],
      })
    );
  });
  t.after(() => {
    provider.closeAllConnections();
    provider.close();
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const address = provider.address();
  assert(address && typeof address !== 'string');
  const config = structuredClone(DEFAULT_CONFIG);
  config.embeddings = {
    provider: 'openrouter',
    model: 'fixture',
    endpoint: `http://127.0.0.1:${address.port}`,
    apiKeyEnv: 'GITSHAMAN_TEST_EMBEDDING_KEY',
  };
  const previous = process.env.GITSHAMAN_TEST_EMBEDDING_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.GITSHAMAN_TEST_EMBEDDING_KEY;
    else process.env.GITSHAMAN_TEST_EMBEDDING_KEY = previous;
  });
  delete process.env.GITSHAMAN_TEST_EMBEDDING_KEY;
  await assert.rejects(embeddingRequest(config, ['a', 'b']), /apiKeyEnv/);
  assert.equal(calls, 0);
  process.env.GITSHAMAN_TEST_EMBEDDING_KEY = 'fixture-key';
  assert.deepEqual(await embeddingRequest(config, ['a', 'b']), [
    [1, 0],
    [0, 1],
  ]);
  mode = 'duplicate';
  await assert.rejects(embeddingRequest(config, ['a', 'b']), /duplicate indexes/);
  mode = 'error';
  await assert.rejects(embeddingRequest(config, ['a', 'b']), /HTTP 401/);
  mode = 'retry';
  calls = 0;
  await embeddingRequest(config, ['a', 'b']);
  assert.equal(calls, 2);
  mode = 'cancel';
  calls = 0;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50);
  try {
    await assert.rejects(embeddingRequest(config, ['a', 'b'], controller.signal), /cancel|abort/i);
  } finally {
    clearTimeout(timer);
  }
  assert.equal(calls, 1);
  provider.closeAllConnections();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  await assert.rejects(embeddingRequest(config, ['a', 'b']), /provider unavailable/);
});

test('verify detects asset escapes, incompatible indexes, incomplete vectors, and missing metadata', async (t) => {
  const root = cliFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await analyze(root, { noEmbed: true });
  const assets = path.join(root, '.gitshaman/test-assets');
  fs.mkdirSync(assets);
  fs.writeFileSync(path.join(assets, 'cli.js'), 'fixture');
  const manifest = { 'cli.js': sha256('fixture') };
  writeJson(path.join(assets, 'integrity.json'), manifest);
  assert.equal(verify(root, assets).ok, true);
  for (const value of [null, [], {}, { '../gitshaman.json': 'bad' }, { 'cli.js': 'bad' }]) {
    writeJson(path.join(assets, 'integrity.json'), value);
    assert.throws(() => verify(root, assets), /integrity|asset/);
  }
  fs.symlinkSync(path.join(root, 'README.md'), path.join(assets, 'external.js'));
  writeJson(path.join(assets, 'integrity.json'), {
    'external.js': sha256(fs.readFileSync(path.join(root, 'README.md'))),
  });
  assert.throws(() => verify(root, assets), /asset/);
  writeJson(path.join(assets, 'integrity.json'), manifest);
  const { directory } = currentGeneration(root);
  const db = new Database(path.join(directory, 'retrieval.sqlite'));
  t.after(() => db.close());
  db.prepare('INSERT INTO Vectors VALUES (?, ?)').run(1, '[1,0]');
  assert.throws(() => verify(root, assets), /metadata is missing/);
  db.prepare('INSERT INTO EmbeddingMetadata VALUES (?, ?)').run(
    embeddingSignature(readConfig(root)),
    2
  );
  assert.throws(() => verify(root, assets), /incompatible or incomplete/);
  db.exec("INSERT OR REPLACE INTO Vectors SELECT Id, '[1,0]' FROM Chunks");
  assert.equal(verify(root, assets).embeddings, 'ready');
  db.exec('UPDATE EmbeddingMetadata SET Dimension = 3');
  assert.throws(() => verify(root, assets), /dimensions/);
  await assert.rejects(
    search(directory, currentGeneration(root).snapshot, readConfig(root), ''),
    /1–2000/
  );
  await assert.rejects(
    search(directory, currentGeneration(root).snapshot, readConfig(root), 'x'.repeat(2001)),
    /1–2000/
  );
});

test('workspace confines symlinked assets and survives a missing SQLite stream', async (t) => {
  const root = cliFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await analyze(root, { noEmbed: true });
  const assets = path.join(root, '.gitshaman/test-assets');
  fs.mkdirSync(assets);
  fs.writeFileSync(path.join(assets, 'index.html'), '<h1>Workspace</h1>');
  fs.symlinkSync(path.join(root, '.git/config'), path.join(assets, 'config.js'));
  const workspace = await serveWorkspace(root, assets);
  t.after(() => {
    workspace.server.closeAllConnections();
    workspace.server.close();
  });
  assert.equal((await fetch(new URL('/config.js', workspace.url))).status, 404);
  fs.unlinkSync(path.join(currentGeneration(root).directory, 'code-index.sqlite'));
  const response = await fetch(new URL('/api/index', workspace.url), {
    headers: { Authorization: `Bearer ${workspace.token}` },
  });
  assert.equal(response.status, 404);
  assert.equal((await fetch(workspace.url)).status, 200);
});
