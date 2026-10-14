// Curated repository file loading utilities.

import { FileNode, GITHUB_CONFIG } from '@/types';
import { getGitHubRepoIdentifier } from './repo-storage';
import {
  readFileFromStatic,
  getTreeStructureFromStatic,
  getRepositoryMode,
  resolveCorpusPathFromTree,
  isCuratedRepo,
  type CuratedRepoSourceMode,
} from './repo-static';
import { getDefaultCuratedRepoSourceMode } from './curated-content-url';
import { getCuratedRepoRevision } from './curated-repos';
import { debugLog } from './browser-debug';
import type { FileFetchResult } from './file-fetch-debug';
import { isSafeRepositoryPath } from './github-url';
export { sortFileNodes } from './file-tree';

type GitHubConfig = {
  owner: string;
  repo: string;
  branch: string;
  apiBase: string;
  rawBase: string;
  corpusSourceMode: CuratedRepoSourceMode;
};

const MAX_EDITOR_FILE_BYTES = 2 * 1024 * 1024;

let currentConfig: GitHubConfig = {
  ...GITHUB_CONFIG,
  corpusSourceMode: getDefaultCuratedRepoSourceMode(),
};

/**
 * Check if a branch/version is unstable (main or master)
 */
export function isUnstableBranch(branch: string): boolean {
  return branch === 'main' || branch === 'master';
}

/**
 * Filter out unstable branches (main/master) from a list
 */
export function filterUnstableBranches(branches: string[]): string[] {
  return branches.filter((branch) => !isUnstableBranch(branch));
}

/**
 * Get trusted version for a repository
 * Returns the single trusted version for the repo, or empty string if not configured
 * Main/master branches are never included
 */
export function getTrustedVersion(owner: string, repo: string): string {
  return getCuratedRepoRevision(owner, repo);
}

export async function getGitHubDefaultBranch(owner: string, repo: string): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'gitshaman.com' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new GitHubApiError(`Unable to load repository ${owner}/${repo}`, response.status);
  }
  const data = (await response.json()) as { default_branch?: string };
  if (!data.default_branch) {
    throw new GitHubApiError(`Repository ${owner}/${repo} has no default branch`, 404);
  }
  return data.default_branch;
}

/**
 * Set GitHub repository and automatically detect default branch if 'master' or unstable branch is specified
 * Main/master branches are never allowed - will be replaced with first trusted version
 */
export async function setGitHubRepoWithDefaultBranch(
  owner: string,
  repo: string,
  branch: string = 'v6.1',
  options?: { preserveBranch?: boolean }
): Promise<void> {
  if (options?.preserveBranch) {
    currentConfig = { ...currentConfig, owner, repo, branch };
    return;
  }
  // Never allow main/master branches - they are unstable
  if (isUnstableBranch(branch)) {
    const trusted = getTrustedVersion(owner, repo);
    if (trusted) {
      currentConfig = { ...currentConfig, owner, repo, branch: trusted };
      return;
    }
    currentConfig = { ...currentConfig, owner, repo, branch };
    return;
  }

  const trusted = getTrustedVersion(owner, repo);

  if (trusted) {
    // If branch is not the trusted version, use trusted version
    if (trusted !== branch) {
      currentConfig = { ...currentConfig, owner, repo, branch: trusted };
      return;
    }
  }

  currentConfig = { ...currentConfig, owner, repo, branch };
}

export function getCurrentRepoLabel(): string {
  return `${currentConfig.owner}/${currentConfig.repo}`;
}

export function getCurrentBranch(): string {
  return currentConfig.branch;
}

export function setCurrentCorpusSourceMode(sourceMode: CuratedRepoSourceMode): void {
  currentConfig = { ...currentConfig, corpusSourceMode: sourceMode };
}

/**
 * Get repository identifier for current config
 */
