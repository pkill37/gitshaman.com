#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveAndroidManifest } from './android-manifest';
import { buildCodeIndex } from './code-index-builder';
import { CURATED_REPOS, type CuratedRepoConfig } from '../src/lib/curated-repos';
import {
  androidSourceTree,
  safeAndroidPath,
  type AndroidWorkspace,
  type AndroidWorkspaceLock,
} from '../src/lib/android/workspace';
import type { FileNode } from '../src/types';

const git = (args: string[], cwd?: string) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 600_000,
  }).trim();
export function androidFileTree(root: string, prefix = ''): FileNode[] {
  return fs
    .readdirSync(path.join(root, prefix), { withFileTypes: true })
    .filter((entry) => entry.name !== '.git' && (entry.isDirectory() || entry.isFile()))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const file = prefix ? `${prefix}/${entry.name}` : entry.name;
      return {
        name: entry.name,
        path: file,
        type: entry.isDirectory() ? 'directory' : 'file',
        ...(entry.isDirectory() ? { children: androidFileTree(root, file) } : {}),
      };
    });
}
function copyTextTree(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const src = path.join(source, entry.name),
      dest = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTextTree(src, dest);
    else if (entry.isFile()) {
      if (fs.statSync(src).size > 2 * 1024 * 1024) continue;
      const bytes = fs.readFileSync(src);
      if (!bytes.includes(0)) fs.writeFileSync(dest, bytes);
    }
  }
}
function copyManifestSource(root: string, destination: string): void {
  const generated = new Set([
    '.git',
    'android',
    'repo-manifest.json',
    '.repo-manifest.json',
    'search-index.json',
  ]);
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (generated.has(entry.name) || entry.name.startsWith('code-index.sqlite')) continue;
    const source = path.join(root, entry.name);
    const target = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTextTree(source, target);
    else if (entry.isFile()) fs.copyFileSync(source, target);
  }
}

