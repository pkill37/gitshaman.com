import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { resolveAndroidManifest } from '../scripts/android-manifest';
import { checkAndroidWorkspace } from '../scripts/check-android-workspace';
import { buildAndroidWorkspace } from '../scripts/android-workspace';
import {
  ANDROID_CORE_PROJECTS,
  androidSourceTree,
  resolveAndroidAlias,
  androidUpstreamUrl,
  safeAndroidPath,
} from '../src/lib/android/workspace';
import { AndroidWorkspaceSource } from '../src/lib/android/source';
import { CURATED_REPOS, type CuratedRepoConfig } from '../src/lib/curated-repos';
import type { LoadedCodeIndex } from '../src/lib/code-index';

const sha = 'a'.repeat(40);
const manifest = `<manifest><remote name="github" fetch=".."/><default remote="github" revision="refs/heads/release"/><project path="frameworks/base" name="example/base"><linkfile src="main.ts" dest="main.ts"/></project><include name="extra.xml"/></manifest>`;
const extra = `<manifest><project path="system/core" name="example/core" revision="v1"/></manifest>`;
const read = async (file: string) => ({ 'default.xml': manifest, 'extra.xml': extra })[file]!;

test('Android manifests resolve includes, relative remotes, inherited revisions, extension and removal', async () => {
  const projects = await resolveAndroidManifest(
    async (file) =>
      file === 'default.xml'
        ? manifest.replace(
            '</manifest>',
            '<extend-project name="example/core" revision="v2"/><remove-project name="example/base"/></manifest>'
          )
        : extra,
    'https://github.com/example/manifest'
  );
  assert.equal(projects.length, 1);
  assert.equal(projects[0].url, 'https://github.com/example/core');
  assert.equal(projects[0].revision, 'v2');
  const inherited = await resolveAndroidManifest(read, 'https://github.com/example/manifest');
  assert.equal(inherited[0].revision, 'refs/heads/release');
});

test('Android manifests reject cycles, entities, conflicting projects and unsafe paths', async () => {
  await assert.rejects(
    resolveAndroidManifest(
      async () => '<manifest><include name="default.xml"/></manifest>',
      'https://example.com/manifest'
    ),
    /cycle/
  );
  await assert.rejects(
    resolveAndroidManifest(
      async () => '<!DOCTYPE manifest><manifest/>',
      'https://example.com/manifest'
    ),
    /entities/
  );
  for (const value of ['../escape', '/root', 'a/../b', 'a\\b', 'a//b'])
    assert.throws(() => safeAndroidPath(value));
  await assert.rejects(
    resolveAndroidManifest(
      async () =>
        '<manifest><project name="a" path="same"/><project name="b" path="same"/></manifest>',
      'https://example.com/manifest'
    ),
    /Duplicate/
  );
});

test('both curated manifests select all required core paths and distribution remotes', async () => {
  for (const config of CURATED_REPOS.filter((entry) => entry.androidWorkspace)) {
    const root = path.join('repos', config.owner, config.repo, config.revision);
    if (!fs.existsSync(root)) continue;
    const projects = await resolveAndroidManifest(
      async (file) => fs.readFileSync(path.join(root, file), 'utf8'),
      `https://github.com/${config.owner}/${config.repo}`
    );
    for (const mount of config.androidWorkspace!.projects)
      assert.ok(
        projects.some((entry) => entry.path === mount),
        mount
      );
    assert.ok(
      ANDROID_CORE_PROJECTS.every((mount) => config.androidWorkspace!.projects.includes(mount))
    );
    assert.equal(
      projects.find((entry) => entry.path === 'frameworks/base')!.url,
      `https://github.com/${config.owner}/${config.owner === 'LineageOS' ? 'android_frameworks_base' : 'platform_frameworks_base'}`
    );
  }
});

