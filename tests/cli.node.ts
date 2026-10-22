import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { cliFixture } from './helpers/cli-fixture';
import { analyze, checksums, currentGeneration, freshness } from '../packages/cli/src/analysis';
import { embedGeneration, validateVectors } from '../packages/cli/src/embeddings';
import {
  git,
  initialize,
  readConfig,
  readJson,
  repositoryRoot,
  workingFiles,
  withWriter,
  writeJson,
} from '../packages/cli/src/repository';
import { search } from '../packages/cli/src/search';
import { serveWorkspace } from '../packages/cli/src/server';
import { prepareShare, share, type Github } from '../packages/cli/src/share';
import { mergeContributions } from '../src/lib/curated-repos';
import { validateContribution } from '../src/lib/curated-contribution';

test('init, worktree discovery, exclusions, nested repositories, and symlinks', (t) => {
  const root = cliFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  initialize(root);
  assert.equal(
    fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('.gitshaman/').length,
    2
  );
  assert.equal(repositoryRoot(path.join(root, 'src')), fs.realpathSync(root));
  fs.mkdirSync(path.join(root, 'ignored'));
  fs.writeFileSync(path.join(root, 'ignored/private.ts'), 'secret');
  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=private');
  fs.writeFileSync(path.join(root, 'binary.txt'), Buffer.from([0, 1, 2]));
  fs.symlinkSync(path.join(root, 'src/auth.ts'), path.join(root, 'linked.ts'));
  fs.writeFileSync(path.join(root, 'file with spaces.ts'), 'export const spaced = 1;');
  fs.writeFileSync(path.join(root, '.gitshamanignore'), 'README.md\n');
  const files = workingFiles(root, readConfig(root).analysis).files;
  assert(files.includes('file with spaces.ts'));
  assert(!files.includes('README.md'));
  for (const excluded of ['.env', 'binary.txt', 'linked.ts', 'ignored/private.ts'])
    assert(!files.includes(excluded));
  const linked = path.join(root, '.gitshaman/worktree');
  git(root, ['worktree', 'add', '-b', 'linked', linked]);
  assert.equal(repositoryRoot(path.join(linked, 'src')), fs.realpathSync(linked));
  fs.mkdirSync(path.join(root, 'nested'));
  git(path.join(root, 'nested'), ['init']);
  fs.writeFileSync(path.join(root, 'nested/private.ts'), 'private');
  assert(
    !workingFiles(root, readConfig(root).analysis).files.some((file) => file.startsWith('nested/'))
  );
});

test('analysis generations, retrieval, freshness, committed snapshots, and writer isolation', async (t) => {
  const root = cliFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const initial = await analyze(root, { noEmbed: true });
  assert(initial.stats.symbolCount > 0);
  const unchanged = await analyze(root, { noEmbed: true });
  assert.equal(unchanged.unchanged, true);
  assert.equal(unchanged.generation, initial.generation);
  const { directory } = currentGeneration(root);
  const results = await search(directory, initial, readConfig(root), 'authenticate');
  assert.equal(results[0].path, 'src/auth.ts');
  assert.equal(results[0].snapshot, initial.signature);
  fs.appendFileSync(path.join(root, 'src/auth.ts'), '\nexport const edited = true;');
  const observed = checksums(root);
  assert(observed.stale);
  assert.equal(currentGeneration(root).snapshot.signature, initial.signature);
  assert(freshness(root, initial).changed.includes('src/auth.ts'));
  const committed = await analyze(root, { committed: true, noEmbed: true });
  assert.equal(committed.signature, initial.signature);
  assert(
    !fs
      .readFileSync(path.join(currentGeneration(root).directory, 'source/src/auth.ts'), 'utf8')
      .includes('edited')
  );
  const pointer = fs.readFileSync(path.join(root, '.gitshaman/current.json'), 'utf8');
  await assert.rejects(analyze(root, { signal: AbortSignal.abort(), force: true }), /abort/i);
  assert.equal(fs.readFileSync(path.join(root, '.gitshaman/current.json'), 'utf8'), pointer);
  await withWriter(root, async () => {
    assert.throws(() => withWriter(root, async () => undefined), /writer/);
  });
  assert(!fs.existsSync(path.join(root, '.gitshaman/writer.lock')));
});

test('embedding cache, dimensions, semantic retrieval, and failure preserves existing vectors', async (t) => {
  const root = cliFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let requested = 0;
  let invalid = false;
  const provider = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const data = JSON.parse(body) as { input: string[] };
      requested += data.input.length;
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({ embeddings: data.input.map(() => (invalid ? [0, 0] : [1, 0.5, 0.25])) })
      );
    });
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => provider.close());
  const address = provider.address();
  assert(address && typeof address !== 'string');
  const config = readConfig(root);
  config.embeddings.endpoint = `http://127.0.0.1:${address.port}`;
  writeJson(path.join(root, 'gitshaman.json'), config);
  const snapshot = await analyze(root);
  assert.equal(snapshot.embeddings, 'ready');
  const { directory } = currentGeneration(root);
  const count = requested;
  const repeated = await embedGeneration(root, directory, config);
  assert.equal(repeated.reused, repeated.chunks);
  assert.equal(requested, count);
  const results = await search(directory, snapshot, config, 'authorization', true);
  assert(results.some((row) => row.provider === 'semantic'));
  const previous = fs.readFileSync(path.join(directory, 'retrieval.sqlite'));
  invalid = true;
  config.embeddings.model = 'different-model';
  await assert.rejects(embedGeneration(root, directory, config), /zero/);
  assert.deepEqual(fs.readFileSync(path.join(directory, 'retrieval.sqlite')), previous);
  assert.throws(() => validateVectors([[1, 2], [1]], 2), /dimensions/);
  assert.throws(() => validateVectors([[NaN]], 1), /invalid/);
  await assert.rejects(
    search(directory, snapshot, config, 'authentication', true),
    /Compatible embeddings/
  );
});

