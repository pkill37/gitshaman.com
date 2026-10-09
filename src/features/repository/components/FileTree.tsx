'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import SidebarSearchHeader from './SidebarSearchHeader';
import { FileNode, WorkspaceSearchResult } from '@/types';
import {
  buildFileTree,
  getFileIcon,
  sortFileNodes,
  getCurrentRepoLabel,
  getCurrentBranch,
  getTrustedVersion,
} from '@/lib/github-api';
import { getTreeStructure, getGitHubRepoIdentifier } from '@/lib/repo-storage';
import { isCuratedRepo } from '@/lib/repo-static';

interface FileTreeProps {
  onFileSelect: (path: string) => void;
  selectedFile?: string;
  listDirectory?: (path: string) => Promise<FileNode[]>;
  titleLabel?: string;
  onDirectoryExpand?: (path: string) => void;
  expandDirectoryRequest?: { path: string; id: number } | null;
  searchQuery?: string;
  searchIsRegex?: boolean;
  onSearchQueryChange?: (query: string) => void;
  onSearchIsRegexChange?: (isRegex: boolean) => void;
  searchResults?: WorkspaceSearchResult[];
  isSearchLoading?: boolean;
  isSearchIndexLoading?: boolean;
  isSearchIndexReady?: boolean;
  searchIndexProgress?: number;
  searchIndexCached?: boolean;
  searchError?: string | null;
  searchHasMore?: boolean;
  searchScopeLabel?: string;
  searchScopeFileCount?: number;
  onSearchResultSelect?: (result: WorkspaceSearchResult) => void;
  showSearch?: boolean;
}

interface FileTreeItemProps {
  node: FileNode;
  level: number;
  onFileSelect: (path: string) => void;
  selectedFile?: string;
  listDirectory?: (path: string) => Promise<FileNode[]>;
  onDirectoryExpand?: (path: string) => void;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string, isExpanded: boolean) => void;
}

function isSearchPlaceholderMatch(match: WorkspaceSearchResult): boolean {
  return (
    match.line === 1 &&
    match.column === 1 &&
    (match.preview === 'Source match' || match.preview === 'Documentation match')
  );
}

function markLoadedDirectories(nodes: FileNode[]): FileNode[] {
  return nodes.map((node) => ({
    ...node,
    isLoaded: node.type === 'directory' ? true : node.isLoaded,
    children: node.children ? markLoadedDirectories(node.children) : node.children,
  }));
}

function updateDirectoryChildren(
  nodes: FileNode[],
  targetPath: string,
  children: FileNode[]
): FileNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath && node.type === 'directory') {
      return {
        ...node,
        children,
        isLoaded: true,
      };
    }

    return {
      ...node,
      children: node.children
        ? updateDirectoryChildren(node.children, targetPath, children)
        : node.children,
    };
  });
}

