// GitHub archive helpers for curated repository metadata.

import {
  getGitHubRepoIdentifier,
  finalizeRepositoryMetadata,
  storeDirectoryMetadata,
  getDirectoryMetadata,
  storeTreeStructure,
  hasTreeStructure,
  type FileEntry,
} from './repo-storage';
import type { GitHubApiResponse, FileNode } from '@/types';

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

// Track ongoing downloads to prevent duplicates
const activeDownloads = new Map<string, Promise<void>>();

/**
 * Get download key for tracking active downloads
 */
function getDownloadKey(owner: string, repo: string, branch: string): string {
  return `${owner}/${repo}/${branch}`;
}

/**
 * Download a single curated branch's tree structure.
 */
export async function downloadBranch(
  owner: string,
  repo: string,
  branch: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  const downloadKey = getDownloadKey(owner, repo, branch);
  const identifier = getGitHubRepoIdentifier(owner, repo);

  console.log('[Download Branch] Starting download:', {
    owner,
    repo,
    branch,
    identifier,
    downloadKey,
  });

  // Check if already downloading - use atomic check-and-set to prevent race condition
  const existingDownload = activeDownloads.get(downloadKey);
  if (existingDownload) {
    console.log('[Download Branch] Download already in progress, returning existing promise:', {
      downloadKey,
    });
    return existingDownload;
  }

  // Check if tree structure already exists
  const treeExists = await hasTreeStructure('github', identifier, branch);
  console.log('[Download Branch] Tree structure check:', { identifier, branch, treeExists });
  if (treeExists) {
    console.log('[Download Branch] Tree structure already exists, skipping download');
    onProgress?.({
      phase: 'completed',
      progress: 100,
      message: 'Repository structure already available',
    });
    return;
  }

  // Create download promise with timeout to prevent memory leaks
  const DOWNLOAD_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  const downloadPromise = (async () => {
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        reject(new Error('Download timeout - operation took too long'));
      }, DOWNLOAD_TIMEOUT);
    });

    try {
      // Download complete tree structure (structure only, no file contents)
      console.log('[Download Branch] Starting tree structure download...', { owner, repo, branch });
      onProgress?.({
        phase: 'downloading',
        progress: 0,
        message: 'Fetching repository structure...',
      });
      await Promise.race([
        downloadCompleteTreeStructure(owner, repo, branch, onProgress),
        timeoutPromise,
      ]);
      console.log('[Download Branch] Tree structure download completed successfully', {
        owner,
        repo,
        branch,
      });
    } catch (error) {
      console.error('[Download Branch] Error during download:', { owner, repo, branch, error });
      throw error;
    } finally {
      // Always remove from map when done (success or failure)
      console.log('[Download Branch] Removing from active downloads:', { downloadKey });
      activeDownloads.delete(downloadKey);
    }
  })();

  // Set the promise atomically - if another download started in the meantime, use that one
  const existing = activeDownloads.get(downloadKey);
  if (existing) {
    return existing;
  }
  activeDownloads.set(downloadKey, downloadPromise);

  return downloadPromise;
}

/**
 * Recursively fetch complete tree structure for a repository using GitHub Trees API
 * Builds a complete FileNode tree with all files and directories
 * Uses Trees API which returns ONLY structure metadata, NO file contents
 * Files are marked as isLoaded: false (content not downloaded yet)
 */