test('local server authorizes requests, confines source, and exposes search and index', async (t) => {
  const root = cliFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await analyze(root, { noEmbed: true });
  const assets = path.join(root, '.gitshaman/assets');
  fs.mkdirSync(assets);
  fs.writeFileSync(path.join(assets, 'index.html'), '<h1>Workspace</h1>');
  const { server, url, token } = await serveWorkspace(root, assets);
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const origin = new URL(url).origin;
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await fetch(`${origin}/api/status`)).status, 401);
  assert.equal(
    (
      await fetch(`${origin}/api/status`, {
        headers: { ...headers, Origin: 'https://evil.invalid' },
      })
    ).status,
    403
  );
  assert.equal(
    (await fetch(`${origin}/api/file?path=..%2F.git%2Fconfig`, { headers })).status,
    404
  );
  assert.equal((await fetch(`${origin}/api/file?path=.env`, { headers })).status, 404);
  assert.equal((await fetch(`${origin}/api/status`, { headers })).status, 200);
  assert.equal((await fetch(`${origin}/api/index`, { headers })).status, 200);
  const results = (await (
    await fetch(`${origin}/api/search?q=authenticate`, { headers })
  ).json()) as Array<{ path: string }>;
  assert.equal(results[0].path, 'src/auth.ts');
  assert.equal((await fetch(`${origin}/api/status`, { method: 'POST', headers })).status, 405);
});

test('share submits only a portable recipe, reuses PRs, and rejects uncommitted analysis', async (t) => {
  const root = cliFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await analyze(root, { noEmbed: true });
  const calls: Array<{ args: string[]; input?: unknown }> = [];
  const commit = git(root, ['rev-parse', 'HEAD']).trim();
  let existingPr = false;
  const api: Github = {
    publicGet: async (endpoint) =>
      endpoint.includes('/commits/')
        ? { sha: commit }
        : { private: false, full_name: 'example/fixture', description: 'Fixture source code' },
    gh(args, input) {
      calls.push({ args, input });
      if (args.join(' ') === 'api user') return { login: 'contributor' };
      if (args[0] === 'repo') return '';
      if (args[0] === 'auth') return '';
      if (args[0] === 'pr') {
        if (args[1] === 'list')
          return existingPr
            ? [{ number: 1, url: 'https://github.com/pkill37/gitshaman.com/pull/1' }]
            : [];
        existingPr = true;
        return 'https://github.com/pkill37/gitshaman.com/pull/1';
      }
      const endpoint = args.find((arg) => arg.startsWith('repos/')) ?? '';
      if (endpoint === 'repos/pkill37/gitshaman.com') return { default_branch: 'main' };
      if (endpoint === 'repos/contributor/gitshaman.com')
        return { parent: { full_name: 'pkill37/gitshaman.com' } };
      if (endpoint.includes('/git/ref/heads/main')) return { object: { sha: 'base-commit' } };
      if (endpoint.includes('/git/ref/heads/gitshaman')) throw new Error('Missing branch');
      if (endpoint.includes('/git/commits/')) return { tree: { sha: 'base-tree' } };
      if (endpoint.includes('?recursive=1')) return { tree: [], truncated: false };
      return { sha: 'created-object' };
    },
  };
  await assert.rejects(prepareShare(root, {}, api), /--committed/);
  await analyze(root, { committed: true, noEmbed: true });
  const before = git(root, ['status', '--porcelain']);
  const dry = await share(root, { dryRun: true }, api);
  assert.equal(calls.length, 0);
  assert.equal(dry.dryRun, true);
  const record = dry.record as Record<string, unknown>;
  assert(!JSON.stringify(record).includes(root));
  assert(!('embeddings' in record));
  assert.throws(() => validateContribution({ ...record, token: 'secret' }), /unsupported/);
  assert.throws(() => mergeContributions([], [record, { ...record, owner: 'another' }]), /slug/);
  const result = await share(root, {}, api);
  assert.equal(result.url, 'https://github.com/pkill37/gitshaman.com/pull/1');
  const upload = calls.find(
    (call) => call.args.includes('POST') && call.args.some((arg) => arg.endsWith('/git/trees'))
  );
  assert(upload);
  const payload = upload.input as { tree: Array<{ path: string; content: string }> };
  assert.deepEqual(
    payload.tree.map((file) => file.path),
    ['src/curated/example_fixture.json']
  );
  assert.equal(git(root, ['status', '--porcelain']), before);
  const again = await share(root, {}, api);
  assert.equal(again.unchanged, true);
  assert.equal(
    calls.filter((call) => call.args[0] === 'pr' && call.args[1] === 'create').length,
    1
  );
  const state = readJson<{ url: string }>(path.join(root, '.gitshaman/share.json'));
  assert.equal(state.url, result.url);
  const index = new Database(path.join(currentGeneration(root).directory, 'code-index.sqlite'), {
    readonly: true,
  });
  assert.equal(index.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
  index.close();
});
