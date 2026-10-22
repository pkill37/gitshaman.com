import initSqlJs from 'sql.js';
import {
  CODE_INDEX_VERSION,
  type LoadedCodeIndex,
  type CodeIndexDatabaseLike,
} from '../../../src/lib/code-index';
import type { RepositoryDataSource } from '../../../src/lib/repository-data-source';
import type { FileNode } from '../../../src/types';
import type { Snapshot } from '../src/analysis';
import type { SearchResult } from '../src/search';
import type { FileTreeNode } from '../../../scripts/code-index-builder';
import type { QuizRequest, QuizSession } from '../../../src/lib/quiz';

export type LocalStatus = {
  snapshot: Snapshot;
  stale: boolean;
  changed: string[];
  name: string;
  identity: string;
  quizRepository?: string;
};
export class LocalRepositorySource implements RepositoryDataSource {
  readonly owner = 'local';
  repo = 'repository';
  revision = '';
  quizRepository?: string;
  quizRevision?: string;
  private treePromise?: Promise<FileNode[]>;
  private indexPromise?: Promise<LoadedCodeIndex>;
  private snapshot?: Snapshot;
  readonly token: string;
  constructor() {
    const sessionToken = /^#[a-f0-9]{64}$/.test(location.hash) ? location.hash.slice(1) : '';
    this.token = sessionToken || sessionStorage.getItem('gitshaman-session') || '';
    sessionStorage.setItem('gitshaman-session', this.token);
    if (sessionToken) history.replaceState(null, '', location.pathname + location.search);
  }
  private async request(url: string, signal?: AbortSignal): Promise<Response> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal,
    });
    if (!response.ok) {
      const body = await response.text();
      let message = body;
      try {
        message = (JSON.parse(body) as { error?: string }).error ?? body;
      } catch {
        /* Plain text error. */
      }
      throw new Error(message || `Request failed (${response.status}).`);
    }
    return response;
  }
  configure(status: LocalStatus): void {
    this.snapshot = status.snapshot;
    this.repo = `${status.name}-${status.snapshot.rootIdentity.slice(0, 8)}`;
    this.revision = status.snapshot.generation;
    this.quizRepository = status.quizRepository;
    this.quizRevision = status.snapshot.commit;
  }
  async status(): Promise<LocalStatus> {
    return (await this.request('/api/status')).json();
  }
  async quiz(request: QuizRequest, signal?: AbortSignal): Promise<QuizSession> {
    const response = await fetch('/api/quiz', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok) {
      const text = await response.text();
      let message = text;
      try {
        message = JSON.parse(text).error ?? text;
      } catch {
        /* Plain text error. */
      }
      throw new Error(message);
    }
    return response.json();
  }
  tree(): Promise<FileNode[]> {
    return (this.treePromise ??= this.request('/api/tree')
      .then((response) => response.json())
      .then((nodes: FileTreeNode[]) => {
        const convert = (entries: FileTreeNode[]): FileNode[] =>
          entries.map((node) => ({
            name: node.name,
            path: node.path,
            type: node.children ? 'directory' : 'file',
            isLoaded: true,
            children: node.children ? convert(node.children) : undefined,
          }));
        return convert(nodes);
      }));
  }
  async file(file: string, signal?: AbortSignal): Promise<{ content: string }> {
    return (await this.request(`/api/file?path=${encodeURIComponent(file)}`, signal)).json();
  }
  index(): Promise<LoadedCodeIndex> {
    return (this.indexPromise ??= Promise.all([
      this.request('/api/index').then((response) => response.arrayBuffer()),
      initSqlJs({ locateFile: (file) => `/sqljs/${file}` }),
    ]).then(([bytes, SQL]) => ({
      db: new SQL.Database(new Uint8Array(bytes)) as unknown as CodeIndexDatabaseLike,
      version: CODE_INDEX_VERSION,
      fileCount: this.snapshot?.stats.fileCount ?? 0,
      buildSignature: this.snapshot?.signature ?? '',
    })));
  }
  async search(text: string, semantic: boolean, signal: AbortSignal): Promise<SearchResult[]> {
    return (
      await this.request(
        `/api/search?q=${encodeURIComponent(text)}&semantic=${semantic ? 1 : 0}`,
        signal
      )
    ).json();
  }
}
