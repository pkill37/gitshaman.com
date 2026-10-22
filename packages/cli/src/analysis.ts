import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { buildCodeIndex, type FileTreeNode } from '../../../scripts/code-index-builder';
import { enrichCodeIndexWithClangd } from '../../../scripts/clangd-semantic-index';
import { CODE_INDEX_VERSION } from '../../../src/lib/code-index';
import {
  CLI_VERSION,
  STATE,
  fingerprint,
  git,
  hashes,
  readConfig,
  readEligibleFile,
  readJson,
  selectFiles,
  sha256,
  workingFiles,
  withWriter,
  writeJson,
  type Config,
} from './repository';
import { embedGeneration, embeddingSignature } from './embeddings';

export type Snapshot = {
  version: 1;
  generation: string;
  signature: string;
  rootIdentity: string;
  commit: string;
  committed: boolean;
  createdAt: string;
  files: Record<string, string>;
  settings: Config['analysis'];
  stats: {
    fileCount: number;
    symbolCount: number;
    edgeCount: number;
    truncatedFileCount: number;
    skippedFileCount: number;
    durationMs: number;
  };
  capabilities: Array<Record<string, unknown>>;
  embeddings: 'pending' | 'ready' | 'skipped';
};
export const logger = {
  log: (message: string) => process.stderr.write(`${message}\n`),
  warn: (message: string) => process.stderr.write(`${message}\n`),
};

export function currentGeneration(root: string): { directory: string; snapshot: Snapshot } {
  const pointer = path.join(root, STATE, 'current.json');
  if (!fs.existsSync(pointer)) throw new Error('No analyzed snapshot. Run gitshaman analyze.');
  const current = readJson<{ generation?: unknown } | null>(pointer);
  const generation = current?.generation;
  if (
    typeof generation !== 'string' ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(generation)
  )
    throw new Error('Invalid snapshot pointer.');
  const directory = path.join(root, STATE, 'generations', generation);
  const snapshot = readJson<Snapshot>(path.join(directory, 'snapshot.json'));
  if (!snapshot || snapshot.version !== 1 || snapshot.generation !== generation)
    throw new Error('Incompatible snapshot. Run gitshaman analyze.');
  return { directory, snapshot };
}
export function fileTree(files: string[]): FileTreeNode[] {
  const tree: FileTreeNode[] = [];
  for (const file of files) {
    let nodes = tree;
    const parts = file.split('/');
    parts.forEach((name, index) => {
      const directory = index < parts.length - 1;
      let node = nodes.find((entry) => entry.name === name);
      if (!node) {
        node = {
          name,
          path: parts.slice(0, index + 1).join('/'),
          type: directory ? 'directory' : 'file',
          ...(directory ? { children: [] } : {}),
        };
        nodes.push(node);
      }
      if (directory) nodes = node.children!;
    });
  }
  return tree;
}
export function createRetrieval(directory: string, source: string, files: string[]): void {
  const db = new Database(path.join(directory, 'retrieval.sqlite'));
  try {
    db.exec(`CREATE TABLE Chunks(Id INTEGER PRIMARY KEY, Path TEXT NOT NULL, StartLine INTEGER NOT NULL, EndLine INTEGER NOT NULL, Content TEXT NOT NULL, Hash TEXT NOT NULL);
      CREATE VIRTUAL TABLE ChunkSearch USING fts5(Content, Path, content='Chunks', content_rowid='Id');
      CREATE TABLE Vectors(ChunkId INTEGER PRIMARY KEY, Vector TEXT NOT NULL);
      CREATE TABLE EmbeddingMetadata(Signature TEXT NOT NULL, Dimension INTEGER NOT NULL);`);
    const insert = db.prepare(
      'INSERT INTO Chunks(Path, StartLine, EndLine, Content, Hash) VALUES (?, ?, ?, ?, ?)'
    );
    const search = db.prepare('INSERT INTO ChunkSearch(rowid, Content, Path) VALUES (?, ?, ?)');
    db.transaction(() => {
      for (const file of files) {
        const lines = readEligibleFile(source, file)
          .subarray(0, 64 * 1024)
          .toString('utf8')
          .split('\n');
        for (let start = 0; start < lines.length; start += 70) {
          const end = Math.min(start + 80, lines.length);
          const content = lines.slice(start, end).join('\n');
          const row = insert.run(file, start + 1, end, content, sha256(content));
          search.run(row.lastInsertRowid, content, file);
        }
      }
    })();
  } finally {
    db.close();
  }
}