async function downloadCompleteTreeStructure(
  owner: string,
  repo: string,
  branch: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<FileNode[]> {
  const identifier = getGitHubRepoIdentifier(owner, repo);

  // Check if tree structure already exists
  if (await hasTreeStructure('github', identifier, branch)) {
    onProgress?.({
      phase: 'completed',
      progress: 100,
      message: 'Tree structure already available',
    });
    return [];
  }

  try {
    console.log('[Tree Structure] Starting download:', { owner, repo, branch, identifier });
    onProgress?.({
      phase: 'downloading',
      progress: 0,
      message: 'Fetching complete repository structure...',
    });

    // Step 1: Get the commit SHA for the branch
    console.log('[Tree Structure] Fetching commit SHA for branch...', { owner, repo, branch });
    const commitUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`;
    const commitResponse = await fetch(commitUrl, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'gitshaman.com',
      },
    });

    if (!commitResponse.ok) {
      console.error('[Tree Structure] Failed to fetch commit:', {
        status: commitResponse.status,
        statusText: commitResponse.statusText,
      });
      if (commitResponse.status === 403) {
        throw new Error('GitHub API rate limit exceeded');
      }
      throw new Error(`Failed to fetch commit: ${commitResponse.statusText}`);
    }

    const commitData = await commitResponse.json();
    const treeSha = commitData.commit.tree.sha;
    console.log('[Tree Structure] Got commit SHA:', { treeSha });

    // Step 2: Get the recursive tree structure (structure only, no file contents)
    console.log('[Tree Structure] Fetching recursive tree...', {
      treeUrl: `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
    });
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`;
    const treeResponse = await fetch(treeUrl, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'gitshaman.com',
      },
    });

    if (!treeResponse.ok) {
      console.error('[Tree Structure] Failed to fetch tree:', {
        status: treeResponse.status,
        statusText: treeResponse.statusText,
      });
      if (treeResponse.status === 403) {
        throw new Error('GitHub API rate limit exceeded');
      }
      throw new Error(`Failed to fetch tree: ${treeResponse.statusText}`);
    }

    const treeData = await treeResponse.json();
    console.log('[Tree Structure] Got tree data:', { totalItems: treeData.tree?.length || 0 });

    if (!treeData.tree || !Array.isArray(treeData.tree)) {
      console.error('[Tree Structure] Invalid tree response:', { treeData });
      throw new Error('Invalid tree response from GitHub API');
    }

    // Step 3: Build FileNode tree structure from flat tree data
    // The tree API returns a flat list, we need to build a hierarchical structure
    const pathMap = new Map<string, FileNode>();
    const rootNodes: FileNode[] = [];

    // First pass: Create all nodes
    for (const item of treeData.tree) {
      // Skip .git directory entries
      if (item.path.includes('.git/') || item.path === '.git') {
        continue;
      }

      const pathParts = item.path.split('/');
      const name = pathParts[pathParts.length - 1];
      // Trees API uses 'tree' for directories and 'blob' for files
      const isDirectory = item.type === 'tree';

      const node: FileNode = {
        name,
        path: item.path,
        type: isDirectory ? 'directory' : 'file',
        size: item.size || 0,
        isExpanded: false,
        isLoaded: false, // Content not downloaded yet
        children: isDirectory ? [] : undefined,
      };

      pathMap.set(item.path, node);
    }

    // Second pass: Build parent-child relationships
    for (const [path, node] of pathMap.entries()) {
      const pathParts = path.split('/');

      if (pathParts.length === 1) {
        // Root level item
        rootNodes.push(node);
      } else {
        // Find parent directory
        const parentPath = pathParts.slice(0, -1).join('/');
        const parent = pathMap.get(parentPath);

        if (parent && parent.type === 'directory' && parent.children) {
          parent.children.push(node);
        }
      }
    }

    // Sort all nodes: directories first, then files, both alphabetically
    const sortNodes = (nodes: FileNode[]): FileNode[] => {
      return nodes
        .sort((a, b) => {
          if (a.type === b.type) {
            return a.name.localeCompare(b.name);
          }
          return a.type === 'directory' ? -1 : 1;
        })
        .map((node) => {
          if (node.children) {
            return { ...node, children: sortNodes(node.children) };
          }
          return node;
        });
    };

    const sortedTree = sortNodes(rootNodes);

    console.log('[Tree Download] Tree structure built:', {
      identifier,
      branch,
      totalNodes: sortedTree.length,
      rootNodes: sortedTree.length,
    });

    // Store the complete tree structure
    console.log('[Tree Download] Storing tree structure...', { identifier, branch });
    await storeTreeStructure('github', identifier, branch, sortedTree);
    console.log('[Tree Download] Tree structure stored successfully', { identifier, branch });

    // Finalize repository metadata to ensure repository is marked as available
    console.log('[Tree Download] Finalizing repository metadata...', { identifier, branch });
    await finalizeRepositoryMetadata('github', identifier, branch);
    console.log('[Tree Download] Repository metadata finalized', { identifier, branch });

    onProgress?.({
      phase: 'completed',
      progress: 100,
      message: 'Complete tree structure fetched and stored',
    });

    return sortedTree;
  } catch (error) {
    console.error('Failed to download complete tree structure:', error);
    throw error;
  }
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
  onProgress?: (progress: DownloadProgress) => void
): Promise<FileEntry[]> {
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
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Directory "${path}" not found`);
      } else if (response.status === 403) {
        const rateLimitReset = response.headers.get('x-ratelimit-reset');
        const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
        const resetTime = rateLimitReset
          ? new Date(parseInt(rateLimitReset) * 1000).toLocaleString()
          : 'unknown';
        throw new Error(
          `GitHub API rate limit exceeded. Remaining: ${rateLimitRemaining}, Resets at ${resetTime}`
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

    console.error(`Failed to download directory ${path}:`, error);
    throw new Error(errorMessage);
  }
}

/**
 * Get download status for a branch
 * Checks if root directory metadata exists (not full branch availability)
 */
export async function getBranchDownloadStatus(
  owner: string,
  repo: string,
  branch: string
): Promise<BranchDownloadStatus> {
  const downloadKey = getDownloadKey(owner, repo, branch);
  const identifier = getGitHubRepoIdentifier(owner, repo);

  const isDownloading = activeDownloads.has(downloadKey);
  // Check if root directory metadata exists (depth=1)
  const rootMetadata = await getDirectoryMetadata('github', identifier, branch, '');
  const isAvailable = rootMetadata !== null && rootMetadata.length > 0;

  return {
    isDownloading,
    isAvailable,
  };
}
