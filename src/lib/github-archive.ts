// GitHub archive helpers for curated repository metadata.

import { getRepositoryDataSource, directoryFromTree } from './repository-data-source';
import { getGitHubRepoIdentifier, storeDirectoryMetadata, type FileEntry } from './repo-storage';
import type { GitHubApiResponse } from '@/types';

export interface DownloadProgress {
  phase: 'downloading' | 'extracting' | 'storing' | 'completed' | 'error';
  progress: number; // 0-100
  message: string;
  bytesDownloaded?: number;
  totalBytes?: number;
  filesProcessed?: number;
  totalFiles?: number;
}

export interface BranchDownloadStatus {
  isDownloading: boolean;
  isAvailable: boolean;
  error?: string;
  lastDownloadAttempt?: number;
}

/**
 * Download one directory's metadata from GitHub. This intentionally avoids the
 * recursive Trees API so arbitrary repositories can render the root quickly and
 * expand deeper directories only when the user asks for them.
 */
export async function downloadDirectoryContents(
  owner: string,
  repo: string,
  branch: string,
  path: string,
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<FileEntry[]> {
  const source = getRepositoryDataSource(owner, repo);
  if (source) {
    signal?.throwIfAborted();
    return directoryFromTree(await source.tree(), path);
  }
  const identifier = getGitHubRepoIdentifier(owner, repo);

  try {
    onProgress?.({
      phase: 'downloading',
      progress: 0,
      message: `Loading directory ${path || 'root'}...`,
    });

    // Encode path segments properly for URL
    const encodedPath = path
      ? path
          .split('/')
          .filter(Boolean)
          .map((segment) => encodeURIComponent(segment))
          .join('/')
      : '';
    const url = encodedPath
      ? `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`
      : `https://api.github.com/repos/${owner}/${repo}/contents?ref=${encodeURIComponent(branch)}`;

    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'gitshaman.com',
      },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `Cannot load ${path ? `directory "${path}"` : 'the repository root'} in ${owner}/${repo}@${branch}. Check that the repository is public and the revision${path ? ' and directory exist' : ' exists'}.`
        );
      } else if (response.status === 403 || response.status === 429) {
        const rateLimitReset = response.headers.get('x-ratelimit-reset');
        const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
        const resetTime = rateLimitReset
          ? new Date(parseInt(rateLimitReset) * 1000).toLocaleString()
          : 'unknown';
        throw new Error(
          rateLimitRemaining === '0' || response.status === 429
            ? `GitHub API rate limit exceeded. Retry after ${resetTime}.`
            : 'GitHub denied this request. Check that the repository and revision are publicly accessible, then retry.'
        );
      } else {
        throw new Error(
          `Failed to fetch directory "${path}": ${response.statusText} (${response.status})`
        );
      }
    }

    const contents: GitHubApiResponse[] = await response.json();

    if (!Array.isArray(contents)) {
      throw new Error(`Expected array of contents, got ${typeof contents}`);
    }

    // Process files and directories
    const files: GitHubApiResponse[] = [];
    const directories: GitHubApiResponse[] = [];

    for (const item of contents) {
      // Skip .git directory only
      if (item.name === '.git' || item.path.includes('/.git/')) {
        continue;
      }

      if (item.type === 'file') {
        files.push(item);
      } else if (item.type === 'dir') {
        directories.push(item);
      }
    }

    // Store directory metadata (no file contents)
    const directoryEntries: FileEntry[] = [
      ...files.map((f) => ({
        name: f.name,
        path: f.path,
        type: 'file' as const,
        size: f.size,
      })),
      ...directories.map((d) => ({
        name: d.name,
        path: d.path,
        type: 'directory' as const,
      })),
    ];
    // Directory metadata is optional for lazy loading, so handle errors gracefully
    try {
      await storeDirectoryMetadata('github', identifier, branch, path, directoryEntries);
    } catch (error) {
      console.warn('Failed to store directory metadata (non-critical):', error);
      // Continue - directory metadata is optional
    }

    onProgress?.({
      phase: 'completed',
      progress: 100,
      message: `Directory loaded (${files.length} files, ${directories.length} directories)`,
      filesProcessed: files.length + directories.length,
      totalFiles: files.length + directories.length,
    });

    return directoryEntries;
  } catch (error) {
    let errorMessage = 'Unknown error occurred';

    if (error instanceof Error) {
      errorMessage = error.message;
    }

    onProgress?.({
      phase: 'error',
      progress: 0,
      message: errorMessage,
    });

    signal?.throwIfAborted();
    console.error(`Failed to download directory ${path}:`, error);
    throw new Error(errorMessage);
  }
}