test('workspace snapshots pin revisions, merge paths, bound index lifetime and preserve publication on failure', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gitshaman-android-test-'));
  try {
    const config: CuratedRepoConfig = {
      ...CURATED_REPOS.find((entry) => entry.androidWorkspace)!,
      id: 'android-fixture',
      owner: 'example',
      repo: 'manifest',
      revision: sha,
      androidWorkspace: { projects: ['frameworks/base', 'system/core'] },
    };
    const corpusRoot = path.join(temporary, 'repos'),
      lockRoot = path.join(temporary, 'locks');
    const root = path.join(corpusRoot, config.owner, config.repo, sha);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'README.md'), 'Manifest documentation');
    fs.writeFileSync(path.join(root, 'default.xml'), manifest);
    fs.writeFileSync(path.join(root, 'extra.xml'), extra);
    const revisions: string[] = [];
    const checkout = async (_url: string, revision: string, dest: string) => {
      revisions.push(revision);
      fs.mkdirSync(dest, { recursive: true });
      fs.writeFileSync(
        path.join(dest, 'main.ts'),
        'export function sharedSymbol() { return 1; }\nsharedSymbol();\n'
      );
      fs.writeFileSync(
        path.join(dest, 'AndroidType.java'),
        '// class Commented {}\npublic final class AndroidType {}\n'
      );
      fs.symlinkSync('/etc/passwd', path.join(dest, 'escape'));
      return sha;
    };
    const workspace = await buildAndroidWorkspace(config, { corpusRoot, lockRoot, checkout });
    assert.ok(workspace.manifestTree.some((entry) => entry.name === 'README.md'));
    assert.equal(workspace.projects.length, 2);
    assert.equal(checkAndroidWorkspace(config, corpusRoot).snapshot, workspace.snapshot);
    assert.deepEqual(
      androidSourceTree(workspace).map((node) => node.name),
      ['frameworks', 'system', 'main.ts']
    );
    assert.equal(resolveAndroidAlias(workspace, 'main.ts'), 'frameworks/base/main.ts');
    assert.equal(
      androidUpstreamUrl(workspace.projects[0], 'frameworks/base/main.ts', 2),
      `https://github.com/example/base/blob/${sha}/main.ts#L2`
    );
    const artifactRoot = path.join(root, 'android', 'snapshots', workspace.snapshot);
    assert.ok(
      !fs.existsSync(
        path.join(artifactRoot, 'projects', 'frameworks__base', 'tree', 'frameworks/base/escape')
      )
    );
    let active = 0,
      maximum = 0;
    const source = new AndroidWorkspaceSource(
      workspace,
      'https://example.test',
      async (project) => {
        active++;
        maximum = Math.max(maximum, active);
        const db = new Database(
          path.join(artifactRoot, 'projects', project.id, 'code-index.sqlite'),
          { readonly: true }
        );
        const adapter = {
          prepare(sql: string) {
            const statement = db.prepare(sql);
            let rows: Record<string, unknown>[] = [],
              position = -1;
            return {
              bind(values: unknown[] = []) {
                rows = statement.bind(...values).all();
                position = -1;
              },
              step() {
                if (!rows.length && position === -1) {
                  try {
                    rows = statement.all();
                  } catch {
                    /* bound queries initialize in bind */
                  }
                }
                return ++position < rows.length;
              },
              getAsObject() {
                return rows[position];
              },
              free() {},
            };
          },
        };
        return {
          index: {
            db: adapter,
            version: 4,
            fileCount: project.fileCount,
            buildSignature: '',
          } satisfies LoadedCodeIndex,
          close() {
            db.close();
            active--;
          },
        };
      }
    );
    const [files, definitions, references] = await Promise.all([
      source.search('sharedSymbol'),
      source.definitions('sharedSymbol'),
      source.references('sharedSymbol'),
    ]);
    assert.equal(files.length, 2);
    assert.equal(definitions.length, 2);
    assert.equal(references.length, 4);
    assert.equal(maximum, 1);
    assert.equal(active, 0);
    assert.equal((await source.search('sharedSymbol', 'system/core')).length, 1);
    const javaTypes = await source.definitions('AndroidType');
    assert.equal(javaTypes.length, 2);
    assert.equal(javaTypes[0].startLine, 2);
    assert.equal((await source.definitions('Commented')).length, 0);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(source.search('sharedSymbol', undefined, controller.signal));
    assert.equal((await source.search('sharedSymbol')).length, 2);
    await buildAndroidWorkspace(config, { corpusRoot, lockRoot, checkout });
    assert.equal(revisions.length, 2, 'unchanged locks reuse the snapshot');
    const pointer = fs.readFileSync(path.join(root, 'android', 'workspace.json'), 'utf8');
    await assert.rejects(
      buildAndroidWorkspace(config, {
        corpusRoot,
        lockRoot,
        refresh: true,
        checkout: async () => {
          throw new Error('network failure');
        },
      }),
      /network failure/
    );
    assert.equal(fs.readFileSync(path.join(root, 'android', 'workspace.json'), 'utf8'), pointer);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
