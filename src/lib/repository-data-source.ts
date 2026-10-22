import type { FileNode } from '@/types';
import type { LoadedCodeIndex } from './code-index';
import type { FileFetchResult } from './file-fetch-debug';
import type { QuizRequest, QuizSession } from './quiz';

/** Optional host-provided data for the shared repository interface. */
export interface RepositoryDataSource {
  owner: string;
  repo: string;
  revision: string;
  tree(): Promise<FileNode[]>;
  file(path: string, signal?: AbortSignal): Promise<FileFetchResult>;
  index(): Promise<LoadedCodeIndex>;
  quiz?(request: QuizRequest, signal?: AbortSignal): Promise<QuizSession>;
  quizRepository?: string;
  quizRevision?: string;
}

let source: RepositoryDataSource | undefined;

export function registerRepositoryDataSource(next: RepositoryDataSource): void {
  source = next;
}

export function getRepositoryDataSource(
  owner: string,
  repo: string
): RepositoryDataSource | undefined {
  return source?.owner === owner && source.repo === repo ? source : undefined;
}

export function directoryFromTree(tree: FileNode[], path: string): FileNode[] {
  let entries = tree;
  for (const part of path.split('/').filter(Boolean)) {
    entries =
      entries.find((entry) => entry.name === part && entry.type === 'directory')?.children ?? [];
  }
  return entries;
}
