// GitShaman - Type Definitions

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  size?: number;
  isExpanded?: boolean;
  isLoaded?: boolean;
}

export interface EditorTab {
  id: string;
  title: string;
  path: string;
  kind?: 'repo-file';
  isActive: boolean;
  isDirty: boolean;
  viewMode?: 'source' | 'preview';
  content?: string;
  isLoading: boolean;
  scrollToLine?: number; // Line number to scroll to when opening
  searchPattern?: string; // Pattern to search for and highlight
  navigationNonce?: number; // Bumped for repeated navigation to same target
}

export type WorkspaceSearchMatchType = 'filename' | 'quoted' | 'content';

export interface WorkspaceSearchResult {
  file: string;
  line: number;
  column: number;
  preview: string;
  key: string;
  matchType: WorkspaceSearchMatchType;
  relevanceScore: number;
}

export interface GitHubApiResponse {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
  type: 'file' | 'dir';
  content?: string;
  encoding?: string;
}

export interface GitHubTag {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  zipball_url: string;
  tarball_url: string;
  node_id: string;
}

// File System Access API types (for browser compatibility)
declare global {
  interface R2Object {
    body: BodyInit | null;
    writeHttpMetadata(headers: Headers): void;
  }

  interface R2Bucket {
    get(key: string): Promise<R2Object | null>;
  }

  interface PagesFunctionContext<
    Env = unknown,
    Params extends Record<string, string | string[]> = Record<string, string | string[]>,
  > {
    env: Env;
    params: Params;
    request: Request;
  }

  type PagesFunction<
    Env = unknown,
    Params extends Record<string, string | string[]> = Record<string, string | string[]>,
  > = (context: PagesFunctionContext<Env, Params>) => Response | Promise<Response>;

  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: 'read' | 'readwrite';
      startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
    }) => Promise<FileSystemDirectoryHandle>;
  }

  interface FileSystemHandle {
    readonly kind: 'file' | 'directory';
    readonly name: string;
  }

  interface FileSystemFileHandle extends FileSystemHandle {
    readonly kind: 'file';
    getFile(): Promise<File>;
    createWritable(): Promise<FileSystemWritableFileStream>;
  }

  interface FileSystemDirectoryHandle extends FileSystemHandle {
    readonly kind: 'directory';
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    getDirectoryHandle(
      name: string,
      options?: { create?: boolean }
    ): Promise<FileSystemDirectoryHandle>;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
    removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  }

  interface FileSystemWritableFileStream extends WritableStream {
    write(data: string | BufferSource | Blob): Promise<void>;
    close(): Promise<void>;
  }
}

// GitHub API constants
export const GITHUB_CONFIG = {
  owner: 'torvalds',
  repo: 'linux',
  branch: 'v6.1', // Very stable 6.x LTS branch
  apiBase: 'https://api.github.com/repos',
  rawBase: 'https://raw.githubusercontent.com',
} as const;