export function getRepoIdentifier(owner?: string, repo?: string): string {
  const ownerName = owner || currentConfig.owner;
  const repoName = repo || currentConfig.repo;
  return getGitHubRepoIdentifier(ownerName, repoName);
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

/**
 * Fetch file content from curated static files.
 */
async function tryFetchFileFromStorage(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  sourceMode: CuratedRepoSourceMode
): Promise<FileFetchResult | null> {
  if (path.endsWith('/')) {
    return null;
  }

  try {
    try {
      return await readFileFromStatic(owner, repo, branch, path, { sourceMode });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('File not found:')) {
        const resolvedPath = await resolveCorpusPathFromTree(owner, repo, branch, path, {
          sourceMode,
        });
        if (!resolvedPath || resolvedPath === path) {
          return null;
        }

        try {
          return await readFileFromStatic(owner, repo, branch, resolvedPath, { sourceMode });
        } catch (resolvedError) {
          if (
            resolvedError instanceof Error &&
            resolvedError.message.startsWith('File not found:')
          ) {
            return null;
          }
          if (resolvedError instanceof Error) {
            throw resolvedError;
          }
          return null;
        }
      }
      if (error instanceof Error) {
        throw error;
      }
      return null;
    }
  } catch (error) {
    debugLog('[explorar:file-fetch-storage] error', {
      owner,
      repo,
      branch,
      path,
      sourceMode,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function fetchRepositoryFile(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  options?: {
    sourceMode?: CuratedRepoSourceMode;
    allowGitHubFallback?: boolean;
  }
): Promise<FileFetchResult> {
  const sourceMode = options?.sourceMode ?? currentConfig.corpusSourceMode;
  if (path.endsWith('/') || !isSafeRepositoryPath(path)) {
    throw new GitHubApiError(
      `Failed to load "${path}" from ${sourceMode} for ${owner}/${repo}@${branch}.`,
      404
    );
  }

  if (isCuratedRepo(owner, repo)) {
    const staticResult = await tryFetchFileFromStorage(owner, repo, branch, path, sourceMode);
    if (staticResult) {
      return staticResult;
    }
  }

  // Curated repositories are intentionally served only from their selected
  // corpus source. Runtime raw GitHub loading is for arbitrary repositories.
  if (!isCuratedRepo(owner, repo) || options?.allowGitHubFallback) {
    const rawPath = path.split('/').map(encodeURIComponent).join('/');
    const rawBranch = branch.split('/').map(encodeURIComponent).join('/');
    const rawUrl = new URL(
      `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${rawBranch}/${rawPath}`,
      'https://raw.githubusercontent.com/'
    ).toString();
    try {
      const response = await fetch(rawUrl, { signal: AbortSignal.timeout(15_000) });
      if (response.ok) {
        const contentLength = Number(response.headers.get('content-length'));
        if (Number.isFinite(contentLength) && contentLength > MAX_EDITOR_FILE_BYTES) {
          throw new GitHubApiError(`File is too large to open: ${path}`, 413);
        }
        const content = await response.text();
        if (new Blob([content]).size > MAX_EDITOR_FILE_BYTES) {
          throw new GitHubApiError(`File is too large to open: ${path}`, 413);
        }
        return {
          content,
          debugInfo: {
            enabled: false,
            source: 'github-api',
            requestUrl: rawUrl,
            responseStatus: response.status,
          },
        };
      }
    } catch (error) {
      if (error instanceof GitHubApiError) {
        throw error;
      }
      // Normalize network failures below so callers receive a stable error.
    }
  }

  throw new GitHubApiError(
    `Failed to load "${path}" from ${sourceMode} for ${owner}/${repo}@${branch}.`,
    404
  );
}

export async function fetchFileContent(path: string): Promise<FileFetchResult> {
  // Validate configuration
  if (!currentConfig.owner || !currentConfig.repo) {
    const error = new GitHubApiError(
      `Repository not configured. Please set owner and repo before fetching file content.`,
      400
    );
    throw error;
  }

  if (!path) {
    const error = new GitHubApiError(`File path is required`, 400);
    throw error;
  }

  const mode = getRepositoryMode(currentConfig.owner, currentConfig.repo);
  if (mode === 'curated') {
    const trusted = getTrustedVersion(currentConfig.owner, currentConfig.repo);
    if (trusted && trusted !== currentConfig.branch) {
      throw new GitHubApiError(
        `Invalid branch "${currentConfig.branch}" for ${currentConfig.owner}/${currentConfig.repo}. Only trusted version is allowed: ${trusted}`,
        400
      );
    }
  }

  return fetchRepositoryFile(currentConfig.owner, currentConfig.repo, currentConfig.branch, path, {
    sourceMode: currentConfig.corpusSourceMode,
  });
}

function extractSubtree(tree: FileNode[], path: string): FileNode[] {
  if (!path) {
    return tree;
  }

  const pathParts = path.split('/').filter(Boolean);
  let currentNodes = tree;

  for (const part of pathParts) {
    const node = currentNodes.find((n) => n.name === part && n.type === 'directory');
    if (!node || !node.children) {
      return [];
    }
    currentNodes = node.children;
  }

  return currentNodes;
}

export async function buildFileTree(
  path: string = '',
  options?: {
    sourceMode?: CuratedRepoSourceMode;
    repository?: Pick<GitHubConfig, 'owner' | 'repo' | 'branch'>;
  }
): Promise<FileNode[]> {
  try {
    const { owner, repo, branch } = options?.repository ?? currentConfig;
    const sourceMode = options?.sourceMode ?? currentConfig.corpusSourceMode;
    const mode = getRepositoryMode(owner, repo);

    if (mode === 'curated') {
      const staticTree = await getTreeStructureFromStatic(owner, repo, branch, { sourceMode });
      if (staticTree && staticTree.length > 0) {
        // Extract subtree for requested path
        const subtree = extractSubtree(staticTree, path);

        // Mark all files as loaded (they're available in static files)
        const markAsLoaded = (nodes: FileNode[]): void => {
          for (const node of nodes) {
            if (node.type === 'file') {
              node.isLoaded = true;
            } else if (node.children) {
              markAsLoaded(node.children);
            }
          }
        };
        markAsLoaded(subtree);

        return subtree;
      }
    }

    return [];
  } catch (error) {
    console.error(`Failed to build file tree for path: ${path}`, error);
    return [];
  }
}

/**
 * Get file icon based on type and extension
 */
export function getFileIcon(node: FileNode): string {
  if (node.type === 'directory') {
    return node.isExpanded ? '📂' : '📁';
  }

  const extension = node.name.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'c':
      return '⚙️';
    case 'h':
      return '🔧';
    case 's':
    case 'S':
      return '🔩';
    case 'py':
      return '🐍';
    case 'sh':
      return '🐚';
    case 'md':
      return '📖';
    case 'json':
      return '📋';
    case 'yaml':
    case 'yml':
      return '⚙️';
    default:
      return '📄';
  }
}
