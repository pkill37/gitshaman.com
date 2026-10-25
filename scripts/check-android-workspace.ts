import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { CODE_INDEX_VERSION } from '../src/lib/code-index';
import { androidSourceTree, type AndroidWorkspace } from '../src/lib/android/workspace';
import type { CuratedRepoConfig } from '../src/lib/curated-repos';

export function checkAndroidWorkspace(
  config: CuratedRepoConfig,
  corpusRoot: string
): AndroidWorkspace {
  const root = path.join(corpusRoot, config.owner, config.repo, config.revision, 'android');
  const workspace = JSON.parse(
    fs.readFileSync(path.join(root, 'workspace.json'), 'utf8')
  ) as AndroidWorkspace;
  if (
    workspace.version !== 1 ||
    workspace.manifestCommit !== config.revision ||
    workspace.owner !== config.owner ||
    workspace.repo !== config.repo ||
    !/^[a-f0-9]{64}$/.test(workspace.snapshot)
  )
    throw new Error(`Invalid Android snapshot: ${config.id}`);
  if (
    config.androidWorkspace?.projects.some(
      (mount) => !workspace.projects.some((project) => project.path === mount)
    )
  )
    throw new Error(`Incomplete Android coverage: ${config.id}`);
  androidSourceTree(workspace);
  for (const project of workspace.projects) {
    if (!/^[a-f0-9]{40}$/.test(project.commit))
      throw new Error(`Unpinned Android project: ${project.path}`);
    const directory = path.join(root, 'snapshots', workspace.snapshot, 'projects', project.id);
    const db = new Database(path.join(directory, 'code-index.sqlite'), { readonly: true });
    try {
      const metadata = db.prepare('SELECT Version, Branch, FileCount FROM Metadata LIMIT 1').get();
      if (
        metadata?.Version !== CODE_INDEX_VERSION ||
        metadata.Branch !== project.commit ||
        metadata.FileCount !== project.fileCount
      )
        throw new Error(`Stale Android project index: ${project.path}`);
      const files = db.prepare('SELECT Path FROM Files').all();
      for (const file of files) {
        if (!fs.existsSync(path.join(directory, 'tree', String(file.Path))))
          throw new Error(`Missing Android source: ${file.Path}`);
      }
    } finally {
      db.close();
    }
  }
  return workspace;
}