const FileTreeItem: React.FC<FileTreeItemProps> = ({
  node,
  level,
  onFileSelect,
  selectedFile,
  listDirectory,
  onDirectoryExpand,
  expandedPaths,
  onToggleExpand,
}) => {
  // Use centralized expandedPaths state instead of local state
  const normalizedPath = node.path.replace(/\/+$/, '');
  const isExpanded = expandedPaths.has(normalizedPath);
  const initialChildren = node.children || [];
  const [loadedChildren, setLoadedChildren] = useState<FileNode[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);
  const children = loadedChildren ?? initialChildren;
  const isLoaded = node.isLoaded || loadedChildren !== null;

  const handleToggle = async () => {
    if (node.type === 'file') {
      // File clicked - select it and notify parent
      onFileSelect(node.path);
      return;
    }

    // Directory clicked - toggle expansion
    const newExpandedState = !isExpanded;

    // Load directory contents if not already loaded
    if (newExpandedState && !isLoaded) {
      setIsLoading(true);
      try {
        const childNodes = listDirectory
          ? await listDirectory(node.path)
          : await buildFileTree(node.path);
        setLoadedChildren(childNodes);
        if (onDirectoryExpand) {
          onDirectoryExpand(node.path);
        }
      } catch (error) {
        console.error('Failed to load directory:', error);
        // Don't expand if loading failed
        return;
      } finally {
        setIsLoading(false);
      }
    }

    // Update centralized expansion state
    onToggleExpand(normalizedPath, newExpandedState);
  };

  const handleIconClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleToggle();
  };

  // Normalize paths for comparison (remove trailing slashes)
  const normalizePath = (path: string) => path.replace(/\/+$/, '');
  const selectedPath = normalizePath(selectedFile || '');
  const currentPath = normalizePath(node.path);
  const isSelected =
    !!selectedPath && (currentPath === selectedPath || currentPath.startsWith(`${selectedPath}/`));

  return (
    <div>
      <div
        ref={itemRef}
        data-file-path={node.path}
        className={`vscode-file-item ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: `${level * 20 + 8}px` }}
        onClick={handleToggle}
      >
        <span
          className="icon"
          onClick={handleIconClick}
          style={{
            cursor: 'pointer',
            userSelect: 'none',
            display: 'inline-block',
            minWidth: '16px',
          }}
          title={
            node.type === 'directory'
              ? isExpanded
                ? 'Collapse directory'
                : 'Expand directory'
              : 'Open file'
          }
        >
          {isLoading ? (
            <div className="vscode-spinner" style={{ width: '12px', height: '12px' }} />
          ) : (
            getFileIcon({ ...node, isExpanded })
          )}
        </span>
        <span className="name">{node.name}</span>
      </div>

      {isExpanded && children.length > 0 && (
        <div>
          {sortFileNodes(children).map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              level={level + 1}
              onFileSelect={onFileSelect}
              selectedFile={selectedFile}
              listDirectory={listDirectory}
              onDirectoryExpand={onDirectoryExpand}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FileTree: React.FC<FileTreeProps> = ({
  onFileSelect,
  selectedFile,
  listDirectory,
  onDirectoryExpand,
  expandDirectoryRequest,
  searchQuery = '',
  searchIsRegex = false,
  onSearchQueryChange,
  onSearchIsRegexChange,
  searchResults = [],
  isSearchLoading = false,
  isSearchIndexLoading = false,
  isSearchIndexReady = false,
  searchIndexProgress = 0,
  searchIndexCached = false,
  searchError = null,
  searchHasMore = false,
  searchScopeLabel,
  searchScopeFileCount,
  onSearchResultSelect,
  showSearch = true,
}) => {
  const [rootNodes, setRootNodes] = useState<FileNode[]>([]);
  const [completeTree, setCompleteTree] = useState<FileNode[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track expanded paths in centralized state
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const handledRequestRef = useRef<number | null>(null);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const normalizedSearchQuery = searchQuery.trim();

  const clampedSearchIndexProgress = Math.max(0, Math.min(100, searchIndexProgress));
  const shouldShowSearchIndexIndicator =
    showSearch && (isSearchIndexLoading || isSearchIndexReady || !!searchError);
  const rootNodeVersion = rootNodes.length;
  const searchIndexStatusLabel = isSearchIndexReady
    ? searchIndexCached
      ? 'Cached index ready'
      : 'Index ready'
    : isSearchIndexLoading
      ? `${clampedSearchIndexProgress.toFixed(1)}% loaded`
      : searchError
        ? 'Index unavailable'
        : '';
  const searchIndexBadgeLabel = searchIndexCached
    ? 'cached'
    : isSearchIndexLoading
      ? 'loading'
      : searchError
        ? 'error'
        : 'ready';
  const searchMeta =
    showSearch && normalizedSearchQuery && !isSearchIndexLoading ? (
      <div className="vscode-tree-search-meta">
        {isSearchLoading ? (
          <span>
            Searching {searchScopeFileCount ?? 'all'} file
            {(searchScopeFileCount ?? 0) === 1 ? '' : 's'}
            {searchScopeLabel ? ` in ${searchScopeLabel}` : ''}…
          </span>
        ) : searchError ? (
          <span>{searchError}</span>
        ) : (
          <span>
            {searchResults.length} match{searchResults.length === 1 ? '' : 'es'}
            {searchHasMore ? ' (showing first 200)' : ''}
          </span>
        )}
      </div>
    ) : null;
  const shouldShowHeader =
    (showSearch && !!onSearchQueryChange) || shouldShowSearchIndexIndicator || !!searchMeta;

  const groupedSearchResults = useMemo(() => {
    const groups = new Map<
      string,
      {
        file: string;
        fileName: string;
        directory: string;
        matches: WorkspaceSearchResult[];
      }
    >();

    for (const result of searchResults) {
      const existing = groups.get(result.file);
      if (existing) {
        existing.matches.push(result);
        continue;
      }

      const lastSlashIndex = result.file.lastIndexOf('/');
      groups.set(result.file, {
        file: result.file,
        fileName: lastSlashIndex === -1 ? result.file : result.file.slice(lastSlashIndex + 1),
        directory: lastSlashIndex === -1 ? '' : result.file.slice(0, lastSlashIndex),
        matches: [result],
      });
    }

    return Array.from(groups.values());
  }, [searchResults]);

  // Handler to toggle directory expansion
  const handleToggleExpand = useCallback((path: string, isExpanded: boolean) => {
    setExpandedPaths((prev) => {
      const newSet = new Set(prev);
      const normalizedPath = path.replace(/\/+$/, '');
      if (isExpanded) {
        newSet.add(normalizedPath);
      } else {
        newSet.delete(normalizedPath);
      }
      return newSet;
    });
  }, []);

  // Helper function to find node in tree by path
  const findNodeInTree = useCallback((tree: FileNode[], path: string): FileNode | null => {
    if (!path) return null;

    // Normalize path for comparison (remove trailing slashes)
    const normalizedPath = path.replace(/\/+$/, '');
    const pathParts = normalizedPath.split('/').filter(Boolean);
    let currentNodes = tree;

    // Navigate through the tree by matching path segments
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      // Find node by matching name and type (directory for intermediate segments)
      const node = currentNodes.find((n) => {
        // For intermediate segments, must be a directory
        // For the last segment, can be either file or directory
        if (i < pathParts.length - 1 && n.type !== 'directory') {
          return false;
        }
        // Match by name - the path will be built incrementally
        return n.name === part;
      });

      if (!node) {
        return null;
      }

      // If this is the last part, return the node
      if (i === pathParts.length - 1) {
        // Verify the path matches (handle edge cases)
        const nodePathNormalized = node.path.replace(/\/+$/, '');
        if (nodePathNormalized === normalizedPath) {
          return node;
        }
        // If path doesn't match exactly, still return if name matches (for robustness)
        return node;
      }

      // Must be a directory to continue
      if (node.type !== 'directory' || !node.children) {
        return null;
      }

      currentNodes = node.children;
    }

    return null;
  }, []);

  // Load tree structure once on mount
  useEffect(() => {
    const loadTreeStructure = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Try to load complete tree structure from storage
        try {
          const repoLabel = getCurrentRepoLabel();
          if (repoLabel) {
            const [owner, repo] = repoLabel.split('/');
            const branch = getCurrentBranch();
            const identifier = getGitHubRepoIdentifier(owner, repo);

            const storedTree =
              isCuratedRepo(owner, repo) && getCurrentBranch() === getTrustedVersion(owner, repo)
                ? await getTreeStructure('github', identifier, branch)
                : null;

            if (storedTree && storedTree.length > 0) {
              // Mark all directories as loaded since we have the complete structure
              const loadedTree = markLoadedDirectories(storedTree);
              setCompleteTree(loadedTree);
              setRootNodes(loadedTree);
              return; // Successfully loaded complete tree
            }
          }
        } catch (storageError) {
          console.warn('Failed to load complete tree from storage, falling back:', storageError);
        }

        // Fallback: load tree via buildFileTree.
        // For curated repos this returns the full manifest tree (all children populated).
        // Set completeTree so subsequent directory expansions use in-memory data
        // instead of re-fetching the manifest on every click.
        const nodes = listDirectory ? await listDirectory('') : await buildFileTree('');
        const hasPopulatedDirs = nodes.some(
          (n) => n.type === 'directory' && n.children !== undefined
        );
        if (hasPopulatedDirs) {
          const loadedNodes = markLoadedDirectories(nodes);
          setRootNodes(loadedNodes);
          setCompleteTree(loadedNodes);
        } else {
          setRootNodes(nodes);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file tree');
        console.error('Failed to load tree structure:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadTreeStructure();
  }, [listDirectory]);

  useEffect(() => {
    const expandPath = async (path: string) => {
      const normalized = path.replace(/\/+$/, '');
      if (!normalized) return;
      const segments = normalized.split('/');
      let didChange = false;
      const pathsToExpand = new Set<string>();

      // If we have the complete tree in memory, use it for instant synchronous expansion
      if (completeTree) {
        for (let i = 0; i < segments.length; i++) {
          const currentPath = segments.slice(0, i + 1).join('/');
          const normalizedCurrentPath = currentPath.replace(/\/+$/, '');

          // Find node in complete tree
          const node = findNodeInTree(completeTree, currentPath);

          if (!node || node.type !== 'directory') {
            break;
          }

          if (!expandedPaths.has(normalizedCurrentPath)) {
            pathsToExpand.add(normalizedCurrentPath);
            didChange = true;
          }
        }
      } else {
        // Fallback: original sequential loading approach
        let currentNodes = rootNodes;
        for (let i = 0; i < segments.length; i++) {
          const currentPath = segments.slice(0, i + 1).join('/');
          const normalizedCurrentPath = currentPath.replace(/\/+$/, '');
          const node = currentNodes.find((n) => n.path === currentPath);
          if (!node || node.type !== 'directory') {
            break;
          }

          if (!node.isLoaded) {
            try {
              const childNodes = listDirectory
                ? await listDirectory(node.path)
                : await buildFileTree(node.path);
              setRootNodes((prev) => updateDirectoryChildren(prev, node.path, childNodes));
              didChange = true;
              currentNodes = childNodes;
            } catch (err) {
              console.error('Failed to auto-expand directory:', err);
              break;
            }
          } else {
            currentNodes = node.children || [];
          }

          // Add to expanded paths if not already expanded
          if (!expandedPaths.has(normalizedCurrentPath)) {
            pathsToExpand.add(normalizedCurrentPath);
            didChange = true;
          }
        }
      }

      if (didChange || pathsToExpand.size > 0) {
        // Update expanded paths state
        if (pathsToExpand.size > 0) {
          setExpandedPaths((prev) => {
            const newSet = new Set(prev);
            pathsToExpand.forEach((path) => newSet.add(path));
            return newSet;
          });
        }
      }
    };

    if (!expandDirectoryRequest) return;
    if (rootNodes.length === 0) return;
    if (expandDirectoryRequest.id === handledRequestRef.current) return;
    handledRequestRef.current = expandDirectoryRequest.id;
    expandPath(expandDirectoryRequest.path);
  }, [
    expandDirectoryRequest,
    listDirectory,
    expandedPaths,
    rootNodes,
    completeTree,
    findNodeInTree,
  ]);

  // Smooth scroll to selected file/folder when it changes
  useEffect(() => {
    if (showSearch) return;
    if (!selectedFile || !treeContainerRef.current) return;

    // Clear any pending scroll timeout
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    // Normalize the path (remove trailing slashes) for comparison
    const normalizedPath = selectedFile.replace(/\/+$/, '');

    // Function to find and scroll to the element
    const scrollToElement = () => {
      if (!treeContainerRef.current) return;

      // Try exact match first (normalized path)
      let targetElement = treeContainerRef.current.querySelector(
        `[data-file-path="${normalizedPath}"]`
      ) as HTMLElement;

      // If not found, try with trailing slash (for directories)
      if (!targetElement) {
        const pathWithSlash = `${normalizedPath}/`;
        targetElement = treeContainerRef.current.querySelector(
          `[data-file-path="${pathWithSlash}"]`
        ) as HTMLElement;
      }

      // If still not found, try the original path
      if (!targetElement && selectedFile !== normalizedPath) {
        targetElement = treeContainerRef.current.querySelector(
          `[data-file-path="${selectedFile}"]`
        ) as HTMLElement;
      }

      if (targetElement) {
        const treeContainer = treeContainerRef.current;
        const containerRect = treeContainer.getBoundingClientRect();
        const targetRect = targetElement.getBoundingClientRect();
        const centeredTop =
          treeContainer.scrollTop +
          targetRect.top -
          containerRect.top -
          (containerRect.height - targetRect.height) / 2;

        treeContainer.scrollTo({
          top: Math.max(0, centeredTop),
          behavior: 'smooth',
        });
        return true; // Element found and scrolled
      }
      return false; // Element not found yet
    };

    // Wait for directory expansion to complete, then scroll
    // Use multiple retries to handle async directory loading
    const attemptScroll = (attempt: number = 0) => {
      const maxAttempts = 5;
      const delay = 200 + attempt * 200; // Increasing delays: 200ms, 400ms, 600ms, etc.

      scrollTimeoutRef.current = setTimeout(() => {
        const found = scrollToElement();
        // If not found and we haven't exceeded max attempts, try again
        if (!found && attempt < maxAttempts) {
          attemptScroll(attempt + 1);
        }
      }, delay);
    };

    // Start attempting to scroll
    attemptScroll();

    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [selectedFile, rootNodeVersion, showSearch]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      {shouldShowHeader && (
        <SidebarSearchHeader
          query={searchQuery}
          onQueryChange={onSearchQueryChange ?? (() => undefined)}
          placeholder="Search all files"
          ariaLabel="Search all files"
          searchVisible={showSearch && !!onSearchQueryChange}
          isRegex={searchIsRegex}
          onRegexChange={onSearchIsRegexChange}
          statusVisible={shouldShowSearchIndexIndicator}
          statusLoading={isSearchIndexLoading}
          statusReady={isSearchIndexReady}
          statusCached={searchIndexCached}
          statusError={!!searchError}
          statusProgress={isSearchIndexReady ? 100 : clampedSearchIndexProgress}
          statusLabel={searchIndexStatusLabel || 'Loading repository index'}
          statusBadgeLabel={searchIndexBadgeLabel}
          meta={searchMeta}
        />
      )}
      <div
        ref={treeContainerRef}
        className={isLoading || error ? undefined : 'vscode-file-tree'}
        tabIndex={isLoading || error ? undefined : 0}
        role="region"
        aria-label={showSearch ? 'Repository file search results' : 'Repository file tree'}
        style={{ flex: 1, minHeight: 0 }}
      >
        {isLoading ? (
          <div className="vscode-loading">
            <div className="vscode-spinner" />
            <div>Loading source tree...</div>
          </div>
        ) : error ? (
          <div className="vscode-loading">
            <div>⚠️ Failed to load</div>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>{error}</div>
          </div>
        ) : showSearch ? (
          <div className="vscode-tree-search-results">
            {!normalizedSearchQuery ? (
              <div className="vscode-tree-search-empty">Type to search files.</div>
            ) : isSearchIndexLoading || isSearchLoading ? (
              <div className="vscode-tree-search-empty">
                <div style={{ marginTop: '8px' }}>
                  {isSearchIndexLoading
                    ? `${clampedSearchIndexProgress.toFixed(1)}% loaded`
                    : `Searching ${searchScopeFileCount ?? 'all'} file${
                        (searchScopeFileCount ?? 0) === 1 ? '' : 's'
                      }${searchScopeLabel ? ` in ${searchScopeLabel}` : ''}...`}
                </div>
              </div>
            ) : searchError ? (
              <div className="vscode-tree-search-empty">{searchError}</div>
            ) : searchResults.length === 0 ? (
              <div className="vscode-tree-search-empty">No matches found.</div>
            ) : (
              groupedSearchResults.map((group) => {
                const placeholderMatch = group.matches.find(isSearchPlaceholderMatch);
                const visibleMatches = group.matches.filter(
                  (match) => !isSearchPlaceholderMatch(match)
                );
                const primaryMatch = visibleMatches[0] ?? placeholderMatch ?? group.matches[0];
                const matchTypeLabel = placeholderMatch
                  ? placeholderMatch.preview.replace(' match', '').toLowerCase()
                  : null;
                const matchTypeBadge = primaryMatch.matchType;
                const relevanceLabel = `${Math.round(primaryMatch.relevanceScore)}%`;

                return (
                  <section key={group.file} className="vscode-tree-search-group">
                    <button
                      type="button"
                      className="vscode-file-item vscode-tree-search-group-header"
                      onClick={() => onSearchResultSelect?.(primaryMatch)}
                      title={`${primaryMatch.file}:${primaryMatch.line}`}
                    >
                      <span className="icon" aria-hidden="true">
                        📄
                      </span>
                      <span className="name">{group.fileName}</span>
                      <span className="vscode-tree-search-relevance" title="Relevance score">
                        {relevanceLabel}
                      </span>
                      <span className="size">
                        {group.directory || 'root'}
                        {matchTypeLabel ? ` · ${matchTypeLabel}` : ''}
                      </span>
                      {matchTypeBadge && matchTypeBadge !== 'content' && (
                        <span
                          className={`vscode-tree-search-match-badge vscode-tree-search-match-${matchTypeBadge}`}
                        >
                          {matchTypeBadge === 'filename' ? 'name' : 'quote'}
                        </span>
                      )}
                    </button>
                    {visibleMatches.length > 0 && (
                      <div className="vscode-tree-search-group-list">
                        {visibleMatches.map((match) => (
                          <button
                            key={match.key}
                            type="button"
                            className="vscode-file-item vscode-tree-search-row"
                            onClick={() => onSearchResultSelect?.(match)}
                            title={`${match.file}:${match.line}`}
                          >
                            <span className="icon vscode-tree-search-row-line" aria-hidden="true">
                              L{match.line}
                            </span>
                            <span className="name vscode-tree-search-row-preview">
                              {match.preview}
                            </span>
                            <span className="size">:{match.column}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })
            )}
          </div>
        ) : (
          sortFileNodes(rootNodes).map((node) => (
            <FileTreeItem
              key={node.path}
              node={node}
              level={0}
              onFileSelect={onFileSelect}
              selectedFile={selectedFile}
              listDirectory={listDirectory}
              onDirectoryExpand={onDirectoryExpand}
              expandedPaths={expandedPaths}
              onToggleExpand={handleToggleExpand}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default FileTree;
