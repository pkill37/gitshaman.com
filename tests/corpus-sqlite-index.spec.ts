import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';

import { CODE_INDEX_VERSION, MIN_SUPPORTED_CODE_INDEX_VERSION } from '@/lib/code-index';
import { CURATED_REPOS } from '@/lib/curated-repos';
import { buildCodeIndex } from '../scripts/code-index-builder';
import { CORPUS_REPOS_DIR } from '../scripts/static-asset-paths';

type CodeIndexMetadataRow = {
  version: number;
  buildSignature: string;
  createdAt: string;
  owner: string;
  repo: string;
  branch: string;
  fileCount: number;
};

type ManifestTreeNode = {
  name: string;
  type: 'd' | 'f' | 'directory' | 'file';
  children?: ManifestTreeNode[];
};

function getRepoDir(repo: (typeof CURATED_REPOS)[number]): string {
  return path.join(CORPUS_REPOS_DIR, repo.owner, repo.repo, repo.revision);
}

function getCodeIndexPath(repo: (typeof CURATED_REPOS)[number]): string {
  return path.join(getRepoDir(repo), 'code-index.sqlite');
}

function ensureFixtureCodeIndex(): void {
  const repo = CURATED_REPOS.find((entry) => entry.owner === 'littlekernel' && entry.repo === 'lk');
  if (!repo) {
    throw new Error('Missing Little Kernel curated repo config');
  }

  const repoDir = getRepoDir(repo);
  const manifestPath = path.join(repoDir, 'repo-manifest.json');
  const codeIndexPath = getCodeIndexPath(repo);
  if (fs.existsSync(codeIndexPath)) {
    const metadata = readCodeIndexMetadata(codeIndexPath);
    if (metadata.fileCount > 0) {
      return;
    }
  }
  if (!fs.existsSync(manifestPath)) {
    test.skip(true, 'Little Kernel corpus is not available locally');
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    tree: ManifestTreeNode[];
  };
  buildCodeIndex(
    repoDir,
    normalizeManifestTree(manifest.tree),
    `${repo.owner}/${repo.repo}@${repo.revision}`,
    {
      log: () => {},
      warn: () => {},
    }
  );
}

function normalizeManifestTree(nodes: ManifestTreeNode[]): Parameters<typeof buildCodeIndex>[1] {
  return nodes.map((node) => ({
    name: node.name,
    path: node.name,
    type: node.type === 'd' || node.type === 'directory' ? 'directory' : 'file',
    children: node.children ? normalizeManifestTree(node.children) : undefined,
  }));
}

function getIndexedRepos(): typeof CURATED_REPOS {
  return CURATED_REPOS.filter((repo) => fs.existsSync(getCodeIndexPath(repo)));
}

function readCodeIndexMetadata(indexPath: string): CodeIndexMetadataRow {
  const db = new Database(indexPath, { readonly: true, fileMustExist: true });

  try {
    const row = db
      .prepare(
        'SELECT Version as version, BuildSignature as buildSignature, CreatedAt as createdAt, Owner as owner, Repo as repo, Branch as branch, FileCount as fileCount FROM Metadata LIMIT 1'
      )
      .get() as CodeIndexMetadataRow | undefined;

    if (!row) {
      throw new Error('Missing Metadata row');
    }

    return row;
  } finally {
    db.close();
  }
}

function readSqliteObjects(indexPath: string): Set<string> {
  const db = new Database(indexPath, { readonly: true, fileMustExist: true });

  try {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")
      .all() as Array<{ name: string }>;
    return new Set(rows.map((row) => row.name));
  } finally {
    db.close();
  }
}

test.describe('Corpus SQLite index', () => {
  test.beforeAll(() => {
    ensureFixtureCodeIndex();
  });

  test('exists for the local indexed corpus fixture', () => {
    const indexedRepos = getIndexedRepos();
    expect(indexedRepos.length, 'expected at least one local code index fixture').toBeGreaterThan(
      0
    );

    for (const repo of indexedRepos) {
      const repoDir = getRepoDir(repo);
      const manifestPath = path.join(repoDir, 'repo-manifest.json');
      const codeIndexPath = getCodeIndexPath(repo);

      expect(
        fs.existsSync(repoDir),
        `missing repo dir for ${repo.owner}/${repo.repo}`
      ).toBeTruthy();
      expect(
        fs.existsSync(manifestPath),
        `missing manifest for ${repo.owner}/${repo.repo}`
      ).toBeTruthy();
      expect(
        fs.existsSync(codeIndexPath),
        `missing code index for ${repo.owner}/${repo.repo}`
      ).toBeTruthy();
    }
  });

  test('metadata matches the curated repo revision', () => {
    for (const repo of getIndexedRepos()) {
      const codeIndexPath = getCodeIndexPath(repo);
      const metadata = readCodeIndexMetadata(codeIndexPath);

      expect(metadata.version, `${repo.owner}/${repo.repo}`).toBeGreaterThanOrEqual(
        MIN_SUPPORTED_CODE_INDEX_VERSION
      );
      expect(metadata.version, `${repo.owner}/${repo.repo}`).toBeLessThanOrEqual(
        CODE_INDEX_VERSION
      );
      expect(metadata.owner, `${repo.owner}/${repo.repo}`).toBe(repo.owner);
      expect(metadata.repo, `${repo.owner}/${repo.repo}`).toBe(repo.repo);
      expect(metadata.branch, `${repo.owner}/${repo.repo}`).toBe(repo.revision);
      expect(metadata.fileCount, `${repo.owner}/${repo.repo}`).toBeGreaterThan(0);
      expect(metadata.buildSignature, `${repo.owner}/${repo.repo}`).toContain(repo.revision);
      expect(metadata.createdAt, `${repo.owner}/${repo.repo}`).toContain('T');
    }
  });

  test('schema includes milestone zero knowledge-base tables', () => {
    for (const repo of getIndexedRepos()) {
      const codeIndexPath = getCodeIndexPath(repo);
      const metadata = readCodeIndexMetadata(codeIndexPath);
      const sqliteObjects = readSqliteObjects(codeIndexPath);

      const requiredTableNames = ['Files', 'Symbols', 'References', 'FileSearch', 'SymbolSearch'];
      const v3TableNames = ['Edges', 'GuideLinks', 'Concepts', 'ConceptLinks'];

      for (const tableName of [
        ...requiredTableNames,
        ...(metadata.version >= 3 ? v3TableNames : []),
      ]) {
        expect(
          sqliteObjects.has(tableName),
          `${repo.owner}/${repo.repo} missing ${tableName}`
        ).toBe(true);
      }
    }
  });
});