function committedSources(
  root: string,
  directory: string,
  commit: string,
  config: Config
): { files: string[]; skipped: number } {
  const entries = git(root, ['ls-tree', '-r', '-z', commit]).split('\0').filter(Boolean);
  const blobs = entries.flatMap((entry) => {
    const tab = entry.indexOf('\t');
    const [mode, kind, object] = entry.slice(0, tab).split(' ');
    return kind === 'blob' && /^100(?:644|755)$/.test(mode)
      ? [{ file: entry.slice(tab + 1), object }]
      : [];
  });
  let extra = '';
  const ignoreBlob = blobs.find((entry) => entry.file === '.gitshamanignore');
  if (ignoreBlob) extra = git(root, ['cat-file', 'blob', ignoreBlob.object]);
  const selected = new Set(
    selectFiles(
      blobs.map((entry) => entry.file),
      config.analysis,
      extra
    )
  );
  const files: string[] = [];
  for (const entry of blobs) {
    if (!selected.has(entry.file)) continue;
    const size = Number(git(root, ['cat-file', '-s', entry.object]).trim());
    if (size > 8 * 1024 * 1024) continue;
    const content = execFileSync('git', ['-C', root, 'cat-file', 'blob', entry.object], {
      maxBuffer: 9 * 1024 * 1024,
    });
    if (content.includes(0)) continue;
    const target = path.join(directory, entry.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    files.push(entry.file);
  }
  return { files: files.sort(), skipped: entries.length - files.length };
}

async function updateEmbeddings(
  root: string,
  directory: string,
  snapshot: Snapshot,
  config: Config,
  signal?: AbortSignal
): Promise<void> {
  try {
    await embedGeneration(root, directory, config, signal);
    snapshot.embeddings = 'ready';
  } catch (error) {
    signal?.throwIfAborted();
    if (config.embeddings.provider !== 'ollama') throw error;
    logger.warn(
      `Embeddings skipped: ${error instanceof Error ? error.message : 'provider unavailable'}. Structural analysis is ready; run gitshaman embed after configuring the model.`
    );
    snapshot.embeddings = 'skipped';
  }
}

function hasCompatibleEmbeddings(directory: string, config: Config): boolean {
  const db = new Database(path.join(directory, 'retrieval.sqlite'), { readonly: true });
  try {
    return (
      db.prepare('SELECT Signature FROM EmbeddingMetadata').get()?.Signature ===
      embeddingSignature(config)
    );
  } finally {
    db.close();
  }
}

export async function analyze(
  root: string,
  options: { committed?: boolean; noEmbed?: boolean; force?: boolean; signal?: AbortSignal } = {}
): Promise<Snapshot & { unchanged?: boolean }> {
  return withWriter(root, async () => {
    const started = Date.now();
    const config = readConfig(root);
    const generation = crypto.randomUUID();
    const directory = path.join(root, STATE, 'generations', generation);
    const source = path.join(directory, 'source');
    fs.mkdirSync(source, { recursive: true });
    let published = false;
    try {
      let commit = '';
      try {
        commit = git(root, ['rev-parse', 'HEAD']).trim();
      } catch {
        /* New worktrees can be analyzed before their first commit. */
      }
      if (options.committed && !commit)
        throw new Error('Committed analysis requires at least one Git commit.');
      options.signal?.throwIfAborted();
      const selected = options.committed
        ? committedSources(root, source, commit, config)
        : workingFiles(root, config.analysis);
      if (!options.committed) {
        for (const file of selected.files) {
          const target = path.join(source, file);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, readEligibleFile(root, file));
        }
      }
      const fileHashes = hashes(source, selected.files);
      const signature = fingerprint(fileHashes, config.analysis);
      let previous: Snapshot | undefined;
      try {
        previous = currentGeneration(root).snapshot;
      } catch {
        /* First analysis. */
      }
      if (
        !options.force &&
        previous?.signature === signature &&
        previous.committed === !!options.committed &&
        previous.commit === commit
      ) {
        const previousDirectory = path.join(root, STATE, 'generations', previous.generation);
        if (
          !options.noEmbed &&
          (previous.embeddings !== 'ready' || !hasCompatibleEmbeddings(previousDirectory, config))
        ) {
          await updateEmbeddings(root, previousDirectory, previous, config, options.signal);
          writeJson(path.join(previousDirectory, 'snapshot.json'), previous);
        }
        return { ...previous, unchanged: true };
      }
      const stats = buildCodeIndex(source, fileTree(selected.files), signature, logger, {
        outputPath: path.join(directory, 'code-index.sqlite'),
        identity: { owner: 'local', repo: path.basename(root), revision: commit || 'working-tree' },
        includeGuides: false,
      });
      options.signal?.throwIfAborted();
      if (config.analysis.enrichment === 'auto') {
        await enrichCodeIndexWithClangd(source, stats.dbPath, logger, {
          outputDirectory: path.join(directory, 'compiler'),
          files: selected.files,
          generatedOnly: !!options.committed,
        });
      }
      options.signal?.throwIfAborted();
      const db = new Database(stats.dbPath, { readonly: true });
      let capabilities: Array<Record<string, unknown>>;
      try {
        const table = db
          .prepare("SELECT name FROM sqlite_master WHERE name='AnalysisCapabilities'")
          .get();
        capabilities = table
          ? db
              .prepare(
                'SELECT Language AS language, Feature AS feature, Provider AS provider, Status AS status, Detail AS detail FROM AnalysisCapabilities'
              )
              .all()
          : [];
      } finally {
        db.close();
      }
      createRetrieval(directory, source, selected.files);
      const snapshot: Snapshot = {
        version: 1,
        generation,
        signature,
        rootIdentity: sha256(root),
        commit,
        committed: !!options.committed,
        createdAt: new Date().toISOString(),
        files: fileHashes,
        settings: config.analysis,
        stats: {
          fileCount: stats.fileCount,
          symbolCount: stats.symbolCount,
          edgeCount: stats.edgeCount,
          truncatedFileCount: stats.truncatedFileCount,
          skippedFileCount: selected.skipped,
          durationMs: Date.now() - started,
        },
        capabilities,
        embeddings: 'pending',
      };
      if (!options.noEmbed) {
        await updateEmbeddings(root, directory, snapshot, config, options.signal);
      } else snapshot.embeddings = 'skipped';
      snapshot.stats.durationMs = Date.now() - started;
      writeJson(path.join(directory, 'snapshot.json'), snapshot);
      options.signal?.throwIfAborted();
      writeJson(path.join(root, STATE, 'current.json'), { generation });
      published = true;
      return snapshot;
    } finally {
      if (!published) fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

export function freshness(root: string, snapshot: Snapshot): { stale: boolean; changed: string[] } {
  const config = readConfig(root);
  const selected = workingFiles(root, config.analysis);
  const current = hashes(root, selected.files);
  const changed = [...new Set([...Object.keys(snapshot.files), ...Object.keys(current)])].filter(
    (file) => snapshot.files[file] !== current[file]
  );
  return {
    stale: changed.length > 0 || fingerprint(current, config.analysis) !== snapshot.signature,
    changed,
  };
}
export function checksums(root: string): {
  files: Record<string, string>;
  stale: boolean;
  changed: string[];
} {
  const config = readConfig(root);
  const files = hashes(root, workingFiles(root, config.analysis).files);
  let state = { stale: true, changed: Object.keys(files) };
  try {
    state = freshness(root, currentGeneration(root).snapshot);
  } catch {
    /* No analysis yet. */
  }
  writeJson(path.join(root, STATE, 'checksums.json'), {
    observedAt: new Date().toISOString(),
    files,
  });
  return { files, ...state };
}
export function componentVersions(): Record<string, unknown> {
  return {
    cli: CLI_VERSION,
    index: CODE_INDEX_VERSION,
    parser: 'gitshaman-structural',
    node: process.version,
  };
}
