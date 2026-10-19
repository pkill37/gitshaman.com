import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CURATED_REPOS } from '../src/lib/curated-repos';

test('deployment uploads only the diff and repairs deletions on an unchanged deployment', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deploy-integration-'));
  try {
    const repo = CURATED_REPOS[0];
    const prefix = `repos/${repo.owner}/${repo.repo}/${repo.revision}`;
    const inventoryKey = `deployments/inventory/${repo.owner}/${repo.repo}/${repo.revision}.json`;
    const manifestKey = 'deployments/curated-corpus.json';
    const local = path.join(root, prefix);
    const remote = path.join(root, 'remote');
    const audit = path.join(root, 'uploads');
    const bin = path.join(root, 'bin');
    await fs.mkdir(local, { recursive: true });
    await fs.mkdir(bin);
    await fs.copyFile(
      new URL('./fixtures/fake-r2-cli.mjs', import.meta.url),
      path.join(bin, 'aws')
    );
    await fs.chmod(path.join(bin, 'aws'), 0o755);
    await fs.writeFile(path.join(local, 'repo-manifest.json'), JSON.stringify({ tree: [] }));
    await fs.writeFile(path.join(local, 'code-index.sqlite'), 'index');
    await fs.writeFile(path.join(local, 'source.c'), 'aaaa');
    const program = `
      import { CURATED_REPOS } from ${JSON.stringify(new URL('../src/lib/curated-repos.ts', import.meta.url).href)};
      import { runAwsSync } from ${JSON.stringify(new URL('../scripts/deploy-r2.ts', import.meta.url).href)};
      CURATED_REPOS.splice(1);
      await runAwsSync({ bucketName: 'test', accountId: 'test', accessKeyId: 'test', secretAccessKey: 'test' });
    `;
    async function deploy() {
      await fs.writeFile(audit, '');
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url)),
          '--input-type=module',
          '-e',
          program,
        ],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 30_000,
          env: {
            ...process.env,
            PATH: `${bin}${path.delimiter}${process.env.PATH}`,
            FAKE_R2_ROOT: remote,
            FAKE_R2_AUDIT: audit,
          },
        }
      );
      assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
      return (await fs.readFile(audit, 'utf8')).trim().split('\n').filter(Boolean).sort();
    }
    assert.deepEqual(
      await deploy(),
      ['code-index.sqlite', 'repo-manifest.json', 'source.c', inventoryKey, manifestKey].sort()
    );
    assert.deepEqual(await deploy(), []);
    await fs.writeFile(path.join(local, 'source.c'), 'bbbb');
    assert.deepEqual(await deploy(), [inventoryKey, 'source.c'].sort());
    assert.equal(await fs.readFile(path.join(remote, prefix, 'source.c'), 'utf8'), 'bbbb');
    await fs.unlink(path.join(remote, prefix, 'code-index.sqlite'));
    assert.deepEqual(await deploy(), ['code-index.sqlite']);
    assert.deepEqual(await deploy(), []);
    await fs.unlink(path.join(remote, manifestKey));
    assert.deepEqual(await deploy(), [manifestKey]);
    await fs.unlink(path.join(remote, inventoryKey));
    assert.deepEqual(await deploy(), [inventoryKey]);
    assert.deepEqual(await deploy(), []);
    await fs.writeFile(path.join(remote, prefix, 'source.c'), 'cccc');
    assert.deepEqual(await deploy(), ['source.c']);
    await fs.writeFile(path.join(local, 'new.c'), 'new');
    assert.deepEqual(await deploy(), [inventoryKey, manifestKey, 'new.c'].sort());
    assert.deepEqual(await deploy(), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