export type AndroidBuildOptions = {
  corpusRoot?: string;
  lockRoot?: string;
  refresh?: boolean;
  checkout?: (url: string, revision: string, destination: string) => Promise<string>;
};
async function checkout(url: string, revision: string, destination: string): Promise<string> {
  if (new URL(url).protocol !== 'https:' || revision.startsWith('-'))
    throw new Error('Invalid Android source remote or revision');
  fs.mkdirSync(destination, { recursive: true });
  git(['init', '--quiet'], destination);
  git(['remote', 'add', 'origin', url], destination);
  git(['fetch', '--depth=1', 'origin', revision], destination);
  git(['checkout', '--quiet', '--detach', 'FETCH_HEAD'], destination);
  return git(['rev-parse', 'HEAD'], destination);
}
export async function buildAndroidWorkspace(
  config: CuratedRepoConfig,
  options: AndroidBuildOptions = {}
): Promise<AndroidWorkspace> {
  if (!config.androidWorkspace) throw new Error('Not an Android workspace');
  const corpus = options.corpusRoot ?? path.resolve('repos');
  const lockRoot = options.lockRoot ?? path.resolve('src/curated/android-locks');
  const manifestRoot = path.join(corpus, config.owner, config.repo, config.revision);
  const lockPath = path.join(lockRoot, `${config.id}.json`);
  const existingLock =
    fs.existsSync(lockPath) && !options.refresh
      ? (JSON.parse(fs.readFileSync(lockPath, 'utf8')) as AndroidWorkspaceLock)
      : undefined;
  if (
    existingLock &&
    (existingLock.version !== 1 ||
      existingLock.manifestCommit !== config.revision ||
      existingLock.owner !== config.owner ||
      existingLock.repo !== config.repo)
  )
    throw new Error('Android lockfile identity changed; use --refresh');
  const projects = await resolveAndroidManifest(async (file) => {
    return fs.readFileSync(path.join(manifestRoot, safeAndroidPath(file)), 'utf8');
  }, `https://github.com/${config.owner}/${config.repo}`);
  const selected = config.androidWorkspace.projects.map((mount) => {
    const project = projects.find((entry) => entry.path === mount);
    if (!project) throw new Error(`Required Android project is absent from manifest: ${mount}`);
    return project;
  });
  if (
    existingLock &&
    (existingLock.projects.length !== selected.length ||
      selected.some(
        (project) =>
          !existingLock.projects.some(
            (locked) =>
              JSON.stringify(project) ===
              JSON.stringify({
                path: locked.path,
                name: locked.name,
                url: locked.url,
                revision: locked.revision,
                mappings: locked.mappings,
              })
          )
      ))
  )
    throw new Error('Android manifest selection differs from lockfile; use --refresh');
  if (existingLock) {
    const snapshot = createHash('sha256')
      .update(JSON.stringify({ lock: existingLock, format: 1 }))
      .digest('hex');
    const pointerPath = path.join(manifestRoot, 'android', 'workspace.json');
    if (fs.existsSync(pointerPath)) {
      const current = JSON.parse(fs.readFileSync(pointerPath, 'utf8')) as AndroidWorkspace;
      if (
        current.snapshot === snapshot &&
        current.projects.every((project) =>
          fs.existsSync(
            path.join(
              manifestRoot,
              'android',
              'snapshots',
              snapshot,
              'projects',
              project.id,
              'code-index.sqlite'
            )
          )
        )
      ) {
        // Preserve manifest documentation links as well as the included XML files.
        const manifestDirectory = path.join(
          manifestRoot,
          'android',
          'snapshots',
          snapshot,
          'manifest'
        );
        copyManifestSource(manifestRoot, manifestDirectory);
        current.manifestTree = androidFileTree(manifestDirectory);
        const updated = `${pointerPath}.${process.pid}.tmp`;
        fs.writeFileSync(updated, JSON.stringify(current));
        fs.renameSync(updated, pointerPath);
        return current;
      }
    }
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gitshaman-android-'));
  const stage = path.join(temporary, 'snapshot');
  fs.mkdirSync(stage);
  try {
    const built: AndroidWorkspace['projects'] = [];
    for (const project of selected) {
      const locked = existingLock?.projects.find((entry) => entry.path === project.path);
      const id = project.path.replaceAll('/', '__');
      const clone = path.join(temporary, 'checkouts', id);
      console.log(
        `Android ${config.displayName}: ${project.path}@${locked?.commit ?? project.revision}`
      );
      const commit = await (options.checkout ?? checkout)(
        project.url,
        locked?.commit ?? project.revision,
        clone
      );
      if (!/^[a-f0-9]{40}$/.test(commit) || (locked && locked.commit !== commit))
        throw new Error(`Android checkout mismatch: ${project.path}`);
      const treeRoot = path.join(stage, 'projects', id, 'tree');
      copyTextTree(clone, path.join(treeRoot, project.path));
      const tree = androidFileTree(treeRoot);
      const signature = createHash('sha256')
        .update(JSON.stringify({ project, commit, index: 1 }))
        .digest('hex');
      const stats = buildCodeIndex(treeRoot, tree, signature, console, {
        outputPath: path.join(stage, 'projects', id, 'code-index.sqlite'),
        identity: { owner: config.owner, repo: config.repo, revision: commit },
        includeGuides: false,
      });
      built.push({
        ...project,
        commit,
        id,
        tree,
        fileCount: stats.fileCount,
        truncatedFileCount: stats.truncatedFileCount,
      });
      fs.rmSync(clone, { recursive: true, force: true });
    }
    const lock: AndroidWorkspaceLock = {
      version: 1,
      owner: config.owner,
      repo: config.repo,
      manifestCommit: config.revision,
      projects: built.map(({ path, name, url, revision, mappings, commit }) => ({
        path,
        name,
        url,
        revision,
        mappings,
        commit,
      })),
    };
    const snapshot = createHash('sha256')
      .update(JSON.stringify({ lock, format: 1 }))
      .digest('hex');
    const manifestStage = path.join(stage, 'manifest');
    copyManifestSource(manifestRoot, manifestStage);
    const aliases = built.flatMap((project) =>
      project.mappings.map((mapping) => ({
        path: mapping.dest,
        target: `${project.path}/${mapping.src}`,
      }))
    );
    const workspace: AndroidWorkspace = {
      ...lock,
      snapshot,
      projects: built,
      aliases,
      manifestTree: androidFileTree(manifestStage),
    };
    androidSourceTree(workspace); // Reject conflicting mounts before publishing.
    for (const alias of aliases) {
      const project = built.find((entry) => alias.target.startsWith(`${entry.path}/`));
      if (
        !project ||
        !fs.existsSync(path.join(stage, 'projects', project.id, 'tree', alias.target))
      )
        throw new Error(`Missing Android mapping source: ${alias.target}`);
    }
    const output = path.join(manifestRoot, 'android');
    fs.mkdirSync(path.join(output, 'snapshots'), { recursive: true });
    const snapshotPath = path.join(output, 'snapshots', snapshot);
    if (!fs.existsSync(snapshotPath)) fs.renameSync(stage, snapshotPath);
    else fs.cpSync(stage, snapshotPath, { recursive: true, force: false, errorOnExist: false });
    fs.mkdirSync(lockRoot, { recursive: true });
    const lockTemporary = `${lockPath}.${process.pid}.tmp`;
    fs.writeFileSync(lockTemporary, JSON.stringify(lock, null, 2) + '\n');
    fs.renameSync(lockTemporary, lockPath);
    const pointer = path.join(output, `workspace.${process.pid}.tmp`);
    fs.writeFileSync(pointer, JSON.stringify(workspace));
    fs.renameSync(pointer, path.join(output, 'workspace.json'));
    return workspace;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
async function main() {
  const args = process.argv.slice(2);
  const only = args.find((arg) => arg.startsWith('--only='))?.slice(7);
  const configs = CURATED_REPOS.filter(
    (config) => config.androidWorkspace && (!only || `${config.owner}/${config.repo}` === only)
  );
  if (!configs.length) throw new Error('No matching Android workspace');
  for (const config of configs)
    await buildAndroidWorkspace(config, { refresh: args.includes('--refresh') });
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
