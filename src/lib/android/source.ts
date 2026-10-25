import { buildCuratedRepoUrlForSource, type CuratedRepoSourceMode } from '../curated-content-url';
import { getCuratedRepo } from '../curated-repos';
import {
  CODE_INDEX_VERSION,
  MIN_SUPPORTED_CODE_INDEX_VERSION,
  searchCodeIndexFiles,
  findCodeIndexSymbolsByName,
  buildSearchOccurrences,
  type LoadedCodeIndex,
  type CodeIndexDatabaseLike,
  type CodeIndexFileEntry,
  type CodeIndexSymbolEntry,
} from '../code-index';
import type { FileNode, WorkspaceSearchResult } from '@/types';
import {
  androidSourceTree,
  mergeAndroidTrees,
  androidProjectForPath,
  resolveAndroidAlias,
  safeAndroidPath,
  type AndroidWorkspace,
} from './workspace';

function contentMatches(
  index: LoadedCodeIndex,
  query: string,
  typesOnly = false
): { fileId: number; path: string; content: string }[] {
  const statement = index.db.prepare(
    `SELECT f.Id AS fileId, f.Path AS path, fs.Content AS content FROM FileSearch fs JOIN Files f ON f.Id = fs.rowid WHERE fs.Content LIKE ? ESCAPE '\\' ${typesOnly ? "AND f.Extension IN ('java', 'kt', 'aidl')" : ''} ORDER BY (f.Path LIKE ?) DESC, f.Path LIMIT 200`
  );
  const escaped = query.replace(/[\\%_]/g, '\\$&');
  try {
    statement.bind([`%${escaped}%`, `%/${escaped}.%`]);
    const rows: { fileId: number; path: string; content: string }[] = [];
    while (statement.step()) {
      const row = statement.getAsObject();
      rows.push({
        fileId: Number(row.fileId),
        path: String(row.path),
        content: String(row.content),
      });
    }
    return rows;
  } finally {
    statement.free();
  }
}

function androidTypeDefinitions(index: LoadedCodeIndex, name: string): CodeIndexSymbolEntry[] {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return [];
  const results: CodeIndexSymbolEntry[] = [];
  for (const row of contentMatches(index, name, true)) {
    const masked = row.content.replace(
      /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
      (value) => value.replace(/[^\n]/g, ' ')
    );
    const escaped = name.replace(/[$]/g, '\\$&');
    const pattern = new RegExp(
      `\\b(class|interface|enum|record|object|parcelable|union)\\s+(${escaped})(?![\\w$])`,
      'g'
    );
    for (const match of masked.matchAll(pattern)) {
      const offset = match.index + match[0].lastIndexOf(name);
      const before = row.content.slice(0, offset);
      const line = before.split('\n').length;
      const column = offset - before.lastIndexOf('\n');
      results.push({
        symbolId: 0,
        fileId: row.fileId,
        path: row.path,
        name,
        kind: 'class',
        language: row.path.endsWith('.kt')
          ? 'kotlin'
          : row.path.endsWith('.aidl')
            ? 'aidl'
            : 'java',
        signature: row.content.split('\n')[line - 1].trim(),
        doc: null,
        startLine: line,
        startColumn: column,
        endLine: line,
        endColumn: column + name.length,
        isDefinition: true,
        isDeclaration: false,
      });
    }
  }
  return results;
}

type IndexLease = { index: LoadedCodeIndex; close(): void };
export type AndroidIndexLoader = (
  project: AndroidWorkspace['projects'][number],
  signal?: AbortSignal
) => Promise<IndexLease>;
export class AndroidWorkspaceSource {
  private queue: Promise<unknown> = Promise.resolve();
  private trees = new Map<boolean, FileNode[]>();

  tree(includeManifest = false): FileNode[] {
    if (!this.trees.has(includeManifest)) {
      const source = includeManifest
        ? mergeAndroidTrees([this.tree(), this.metadata.manifestTree])
        : androidSourceTree(this.metadata);
      this.trees.set(includeManifest, source);
    }
    return this.trees.get(includeManifest)!;
  }
  constructor(
    readonly metadata: AndroidWorkspace,
    private readonly baseUrl: string,
    private readonly loadIndex: AndroidIndexLoader = async (project, signal) => {
      const response = await fetch(
        `${baseUrl}/snapshots/${metadata.snapshot}/projects/${project.id}/code-index.sqlite`,
        { signal }
      );
      if (!response.ok)
        throw new Error(`Index unavailable for ${project.path} (${response.status})`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      signal?.throwIfAborted();
      const { default: initSqlJs } = await import('sql.js');
      const SQL = await initSqlJs({ locateFile: (file: string) => `/sqljs/${file}` });
      const db = new SQL.Database(bytes);
      try {
        const statement = db.prepare(
          'SELECT Version, FileCount, BuildSignature, Branch FROM Metadata LIMIT 1'
        );
        try {
          if (!statement.step()) throw new Error('Missing Android index metadata');
          const row = statement.getAsObject();
          const version = Number(row.Version);
          if (version < MIN_SUPPORTED_CODE_INDEX_VERSION || version > CODE_INDEX_VERSION)
            throw new Error('Unsupported Android index version');
          if (row.Branch !== project.commit || Number(row.FileCount) !== project.fileCount)
            throw new Error(`Android index does not match pinned source: ${project.path}`);
          return {
            index: {
              db: db as unknown as CodeIndexDatabaseLike,
              version,
              fileCount: Number(row.FileCount),
              buildSignature: String(row.BuildSignature),
            },
            close: () => db.close(),
          };
        } finally {
          statement.free();
        }
      } catch (error) {
        db.close();
        throw error;
      }
    }
  ) {}

  async file(file: string, signal?: AbortSignal): Promise<{ content: string }> {
    safeAndroidPath(file);
    const target = resolveAndroidAlias(this.metadata, file);
    const project = androidProjectForPath(this.metadata, target);
    const suffix = project ? `projects/${project.id}/tree/${target}` : `manifest/${file}`;
    const response = await fetch(
      `${this.baseUrl}/snapshots/${this.metadata.snapshot}/${suffix.split('/').map(encodeURIComponent).join('/')}`,
      { signal }
    );
    if (!response.ok) throw new Error(`Android file unavailable: ${file} (${response.status})`);
    if (Number(response.headers.get('content-length')) > 2 * 1024 * 1024)
      throw new Error('Android file is too large');
    const content = await response.text();
    if (new Blob([content]).size > 2 * 1024 * 1024) throw new Error('Android file is too large');
    return { content };
  }

  private scan<T>(
    query: (index: LoadedCodeIndex) => T[],
    projectPath?: string,
    signal?: AbortSignal
  ): Promise<T[]> {
    const run = async () => {
      const result: T[] = [];
      for (const project of this.metadata.projects.filter(
        (entry) => !projectPath || entry.path === projectPath
      )) {
        signal?.throwIfAborted();
        const lease = await this.loadIndex(project, signal);
        try {
          signal?.throwIfAborted();
          result.push(...query(lease.index));
        } finally {
          lease.close();
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      signal?.throwIfAborted();
      return result;
    };
    const operation = this.queue.then(run, run);
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async search(
    query: string,
    projectPath?: string,
    signal?: AbortSignal
  ): Promise<CodeIndexFileEntry[]> {
    const results = await this.scan(
      (index) => searchCodeIndexFiles(index, query),
      projectPath,
      signal
    );
    return results
      .sort((a, b) => b.relevanceScore - a.relevanceScore || a.path.localeCompare(b.path))
      .slice(0, 200);
  }
  definitions(query: string, signal?: AbortSignal): Promise<CodeIndexSymbolEntry[]> {
    return this.scan(
      (index) => [
        ...findCodeIndexSymbolsByName(index, query, { definitionOnly: true }),
        ...androidTypeDefinitions(index, query),
      ],
      undefined,
      signal
    ).then((results) => results.slice(0, 200));
  }
  references(query: string, signal?: AbortSignal): Promise<WorkspaceSearchResult[]> {
    // Text occurrences are deliberately heuristic: no compiler binding is claimed.
    return this.scan(
      (index) => {
        const matches: WorkspaceSearchResult[] = [];
        for (const row of contentMatches(index, query)) {
          if (matches.length >= 200) break;
          const content = row.content;
          const lines = content.split('\n');
          for (const occurrence of buildSearchOccurrences(content, query)) {
            const line = lines[occurrence.line - 1];
            const before = line[occurrence.column - 2] ?? '';
            const after = line[occurrence.column - 1 + query.length] ?? '';
            if (
              /[\w$]/.test(before) ||
              /[\w$]/.test(after) ||
              line.slice(occurrence.column - 1, occurrence.column - 1 + query.length) !== query
            )
              continue;
            if (matches.length >= 200) break;
            matches.push({
              file: String(row.path),
              ...occurrence,
              key: `${row.path}:${occurrence.line}:${occurrence.column}`,
              matchType: 'content',
              relevanceScore: 50,
            });
          }
        }
        return matches;
      },
      undefined,
      signal
    ).then((results) => results.slice(0, 200));
  }
}
const sources = new Map<string, Promise<AndroidWorkspaceSource | null>>();
export function getAndroidWorkspaceSource(
  owner: string,
  repo: string,
  revision: string,
  mode: CuratedRepoSourceMode
): Promise<AndroidWorkspaceSource | null> {
  const config = getCuratedRepo(owner, repo);
  if (!config?.androidWorkspace || revision !== config.revision) return Promise.resolve(null);
  const base = buildCuratedRepoUrlForSource(owner, repo, revision, 'android', mode);
  if (!sources.has(base)) {
    const request = (async () => {
      const response = await fetch(`${base}/workspace.json`, {
        signal: AbortSignal.timeout(30_000),
        cache: 'no-cache',
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Unable to load Android workspace (${response.status})`);
      const metadata = (await response.json()) as AndroidWorkspace;
      if (
        metadata.version !== 1 ||
        metadata.owner !== owner ||
        metadata.repo !== repo ||
        metadata.manifestCommit !== revision ||
        !/^[a-f0-9]{64}$/.test(metadata.snapshot) ||
        !Array.isArray(metadata.projects)
      )
        throw new Error('Invalid Android workspace metadata');
      const projectIds = new Set<string>();
      for (const alias of metadata.aliases ?? []) {
        safeAndroidPath(alias.path);
        safeAndroidPath(alias.target);
      }
      for (const project of metadata.projects) {
        safeAndroidPath(project.path);
        safeAndroidPath(project.id);
        if (projectIds.has(project.id) || new URL(project.url).protocol !== 'https:')
          throw new Error('Invalid Android project identity');
        projectIds.add(project.id);
        if (!/^[a-f0-9]{40}$/.test(project.commit))
          throw new Error('Invalid Android project commit');
      }
      return new AndroidWorkspaceSource(metadata, base);
    })();
    sources.set(base, request);
    request.catch(() => sources.delete(base));
  }
  return sources.get(base)!;
}
