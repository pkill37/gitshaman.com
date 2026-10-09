'use client';
import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { notFound, useRouter } from 'next/navigation';
import FileTree from './FileTree';
import TabBar from './TabBar';
import CodeEditorContainer from './CodeEditorContainer';
import GuidePanel from './GuidePanel';
import RepositoryRightPanel from './RepositoryRightPanel';
import SemanticGraphTab from './SemanticGraphTab';
import { EditorTab, FileNode, WorkspaceSearchResult } from '@/types';
import {
  buildFileTree,
  fetchRepositoryFile,
  setCurrentCorpusSourceMode,
  getCurrentRepoLabel,
  setGitHubRepoWithDefaultBranch,
  getTrustedVersion,
  getRepoIdentifier,
  getGitHubDefaultBranch,
} from '@/lib/github-api';
import { getProjectConfig, createGenericGuide } from '@/lib/project-guides';
import { getCuratedRepoPath } from '@/lib/curated-repos';
import { loadGuideFromMarkdown } from '@/features/guides/guide-loader';
import { useRepository } from '@/contexts/RepositoryContext';
import { findSymbolsInFile } from '@/lib/cross-reference';
import {
  isCuratedRepo,
  getCodeIndexFromStatic,
  getTreeStructureFromStatic,
  resolveCorpusPathFromKnownFiles,
  type CuratedRepoSourceMode,
} from '@/lib/repo-static';
import {
  getDefaultCuratedRepoSourceMode,
  normalizeCuratedRepoSourceMode,
} from '@/lib/curated-content-url';
import {
  buildSearchPreview,
  CODE_INDEX_PREVIEW_ENRICH_LIMIT,
  CODE_INDEX_SEARCH_RESULT_LIMIT,
  searchCodeIndexFiles,
  type LoadedCodeIndex,
} from '@/lib/code-index';
import { debugLog } from '@/lib/browser-debug';
import { downloadDirectoryContents } from '@/lib/github-archive';
import { resolveRepositoryNavigation } from '@/lib/github-url';
import '@/app/vscode.css';

// Helper functions for safe localStorage operations
const saveToLocalStorage = (key: string, value: unknown) => {
  try {
    if (typeof window !== 'undefined') {
      const serialized = JSON.stringify(value);
      try {
        localStorage.setItem(key, serialized);
      } catch (error) {
        localStorage.removeItem(key);
        localStorage.setItem(key, serialized);
        console.warn(`Reclaimed localStorage space while saving ${key}:`, error);
      }
    }
  } catch (error) {
    console.warn(`Failed to save ${key} to localStorage:`, error);
  }
};

const loadFromLocalStorage = (key: string, defaultValue: unknown): unknown => {
  try {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(key);
      if (saved) {
        return JSON.parse(saved);
      }
    }
  } catch (error) {
    console.warn(`Failed to load ${key} from localStorage:`, error);
  }
  return defaultValue;
};

// Helper function to get repository-scoped localStorage key
const getRepoScopedKey = (baseKey: string, repoIdentifier: string | null): string => {
  if (!repoIdentifier) {
    return baseKey; // Fallback to non-scoped key if no repository
  }
  return `${baseKey}-${repoIdentifier}`;
};

const EXPLORER_STORAGE_KEY_PREFIX = 'repository-workspace-explorer';
const CORPUS_SOURCE_MODE_STORAGE_KEY = `${EXPLORER_STORAGE_KEY_PREFIX}-corpus-source-mode`;

type WorkspaceTheme = 'dark' | 'light';
type StoredEditorTab = Omit<EditorTab, 'content' | 'isLoading'> & {
  isLoading?: boolean;
};

const isPreviewableMarkupFile = (path: string) => /\.(md|rst)$/i.test(path);

function flattenFilePaths(nodes: FileNode[]): string[] {
  const paths: string[] = [];

  const visit = (entries: FileNode[]) => {
    for (const entry of entries) {
      if (entry.type === 'file') {
        paths.push(entry.path);
      }
      if (entry.children?.length) {
        visit(entry.children);
      }
    }
  };

  visit(nodes);
  return paths;
}

function resolveWorkspaceFilePath(filePath: string, workspaceFilePaths: string[]): string | null {
  return resolveCorpusPathFromKnownFiles(filePath, workspaceFilePaths);
}

function stripTabContentForStorage(tab: EditorTab): StoredEditorTab {
  const storedTab = { ...tab, isLoading: false };
  delete storedTab.content;
  return { ...storedTab, isLoading: false };
}

function normalizeStoredTabs(tabs: EditorTab[]): EditorTab[] {
  return tabs.map((tab) => ({
    ...stripTabContentForStorage(tab),
    content: undefined,
    isLoading: false,
  }));
}

function findPedagogicalLandingLine(filePath: string, content: string): number | undefined {
  const lines = content.split('\n');

  if (/\.(md|rst|txt)$/i.test(filePath)) {
    for (let i = 0; i < lines.length; i++) {
      const markdownHeading = lines[i].match(/^#{1,6}\s+\S/);
      if (markdownHeading) {
        return i + 1;
      }

      const currentLine = lines[i].trim();
      const nextLine = lines[i + 1]?.trim() || '';
      if (currentLine && /^[=\-~^"']+$/.test(nextLine)) {
        return i + 1;
      }
    }
  }

  const symbols = findSymbolsInFile(content, filePath);
  const preferredDefinition =
    symbols.find(
      (symbol) =>
        symbol.isDefinition &&
        symbol.line > 0 &&
        (symbol.type === 'function' || symbol.type === 'class' || symbol.type === 'struct')
    ) ??
    symbols.find(
      (symbol) =>
        symbol.isDefinition &&
        symbol.line > 0 &&
        (symbol.type === 'typedef' || symbol.type === 'macro')
    );

  if (preferredDefinition) {
    return preferredDefinition.line;
  }

  const firstCodeLine = lines.findIndex((line) => {
    const trimmed = line.trim();
    return (
      trimmed &&
      !trimmed.startsWith('//') &&
      !trimmed.startsWith('/*') &&
      !trimmed.startsWith('*') &&
      !trimmed.startsWith('#')
    );
  });

  return firstCodeLine >= 0 ? firstCodeLine + 1 : undefined;
}

export type InitialFileTarget =
  | string
  | string[]
  | {
      kind?: 'repo-file';
      path: string;
      exactPath?: boolean;
      searchPattern?: string;
      scrollToLine?: number;
      searchScope?: string[];
      navigationNonce?: number;
    }
  | {
      kind: 'directory';
      path: string;
      navigationNonce?: number;
    }
  | null;

interface RepositoryWorkspaceExplorerProps {
  owner?: string;
  repo?: string;
  branch?: string;
  initialFile?: InitialFileTarget;
  /** When true, suppresses the internal right guide panel (guide is shown by parent layout) */
  hideGuidePanel?: boolean;
  onSelectedFileChange?: (path: string) => void;
  layoutMode?: 'editor' | 'search' | 'viewer' | 'semantic';
  sourceMode?: CuratedRepoSourceMode;
  onSourceModeChange?: (sourceMode: CuratedRepoSourceMode) => void;
  workspaceTheme: WorkspaceTheme;
  workspaceSearchQuery?: string;
  onWorkspaceSearchQueryChange?: (query: string) => void;
}

export default function RepositoryWorkspaceExplorer({
  owner,
  repo,
  branch,
  initialFile,
  hideGuidePanel = false,
  onSelectedFileChange,
  layoutMode = 'editor',
  sourceMode,
  onSourceModeChange,
  workspaceTheme,
  workspaceSearchQuery: controlledWorkspaceSearchQuery,
  onWorkspaceSearchQueryChange,
}: RepositoryWorkspaceExplorerProps) {
  const router = useRouter();
  const {
    setRepository,
    currentBranch,
    error: repoError,
    identifier: repoIdentifier,
  } = useRepository();

  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string>('');
  useEffect(() => {
    onSelectedFileChange?.(selectedFile);
  }, [selectedFile, onSelectedFileChange]);
  const [directoryExpandRequest, setDirectoryExpandRequest] = useState<{
    path: string;
    id: number;
  } | null>(null);
  // Initialize with consistent values for SSR (will be updated after hydration)
  const [repoLabel, setRepoLabel] = useState<string>(() =>
    owner && repo ? `${owner}/${repo}` : ''
  );

  // Repository version state - use default branch from project config.
  // Also initialises currentConfig synchronously (setGitHubRepoWithDefaultBranch has
  // no awaits, so its body runs synchronously) so that FileTree's mount effect reads
  // the correct repo rather than the module-level default (torvalds/linux).
  const [selectedVersion, setSelectedVersion] = useState<string>(() => {
    const config = owner && repo ? getProjectConfig(owner, repo) : null;
    const trusted = owner && repo ? getTrustedVersion(owner, repo) : '';
    const defaultBranch = config?.defaultRevision || trusted || 'main';
    // Curated repositories have one local corpus revision. GitHub links may
    // point at main, master, or a tag, but the file focus remains useful on the
    // trusted local revision.
    const effectiveBranch = branch || defaultBranch;
    if (owner && repo) {
      void setGitHubRepoWithDefaultBranch(owner, repo, effectiveBranch);
    }
    return effectiveBranch;
  });

  // Get project config
  const projectConfig = useMemo(() => {
    return owner && repo ? getProjectConfig(owner, repo) : null;
  }, [owner, repo]);

  const [activeChapterId, setActiveChapterId] = useState<string | null>(null);

  // Panel width state - start with defaults to avoid hydration mismatch
  const [sidebarWidth, setSidebarWidth] = useState<number>(220);
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(400);
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState<boolean>(false);
  const [tabsRestored, setTabsRestored] = useState<boolean>(false);

  const [localFileSourceMode, setLocalFileSourceMode] = useState<CuratedRepoSourceMode>(() => {
    let nextSourceMode = getDefaultCuratedRepoSourceMode();
    try {
      if (typeof window !== 'undefined') {
        const savedSourceMode = localStorage.getItem(CORPUS_SOURCE_MODE_STORAGE_KEY);
        if (savedSourceMode === 'local-filesystem' || savedSourceMode === 'r2-bucket') {
          nextSourceMode = savedSourceMode;
        }
      }
    } catch {
      // Keep the environment default.
    }
    return normalizeCuratedRepoSourceMode(nextSourceMode);
  });
  const fileSourceMode = normalizeCuratedRepoSourceMode(sourceMode ?? localFileSourceMode);
  const editorTheme = workspaceTheme === 'light' ? 'vs' : 'vs-dark';

  // Mobile panel state
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(false);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  // Mobile view state: 'explorer' | 'editor' | 'guide'
  const [mobileView, setMobileView] = useState<'explorer' | 'editor' | 'guide'>('editor');

  // Tree structure readiness state
  const [isTreeStructureReady, setIsTreeStructureReady] = useState<boolean>(false);
  const [workspaceFilePaths, setWorkspaceFilePaths] = useState<string[]>([]);
  const [localWorkspaceSearchQuery, setLocalWorkspaceSearchQuery] = useState<string>('');
  const workspaceSearchQuery = controlledWorkspaceSearchQuery ?? localWorkspaceSearchQuery;
  const setWorkspaceSearchQuery = useCallback(
    (query: string) => {
      if (onWorkspaceSearchQueryChange) {
        onWorkspaceSearchQueryChange(query);
        return;
      }
      setLocalWorkspaceSearchQuery(query);
    },
    [onWorkspaceSearchQueryChange]
  );
  const [workspaceSearchResults, setWorkspaceSearchResults] = useState<WorkspaceSearchResult[]>([]);
  const [workspaceSearchLoading, setWorkspaceSearchLoading] = useState<boolean>(false);
  const [workspaceSearchError, setWorkspaceSearchError] = useState<string | null>(null);
  const [workspaceSearchHasMore, setWorkspaceSearchHasMore] = useState<boolean>(false);
  const [workspaceSearchIndex, setWorkspaceSearchIndex] = useState<LoadedCodeIndex | null>(null);
  const [workspaceSearchIndexLoading, setWorkspaceSearchIndexLoading] = useState(true);
  const [workspaceSearchIndexError, setWorkspaceSearchIndexError] = useState<string | null>(null);
  const [workspaceSearchIndexProgress, setWorkspaceSearchIndexProgress] = useState<number>(0);
  const [workspaceSearchIndexCached, setWorkspaceSearchIndexCached] = useState(false);
  const workspaceSearchIndexLoadKey = `${fileSourceMode}:${owner || ''}/${repo || ''}@${selectedVersion}`;
  const [previousSearchIndexLoadKey, setPreviousSearchIndexLoadKey] = useState(
    workspaceSearchIndexLoadKey
  );

  // Reset before rendering children so they never receive the previous repository's index.
  if (previousSearchIndexLoadKey !== workspaceSearchIndexLoadKey) {
    setPreviousSearchIndexLoadKey(workspaceSearchIndexLoadKey);
    setWorkspaceSearchIndex(null);
    setWorkspaceSearchIndexError(null);
    setWorkspaceSearchIndexLoading(true);
    setWorkspaceSearchIndexProgress(0);
    setWorkspaceSearchIndexCached(false);
  }
  // Refs for cleanup
  const workspaceSearchIndexRequestIdRef = useRef(0);
  const workspaceSearchResultsRequestIdRef = useRef(0);
  const workspaceSearchIndexProgressRef = useRef<number>(0);
  const workspaceSearchIndexPendingProgressRef = useRef<number | null>(null);
  const workspaceSearchIndexProgressFrameRef = useRef<number | null>(null);
  const workspaceSearchIndexCachedRef = useRef<boolean>(false);
  const workspaceSearchIndexCacheHitRef = useRef<boolean>(false);
  const workspaceSearchIndexProgressSeenRef = useRef<boolean>(false);
  const workspaceSearchPreviewCacheRef = useRef<Map<string, string>>(new Map());
  // Track which initialFile has already been opened so we don't re-open on re-renders
  const lastOpenedInitialFileRef = useRef<string | null>(null);

  const setActiveFileSourceMode = useCallback(
    (nextSourceMode: CuratedRepoSourceMode) => {
      const normalizedSourceMode = normalizeCuratedRepoSourceMode(nextSourceMode);
      setLocalFileSourceMode(normalizedSourceMode);
      onSourceModeChange?.(normalizedSourceMode);
    },
    [onSourceModeChange]
  );

  useEffect(() => {
    let nextSourceMode = getDefaultCuratedRepoSourceMode();
    try {
      const savedSourceMode = localStorage.getItem(CORPUS_SOURCE_MODE_STORAGE_KEY);
      if (savedSourceMode === 'local-filesystem' || savedSourceMode === 'r2-bucket') {
        nextSourceMode = savedSourceMode;
      }
    } catch {
      // Keep the environment default.
    }

    nextSourceMode = normalizeCuratedRepoSourceMode(nextSourceMode);

    queueMicrotask(() => {
      setActiveFileSourceMode(nextSourceMode);
      setCurrentCorpusSourceMode(nextSourceMode);
    });
  }, [setActiveFileSourceMode]);

  // Check if mobile on mount and resize
  // Using 1024px as breakpoint for "small laptop" - below this is mobile/tablet
  useEffect(() => {
    const checkViewport = () => {
      if (typeof window !== 'undefined') {
        const isMobileView = window.innerWidth < 1024;
        setIsMobile(isMobileView);
        // On mobile, ensure only one panel is visible at a time
        if (isMobileView) {
          if (mobileView === 'explorer') {
            setIsSidebarOpen(true);
            setIsRightPanelOpen(false);
          } else if (mobileView === 'guide') {
            setIsSidebarOpen(false);
            setIsRightPanelOpen(true);
          } else {
            setIsSidebarOpen(false);
            setIsRightPanelOpen(false);
          }
        } else {
          // Desktop: show all panels
          setIsSidebarOpen(true);
          setIsRightPanelOpen(true);
        }
      }
    };
    checkViewport();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', checkViewport);
      return () => window.removeEventListener('resize', checkViewport);
    }
    return;
  }, [mobileView]);

  useEffect(() => {
    setCurrentCorpusSourceMode(fileSourceMode);
    try {
      localStorage.setItem(CORPUS_SOURCE_MODE_STORAGE_KEY, fileSourceMode);
    } catch {
      // ignore
    }
  }, [fileSourceMode]);

  // Check repository setup and tree structure readiness
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkRepositorySetup = async () => {
      if (!owner || !repo) {
        // No repository specified in URL, redirect to main page
        router.push('/');
        return;
      }

      try {
        const isCurated = isCuratedRepo(owner, repo);
        const usesRuntimeBranch = Boolean(branch);
        const identifier = getRepoIdentifier(owner, repo);
        const config = getProjectConfig(owner, repo);
        const trustedBranch = isCurated ? getTrustedVersion(owner, repo) : '';
        const defaultBranch =
          (usesRuntimeBranch
            ? branch
            : isCurated
              ? config?.defaultRevision || trustedBranch
              : branch) || (isCurated ? trustedBranch : await getGitHubDefaultBranch(owner, repo));
        const targetBranch = branch || defaultBranch;

        // Repository exists, set it in context
        await setRepository('github', identifier, `${owner}/${repo}`, targetBranch);

        // Set GitHub API config for backward compatibility
        await setGitHubRepoWithDefaultBranch(owner, repo, targetBranch, {
          preserveBranch: usesRuntimeBranch,
        });
        setRepoLabel(`${owner}/${repo}`);

        // Curated repositories always use their trusted local revision. For
        // runtime repositories, the requested URL ref is authoritative.
        // setRepository initialized the context with the URL ref (when one
        // was supplied), so do not route it through local branch validation.
        if (selectedVersion !== targetBranch) {
          setSelectedVersion(targetBranch);
        }

        if (isCurated && !usesRuntimeBranch) {
          const staticTree = await getTreeStructureFromStatic(owner, repo, targetBranch, {
            sourceMode: fileSourceMode,
          });
          setIsTreeStructureReady(staticTree !== null && staticTree.length > 0);
          setWorkspaceFilePaths(staticTree ? flattenFilePaths(staticTree) : []);
        } else {
          // FileTree fetches the root listing immediately. Do not recursively
          // download or duplicate that request here; directories and files are
          // fetched lazily as the user explores them.
          setIsTreeStructureReady(true);
          setWorkspaceFilePaths([]);
        }
      } catch (error) {
        console.error('Failed to setup repository:', error);
        // Redirect to home on error
        router.push('/');
      }
    };

    checkRepositorySetup();
  }, [owner, repo, branch, router, setRepository, currentBranch, selectedVersion, fileSourceMode]);

  useEffect(() => {
    let cancelled = false;
    const loadKey = `${fileSourceMode}:${owner || ''}/${repo || ''}@${selectedVersion}`;
    // Every effect setup must subscribe, including Strict Mode's setup/cleanup replay.
    // getCodeIndexFromStatic already deduplicates the underlying index load.
    workspaceSearchIndexRequestIdRef.current += 1;
    const requestId = workspaceSearchIndexRequestIdRef.current;
    debugLog('[explorar:search-index] load-start', {
      requestId,
      owner,
      repo,
      branch: selectedVersion,
      loadKey,
    });
    workspaceSearchIndexProgressRef.current = 0;
    workspaceSearchIndexPendingProgressRef.current = null;
    if (workspaceSearchIndexProgressFrameRef.current !== null) {
      cancelAnimationFrame(workspaceSearchIndexProgressFrameRef.current);
      workspaceSearchIndexProgressFrameRef.current = null;
    }
    workspaceSearchIndexCachedRef.current = false;
    workspaceSearchIndexCacheHitRef.current = false;
    workspaceSearchIndexProgressSeenRef.current = false;
    workspaceSearchPreviewCacheRef.current.clear();

    void (async () => {
      const scheduleProgressUpdate = (nextProgress: number): void => {
        const roundedProgress = Math.max(0, Math.min(100, Math.round(nextProgress / 10) * 10));
        if (workspaceSearchIndexProgressRef.current === roundedProgress) {
          return;
        }

        workspaceSearchIndexProgressRef.current = roundedProgress;
        workspaceSearchIndexPendingProgressRef.current = roundedProgress;

        if (workspaceSearchIndexProgressFrameRef.current !== null) {
          return;
        }

        workspaceSearchIndexProgressFrameRef.current = requestAnimationFrame(() => {
          workspaceSearchIndexProgressFrameRef.current = null;
          const pendingProgress = workspaceSearchIndexPendingProgressRef.current;
          if (pendingProgress === null) return;
          setWorkspaceSearchIndexProgress(pendingProgress);
        });
      };

      try {
        const payload = await getCodeIndexFromStatic(owner || '', repo || '', selectedVersion, {
          sourceMode: fileSourceMode,
          onProgress: (progress) => {
            if (cancelled || workspaceSearchIndexRequestIdRef.current !== requestId) return;
            const computedProgress =
              progress.source === 'cache'
                ? 100
                : progress.totalBytes && progress.totalBytes > 0
                  ? Math.min(100, (progress.loadedBytes / progress.totalBytes) * 100)
                  : 0;
            debugLog('[explorar:search-index] progress', {
              requestId,
              owner,
              repo,
              branch: selectedVersion,
              source: progress.source,
              loadedBytes: progress.loadedBytes,
              totalBytes: progress.totalBytes,
              computedProgress,
            });
            scheduleProgressUpdate(computedProgress);
            workspaceSearchIndexProgressSeenRef.current = true;
            const isCached = progress.source === 'cache';
            if (isCached) {
              workspaceSearchIndexCacheHitRef.current = true;
            }
            if (workspaceSearchIndexCachedRef.current !== isCached) {
              workspaceSearchIndexCachedRef.current = isCached;
              setWorkspaceSearchIndexCached(isCached);
            }
          },
        });
        if (cancelled || workspaceSearchIndexRequestIdRef.current !== requestId) return;
        if (!payload) {
          debugLog('[explorar:search-index] load-empty', {
            requestId,
            owner,
            repo,
            branch: selectedVersion,
          });
          setWorkspaceSearchIndexError('Search index is unavailable for this repository.');
          setWorkspaceSearchIndex(null);
          setWorkspaceSearchIndexProgress(0);
          setWorkspaceSearchIndexCached(false);
          return;
        }
        debugLog('[explorar:search-index] load-success', {
          requestId,
          owner,
          repo,
          branch: selectedVersion,
          fileCount: payload.fileCount,
          buildSignature: payload.buildSignature,
        });
        if (!workspaceSearchIndexProgressSeenRef.current) {
          debugLog('[explorar:search-index] synthetic-progress', {
            requestId,
            owner,
            repo,
            branch: selectedVersion,
            progress: 100,
          });
          scheduleProgressUpdate(100);
        }
        setWorkspaceSearchIndex(payload);
        if (
          workspaceSearchIndexCacheHitRef.current ||
          !workspaceSearchIndexProgressSeenRef.current
        ) {
          debugLog('[explorar:search-index] frame-hold', {
            requestId,
            owner,
            repo,
            branch: selectedVersion,
            cacheHit: workspaceSearchIndexCacheHitRef.current,
            progressSeen: workspaceSearchIndexProgressSeenRef.current,
            progress: workspaceSearchIndexProgressRef.current,
          });
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve());
          });
        }
      } catch (error) {
        if (cancelled || workspaceSearchIndexRequestIdRef.current !== requestId) return;
        debugLog('[explorar:search-index] load-error', {
          requestId,
          owner,
          repo,
          branch: selectedVersion,
          error: error instanceof Error ? error.message : String(error),
        });
        setWorkspaceSearchIndexError(
          error instanceof Error ? error.message : 'Failed to load search index'
        );
        setWorkspaceSearchIndex(null);
        setWorkspaceSearchIndexProgress(0);
        setWorkspaceSearchIndexCached(false);
      } finally {
        if (!cancelled && workspaceSearchIndexRequestIdRef.current === requestId) {
          debugLog('[explorar:search-index] load-settled', {
            requestId,
            owner,
            repo,
            branch: selectedVersion,
            loading: false,
            cacheHit: workspaceSearchIndexCacheHitRef.current,
          });
          setWorkspaceSearchIndexLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (workspaceSearchIndexProgressFrameRef.current !== null) {
        cancelAnimationFrame(workspaceSearchIndexProgressFrameRef.current);
        workspaceSearchIndexProgressFrameRef.current = null;
      }
    };
  }, [owner, repo, selectedVersion, fileSourceMode]);

  useEffect(() => {
    // Use setTimeout to avoid synchronous setState in effect
    setTimeout(() => {
      setIsHydrated(true);
      setRepoLabel(getCurrentRepoLabel());
    }, 0);

    if (typeof window !== 'undefined') {
      // Restore panel widths (these are global, not repository-specific)
      const savedSidebarWidth = localStorage.getItem(
        `${EXPLORER_STORAGE_KEY_PREFIX}-sidebar-width`
      );
      const savedRightPanelWidth = localStorage.getItem(
        `${EXPLORER_STORAGE_KEY_PREFIX}-right-panel-width`
      );

      // Use setTimeout to avoid synchronous setState in effect
      setTimeout(() => {
        if (savedSidebarWidth) {
          setSidebarWidth(parseInt(savedSidebarWidth, 10));
        }
        if (savedRightPanelWidth) {
          setRightPanelWidth(parseInt(savedRightPanelWidth, 10));
        }
      }, 0);
    }
  }, []);

  // Load repository-specific tabs when repository changes
  useEffect(() => {
    const scheduledTimers: number[] = [];
    const scheduleStateUpdate = (callback: () => void) => {
      scheduledTimers.push(window.setTimeout(callback, 0));
    };

    scheduleStateUpdate(() => setTabsRestored(false));

    if (!isHydrated || !repoIdentifier) {
      // Clear tabs if no repository is set
      if (!repoIdentifier) {
        scheduleStateUpdate(() => {
          setTabs([]);
          setActiveTabId(null);
          setSelectedFile('');
          setTabsRestored(true);
        });
      }
      return () => scheduledTimers.forEach((timer) => window.clearTimeout(timer));
    }

    // Load tabs for this specific repository
    const tabsKey = getRepoScopedKey(`${EXPLORER_STORAGE_KEY_PREFIX}-tabs`, repoIdentifier);
    const activeTabKey = getRepoScopedKey(
      `${EXPLORER_STORAGE_KEY_PREFIX}-active-tab`,
      repoIdentifier
    );
    const selectedFileKey = getRepoScopedKey(
      `${EXPLORER_STORAGE_KEY_PREFIX}-selected-file`,
      repoIdentifier
    );

    const savedTabs = normalizeStoredTabs(loadFromLocalStorage(tabsKey, []) as EditorTab[]);
    const savedActiveTabId = loadFromLocalStorage(activeTabKey, null) as string | null;
    const savedSelectedFile = loadFromLocalStorage(selectedFileKey, '') as string;
    const hasExplicitInitialFile =
      Boolean(initialFile) ||
      (() => {
        if (typeof window === 'undefined') return false;
        const urlTarget = resolveRepositoryNavigation(
          window.location.pathname,
          window.location.search.slice(1),
          window.location.hash
        );
        return Boolean(
          urlTarget && urlTarget.owner === owner && urlTarget.repo === repo && urlTarget.filePath
        );
      })();

    scheduleStateUpdate(() => {
      if (savedTabs.length > 0) {
        setTabs(savedTabs);
      } else if (!hasExplicitInitialFile) {
        setTabs([]);
      }
      if (savedActiveTabId) {
        setActiveTabId(savedActiveTabId);
      } else if (!hasExplicitInitialFile) {
        setActiveTabId(null);
      }
      if (savedSelectedFile) {
        setSelectedFile(savedSelectedFile);
      } else if (!hasExplicitInitialFile) {
        setSelectedFile('');
      }
      setTabsRestored(true);
    });

    return () => scheduledTimers.forEach((timer) => window.clearTimeout(timer));
  }, [repoIdentifier, isHydrated, initialFile, owner, repo]);

  // Save state to localStorage (only after hydration)
  useEffect(() => {
    if (isHydrated) {
      saveToLocalStorage(`${EXPLORER_STORAGE_KEY_PREFIX}-sidebar-width`, sidebarWidth);
    }
  }, [sidebarWidth, isHydrated]);

  useEffect(() => {
    if (isHydrated) {
      saveToLocalStorage(`${EXPLORER_STORAGE_KEY_PREFIX}-right-panel-width`, rightPanelWidth);
    }
  }, [rightPanelWidth, isHydrated]);

  useEffect(() => {
    if (isHydrated && repoIdentifier) {
      const tabsKey = getRepoScopedKey(`${EXPLORER_STORAGE_KEY_PREFIX}-tabs`, repoIdentifier);
      saveToLocalStorage(tabsKey, tabs.map(stripTabContentForStorage));
    }
  }, [tabs, isHydrated, repoIdentifier]);

  useEffect(() => {
    if (isHydrated && repoIdentifier) {
      const activeTabKey = getRepoScopedKey(
        `${EXPLORER_STORAGE_KEY_PREFIX}-active-tab`,
        repoIdentifier
      );
      saveToLocalStorage(activeTabKey, activeTabId);
    }
  }, [activeTabId, isHydrated, repoIdentifier]);

  useEffect(() => {
    if (isHydrated && repoIdentifier) {
      const selectedFileKey = getRepoScopedKey(
        `${EXPLORER_STORAGE_KEY_PREFIX}-selected-file`,
        repoIdentifier
      );
      saveToLocalStorage(selectedFileKey, selectedFile);
    }
  }, [selectedFile, isHydrated, repoIdentifier]);

  useEffect(() => {
    if (isHydrated && repoIdentifier) {
      const selectedVersionKey = getRepoScopedKey(
        `${EXPLORER_STORAGE_KEY_PREFIX}-selected-version`,
        repoIdentifier
      );
      saveToLocalStorage(selectedVersionKey, selectedVersion);
    }
  }, [selectedVersion, isHydrated, repoIdentifier]);

  useEffect(() => {
    if (!isHydrated || !repoIdentifier) {
      if (!repoIdentifier) {
        queueMicrotask(() => {
          setWorkspaceSearchQuery('');
          setWorkspaceSearchResults([]);
          setWorkspaceSearchLoading(false);
          setWorkspaceSearchError(null);
          setWorkspaceSearchHasMore(false);
        });
      }
      return;
    }

    const searchKey = getRepoScopedKey(
      `${EXPLORER_STORAGE_KEY_PREFIX}-workspace-search`,
      repoIdentifier
    );
    const savedSearchQuery = loadFromLocalStorage(searchKey, '') as string;
    queueMicrotask(() => {
      setWorkspaceSearchQuery(savedSearchQuery);
    });
  }, [isHydrated, repoIdentifier, setWorkspaceSearchQuery]);

  useEffect(() => {
    if (isHydrated && repoIdentifier) {
      const searchKey = getRepoScopedKey(
        `${EXPLORER_STORAGE_KEY_PREFIX}-workspace-search`,
        repoIdentifier
      );
      saveToLocalStorage(searchKey, workspaceSearchQuery);
    }
  }, [isHydrated, repoIdentifier, workspaceSearchQuery]);

  useEffect(() => {
    if (!owner || !repo) {
      return;
    }

    void setGitHubRepoWithDefaultBranch(owner, repo, selectedVersion, {
      preserveBranch: Boolean(branch),
    });
    setCurrentCorpusSourceMode(fileSourceMode);
  }, [branch, owner, repo, selectedVersion, fileSourceMode]);

  const listDirectoryFromSelectedSource = useCallback(
    async (path: string) => {
      if (owner && repo && (Boolean(branch) || !isCuratedRepo(owner, repo))) {
        const entries = await downloadDirectoryContents(owner, repo, selectedVersion, path);
        return entries.map((entry) => ({
          name: entry.name,
          path: entry.path,
          type: entry.type,
          size: entry.size,
          isExpanded: false,
          isLoaded: false,
          children: undefined,
        }));
      }
      return buildFileTree(path, { sourceMode: fileSourceMode });
    },
    [branch, fileSourceMode, owner, repo, selectedVersion]
  );

  const fetchFileFromSelectedSource = useCallback(
    (path: string) =>
      fetchRepositoryFile(owner || '', repo || '', selectedVersion, path, {
        sourceMode: fileSourceMode,
        allowGitHubFallback: Boolean(branch),
      }),
    [branch, owner, repo, selectedVersion, fileSourceMode]
  );

  // Resize handlers
  const handleMouseDown = useCallback((panel: 'sidebar' | 'rightPanel') => {
    setIsResizing(panel);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      const containerWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
      const minWidth = 200;
      const maxSidebarWidth = containerWidth * 0.4;
      const maxRightPanelWidth = containerWidth * 0.4;

      if (isResizing === 'sidebar') {
        const newWidth = Math.min(Math.max(e.clientX, minWidth), maxSidebarWidth);
        setSidebarWidth(newWidth);
      } else if (isResizing === 'rightPanel') {
        const newWidth = Math.min(
          Math.max(containerWidth - e.clientX, minWidth),
          maxRightPanelWidth
        );
        setRightPanelWidth(newWidth);
      }
    },
    [isResizing]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(null);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      };
    }
    return;
  }, [isResizing, handleMouseMove, handleMouseUp]);

  // Tabs helpers
  const activeTab = tabs.find((t) => t.id === activeTabId) || null;
  const generateTabId = (path: string) => `tab-${path.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;
  const navigationNonceRef = useRef(0);

  const resolveSymbolNavigationLine = useCallback(
    async (
      filePath: string,
      searchPattern?: string,
      scrollToLine?: number,
      searchScope?: string[]
    ) => {
      if (scrollToLine || !owner || !repo) {
        return {
          resolvedFilePath: filePath,
          resolvedSearchPattern: searchPattern,
          resolvedScrollToLine: scrollToLine,
        };
      }

      const candidatePaths = Array.from(
        new Set((searchScope && searchScope.length > 0 ? searchScope : [filePath]).filter(Boolean))
      );
      const branchToUse =
        currentBranch || branch || selectedVersion || projectConfig?.defaultRevision || 'main';
      for (const candidatePath of candidatePaths) {
        try {
          const resolvedCandidatePath =
            resolveWorkspaceFilePath(candidatePath, workspaceFilePaths) ?? candidatePath;
          if (resolvedCandidatePath === candidatePath && !candidatePath.includes('/')) {
            continue;
          }
          const fileResult = await fetchFileFromSelectedSource(resolvedCandidatePath);

          if (!searchPattern) {
            const landingLine = findPedagogicalLandingLine(
              resolvedCandidatePath,
              fileResult.content
            );
            if (landingLine) {
              debugLog('[explorar:open-file] resolved-default-landing-line', {
                filePath: resolvedCandidatePath,
                branch: branchToUse,
                line: landingLine,
                candidatePathCount: candidatePaths.length,
              });
              return {
                resolvedFilePath: resolvedCandidatePath,
                resolvedSearchPattern: undefined,
                resolvedScrollToLine: landingLine,
              };
            }
            continue;
          }

          const parsedSymbols = findSymbolsInFile(fileResult.content, resolvedCandidatePath);
          const normalizedQuery = searchPattern
            .trim()
            .replace(/\(\)$/, '')
            .replace(/^(struct|class|enum)\s+/, '');
          const symbolMatch =
            parsedSymbols.find(
              (symbol) => symbol.isDefinition && symbol.name === normalizedQuery && symbol.line > 0
            ) ?? parsedSymbols.find((symbol) => symbol.name === normalizedQuery && symbol.line > 0);

          if (symbolMatch?.line) {
            debugLog('[explorar:open-file] resolved-symbol-line:local-parse', {
              filePath: resolvedCandidatePath,
              searchPattern,
              branch: branchToUse,
              line: symbolMatch.line,
              symbolType: symbolMatch.type,
              isDefinition: symbolMatch.isDefinition,
              candidatePathCount: candidatePaths.length,
            });
            return {
              resolvedFilePath: resolvedCandidatePath,
              resolvedSearchPattern: undefined,
              resolvedScrollToLine: symbolMatch.line,
            };
          }
        } catch (error) {
          debugLog('[explorar:open-file] symbol-line-resolution-failed', {
            filePath: candidatePath,
            searchPattern,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      debugLog('[explorar:open-file] unresolved-symbol-line', {
        filePath,
        searchPattern,
        branch: branchToUse,
        candidatePathCount: candidatePaths.length,
      });
      return {
        resolvedFilePath: candidatePaths[0] || filePath,
        resolvedSearchPattern: searchPattern,
        resolvedScrollToLine: scrollToLine,
      };
    },
    [
      owner,
      repo,
      currentBranch,
      branch,
      selectedVersion,
      projectConfig,
      workspaceFilePaths,
      fetchFileFromSelectedSource,
    ]
  );

  const openFileInTab = useCallback(
    async (
      filePath: string,
      searchPattern?: string,
      scrollToLine?: number,
      searchScope?: string[],
      repoTarget?: { owner: string; repo: string },
      options?: { exactPath?: boolean }
    ) => {
      if (repoTarget && (repoTarget.owner !== owner || repoTarget.repo !== repo)) {
        const params = new URLSearchParams({ file: filePath });
        if (searchPattern) params.set('search', searchPattern);
        if (typeof scrollToLine === 'number') params.set('line', String(scrollToLine));
        router.push(`${getCuratedRepoPath(repoTarget.owner, repoTarget.repo)}?${params}`);
        return;
      }

      // Sidebar entries and URL targets contain exact repository-relative paths, even when
      // a lazy repository has no complete workspace file list.
      const resolvedWorkspacePath = options?.exactPath
        ? filePath
        : resolveWorkspaceFilePath(filePath, workspaceFilePaths);
      if (!resolvedWorkspacePath && !filePath.includes('/') && !filePath.endsWith('/')) {
        debugLog('[explorar:open-file] unresolved-bare-path', {
          filePath,
          searchPattern,
          scrollToLine,
          searchScope,
        });
        return;
      }

      let normalizedPath = (resolvedWorkspacePath ?? filePath).replace(/\/+$/, '');

      // Check if this is a Documentation folder - open index.rst instead
      if (filePath.startsWith('Documentation/') && filePath.endsWith('/')) {
        normalizedPath = `${normalizedPath}/index.rst`;
        // Continue to open the file instead of expanding directory
      } else if (filePath.endsWith('/')) {
        // For other directories, check if downloaded and download if needed, then expand
        setSelectedFile(normalizedPath);

        const handleDirectoryExpand = async () => {
          try {
            setDirectoryExpandRequest({ path: normalizedPath, id: Date.now() });
          } catch (error) {
            console.error('Failed to download directory:', error);
            setDirectoryExpandRequest({ path: normalizedPath, id: Date.now() });
          }
        };

        handleDirectoryExpand();
        return;
      }

      const { resolvedFilePath, resolvedSearchPattern, resolvedScrollToLine } = options?.exactPath
        ? {
            resolvedFilePath: normalizedPath,
            resolvedSearchPattern: searchPattern,
            resolvedScrollToLine: scrollToLine,
          }
        : await resolveSymbolNavigationLine(
            normalizedPath,
            searchPattern,
            scrollToLine,
            searchScope
          );
      normalizedPath = resolvedFilePath.replace(/\/+$/, '');
      const navigationNonce = ++navigationNonceRef.current;
      debugLog('[explorar:open-file] request', {
        filePath,
        normalizedPath,
        searchPattern: resolvedSearchPattern,
        scrollToLine: resolvedScrollToLine,
        navigationNonce,
        searchScope,
      });

      // For files: expand all parent directories recursively to make the file visible
      // Extract the parent directory path from the file path
      const pathParts = normalizedPath.split('/');
      if (pathParts.length > 1) {
        // File is in a subdirectory - expand the parent directory
        const parentDirPath = pathParts.slice(0, -1).join('/');
        setDirectoryExpandRequest({ path: parentDirPath, id: Date.now() });
      }

      setSelectedFile(normalizedPath);
      const existing = tabs.find((t) => t.path === normalizedPath);
      if (existing) {
        debugLog('[explorar:open-file] activate-existing-tab', {
          path: normalizedPath,
          tabId: existing.id,
        });
        setActiveTabId(existing.id);
        setTabs((prev) =>
          prev.map((t) => ({
            ...t,
            isActive: t.id === existing.id,
            searchPattern: t.id === existing.id ? resolvedSearchPattern : t.searchPattern,
            scrollToLine: t.id === existing.id ? resolvedScrollToLine : t.scrollToLine,
            navigationNonce: t.id === existing.id ? navigationNonce : t.navigationNonce,
          }))
        );
        return;
      }

      const newTab: EditorTab = {
        id: generateTabId(normalizedPath),
        title: normalizedPath.split('/').pop() || normalizedPath,
        path: normalizedPath,
        isActive: true,
        isDirty: false,
        viewMode: isPreviewableMarkupFile(normalizedPath) ? 'source' : undefined,
        isLoading: true,
        searchPattern: resolvedSearchPattern,
        scrollToLine: resolvedScrollToLine,
        navigationNonce,
      };
      debugLog('[explorar:open-file] create-tab', {
        path: normalizedPath,
        tabId: newTab.id,
      });
      setTabs((prev) => [...prev.map((t) => ({ ...t, isActive: false })), newTab]);
      setActiveTabId(newTab.id);
    },
    [owner, repo, router, tabs, resolveSymbolNavigationLine, workspaceFilePaths]
  );

  const guideOpenFileInTab = useCallback(
    (
      filePath: string,
      searchPattern?: string,
      scrollToLine?: number,
      searchScope?: string[],
      repoTarget?: { owner: string; repo: string }
    ) => {
      openFileInTab(filePath, searchPattern, scrollToLine, searchScope, repoTarget);
    },
    [openFileInTab]
  );

  const handleOpenFileFromExplorer = useCallback(
    (filePath: string, searchPattern?: string, scrollToLine?: number, searchScope?: string[]) => {
      void openFileInTab(filePath, searchPattern, scrollToLine, searchScope, undefined, {
        exactPath: true,
      });
    },
    [openFileInTab]
  );

  const guideSections = useMemo(() => {
    if (!projectConfig) {
      return createGenericGuide(owner || 'torvalds', repo || 'linux');
    }

    const guideId = projectConfig.guides[0]?.id;
    if (guideId) {
      try {
        // eslint-disable-next-line react-hooks/refs -- guide callbacks are invoked from user actions, not during render.
        return loadGuideFromMarkdown(guideId, guideOpenFileInTab);
      } catch (error) {
        console.error(`Failed to load guide ${guideId}:`, error);
      }
    }

    return createGenericGuide(projectConfig.owner, projectConfig.repo);
  }, [projectConfig, owner, repo, guideOpenFileInTab]);

  const onTabSelect = (tabId: string) => {
    setActiveTabId(tabId);
    setTabs((prev) => prev.map((t) => ({ ...t, isActive: t.id === tabId })));
    const t = tabs.find((x) => x.id === tabId);
    if (t) setSelectedFile(t.path);
  };

  const toggleMarkdownPreview = useCallback(() => {
    if (!activeTab || !isPreviewableMarkupFile(activeTab.path)) {
      return;
    }

    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTab.id
          ? {
              ...tab,
              viewMode: tab.viewMode === 'preview' ? 'source' : 'preview',
            }
          : tab
      )
    );
  }, [activeTab]);

  const onTabClose = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId);
        const nextTabs = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          const newIdx = Math.max(0, idx - 1);
          const nextActive = nextTabs[newIdx] || null;
          setActiveTabId(nextActive ? nextActive.id : null);
          setSelectedFile(nextActive ? nextActive.path : '');
        }
        return nextTabs;
      });
    },
    [activeTabId]
  );

  const onCloseAllTabs = useCallback(() => {
    setTabs([]);
    setActiveTabId(null);
    setSelectedFile('');
  }, []);

  useEffect(() => {
    const searchIsActive = layoutMode === 'search';
    if (!searchIsActive) {
      workspaceSearchResultsRequestIdRef.current += 1;
      queueMicrotask(() => {
        setWorkspaceSearchLoading(false);
      });
      return;
    }

    const normalizedQuery = workspaceSearchQuery.trim();
    const requestId = ++workspaceSearchResultsRequestIdRef.current;

    if (!normalizedQuery) {
      queueMicrotask(() => {
        setWorkspaceSearchResults([]);
        setWorkspaceSearchLoading(false);
        setWorkspaceSearchError(null);
        setWorkspaceSearchHasMore(false);
      });
      return;
    }

    if (workspaceSearchIndexError) {
      queueMicrotask(() => {
        setWorkspaceSearchResults([]);
        setWorkspaceSearchLoading(false);
        setWorkspaceSearchError(workspaceSearchIndexError);
        setWorkspaceSearchHasMore(false);
      });
      return;
    }

    if (workspaceSearchIndexLoading) {
      queueMicrotask(() => {
        setWorkspaceSearchResults([]);
        setWorkspaceSearchLoading(true);
        setWorkspaceSearchError(null);
        setWorkspaceSearchHasMore(false);
      });
      return;
    }

    if (!workspaceSearchIndex) {
      queueMicrotask(() => {
        setWorkspaceSearchLoading(true);
        setWorkspaceSearchResults([]);
        setWorkspaceSearchError(null);
        setWorkspaceSearchHasMore(false);
      });
      return () => undefined;
    }

    const timeoutId = window.setTimeout(() => {
      const runSearch = async () => {
        setWorkspaceSearchLoading(true);
        setWorkspaceSearchError(null);

        try {
          const indexedResults = searchCodeIndexFiles(
            workspaceSearchIndex,
            normalizedQuery,
            CODE_INDEX_SEARCH_RESULT_LIMIT
          );

          if (workspaceSearchResultsRequestIdRef.current !== requestId) {
            return;
          }

          const immediateResults = indexedResults.map((entry) => ({
            file: entry.path,
            line: 1,
            column: 1,
            preview: entry.isDocumentation ? 'Documentation match' : 'Source match',
            key: `${entry.path}:1:1`,
            matchType: entry.matchType,
            relevanceScore: entry.relevanceScore,
          }));

          setWorkspaceSearchResults(immediateResults);
          setWorkspaceSearchHasMore(indexedResults.length >= CODE_INDEX_SEARCH_RESULT_LIMIT);

          const previewTargets = indexedResults.slice(0, CODE_INDEX_PREVIEW_ENRICH_LIMIT);
          const previewResults = await Promise.all(
            previewTargets.map(async (entry) => {
              const cachedContent = workspaceSearchPreviewCacheRef.current.get(entry.path);
              if (cachedContent) {
                const preview = buildSearchPreview(cachedContent, normalizedQuery);
                if (preview) {
                  return {
                    file: entry.path,
                    line: preview.line,
                    column: preview.column,
                    preview: preview.preview,
                    key: `${entry.path}:${preview.line}:${preview.column}`,
                    matchType: entry.matchType,
                    relevanceScore: entry.relevanceScore,
                  } satisfies WorkspaceSearchResult;
                }
                return null;
              }

              try {
                const fileResult = await fetchFileFromSelectedSource(entry.path);
                workspaceSearchPreviewCacheRef.current.set(entry.path, fileResult.content);
                const preview = buildSearchPreview(fileResult.content, normalizedQuery);
                if (!preview) {
                  return null;
                }
                return {
                  file: entry.path,
                  line: preview.line,
                  column: preview.column,
                  preview: preview.preview,
                  key: `${entry.path}:${preview.line}:${preview.column}`,
                  matchType: entry.matchType,
                  relevanceScore: entry.relevanceScore,
                } satisfies WorkspaceSearchResult;
              } catch (error) {
                debugLog('[explorar:workspace-search] preview-enrich-failed', {
                  filePath: entry.path,
                  query: normalizedQuery,
                  error: error instanceof Error ? error.message : String(error),
                });
                return null;
              }
            })
          );

          if (workspaceSearchResultsRequestIdRef.current !== requestId) {
            return;
          }

          const mergedByFile = new Map<string, WorkspaceSearchResult>();
          for (const result of immediateResults) {
            mergedByFile.set(result.file, result);
          }
          for (const result of previewResults) {
            if (!result) continue;
            mergedByFile.set(result.file, result);
          }

          setWorkspaceSearchResults(Array.from(mergedByFile.values()));
        } catch (error) {
          if (workspaceSearchResultsRequestIdRef.current !== requestId) {
            return;
          }
          setWorkspaceSearchError(
            error instanceof Error ? error.message : 'Failed to search workspace'
          );
          setWorkspaceSearchResults([]);
          setWorkspaceSearchHasMore(false);
        } finally {
          if (workspaceSearchResultsRequestIdRef.current === requestId) {
            setWorkspaceSearchLoading(false);
          }
        }
      };

      void runSearch();
    }, 150);

    return () => window.clearTimeout(timeoutId);
  }, [
    layoutMode,
    workspaceSearchIndex,
    workspaceSearchIndexError,
    workspaceSearchIndexLoading,
    workspaceSearchQuery,
    fetchFileFromSelectedSource,
  ]);

  const onEditorContentLoad = useCallback(
    (content: string) => {
      if (!activeTab) return;
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTab.id ? { ...t, isLoading: false, content } : t))
      );
    },
    [activeTab]
  );

  // Track if we're currently refreshing to prevent loops

  const guideStorageScope = useMemo(() => {
    const sectionIds = guideSections.map((section) => section.id).join('|');
    return `default:${sectionIds}`;
  }, [guideSections]);

  const guideActiveChapterStorageKey = useMemo(
    () => `guide-panel-active-chapter:${guideStorageScope}`,
    [guideStorageScope]
  );
  const guideDefaultChapterId = useMemo(() => {
    const sectionIds = new Set(guideSections.map((section) => section.id));
    const configuredDefault = projectConfig?.guides?.[0]?.defaultOpenIds?.find((id) =>
      sectionIds.has(id)
    );
    return configuredDefault || guideSections[0]?.id || null;
  }, [guideSections, projectConfig]);

  const guideStateInitKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!guideSections.length) return;
    if (guideStateInitKeyRef.current === guideActiveChapterStorageKey) return;

    let nextActiveChapterId = guideDefaultChapterId;
    try {
      const savedActiveChapter = localStorage.getItem(guideActiveChapterStorageKey);
      if (
        savedActiveChapter &&
        guideSections.some((section) => section.id === savedActiveChapter)
      ) {
        nextActiveChapterId = savedActiveChapter;
      }
    } catch {
      // ignore
    }

    setActiveChapterId(nextActiveChapterId);
    guideStateInitKeyRef.current = guideActiveChapterStorageKey;
  }, [guideActiveChapterStorageKey, guideDefaultChapterId, guideSections]);

  useEffect(() => {
    if (guideStateInitKeyRef.current !== guideActiveChapterStorageKey) return;
    try {
      if (activeChapterId) {
        localStorage.setItem(guideActiveChapterStorageKey, activeChapterId);
      } else {
        localStorage.removeItem(guideActiveChapterStorageKey);
      }
    } catch {
      // ignore
    }
  }, [activeChapterId, guideActiveChapterStorageKey]);

  // Open explicit file targets as soon as they are requested.
  // Tree readiness is useful for directory expansion/highlighting, but should
  // not block the editor from opening and fetching a file.
  useEffect(() => {
    // Restore persisted tabs before opening a URL target so restoration cannot erase it.
    if (!tabsRestored) return;
    let repoInitialFile = initialFile;
    if (!repoInitialFile && typeof window !== 'undefined') {
      const urlTarget = resolveRepositoryNavigation(
        window.location.pathname,
        window.location.search.slice(1),
        window.location.hash
      );
      if (urlTarget && urlTarget.owner === owner && urlTarget.repo === repo && urlTarget.filePath) {
        repoInitialFile = {
          path: urlTarget.filePath,
          exactPath: true,
          scrollToLine: urlTarget.line,
          navigationNonce: Date.now(),
        };
      }
    }
    if (!repoInitialFile) return;
    const isDirectoryTarget =
      typeof repoInitialFile === 'object' &&
      !Array.isArray(repoInitialFile) &&
      repoInitialFile.kind === 'directory';
    if (isDirectoryTarget) {
      const directoryTarget = repoInitialFile as Extract<InitialFileTarget, { kind: 'directory' }>;
      const key = `directory:${directoryTarget.path}|||${directoryTarget.navigationNonce || ''}`;
      if (key === lastOpenedInitialFileRef.current) return;
      lastOpenedInitialFileRef.current = key;
      setTimeout(() => {
        setDirectoryExpandRequest({ path: directoryTarget.path, id: Date.now() });
      }, 0);
      return;
    }

    if (
      typeof repoInitialFile === 'object' &&
      !Array.isArray(repoInitialFile) &&
      (!('path' in repoInitialFile) || repoInitialFile.kind === 'directory')
    ) {
      return;
    }

    const paths = Array.isArray(repoInitialFile)
      ? repoInitialFile
      : typeof repoInitialFile === 'string'
        ? [repoInitialFile]
        : [repoInitialFile.path];
    const key =
      typeof repoInitialFile === 'string' || Array.isArray(repoInitialFile)
        ? paths.join('|||')
        : `${repoInitialFile.path}|||${repoInitialFile.exactPath || false}|||${repoInitialFile.searchPattern || ''}|||${repoInitialFile.scrollToLine || ''}|||${repoInitialFile.searchScope?.join(':::') || ''}|||${repoInitialFile.navigationNonce || ''}`;
    if (key === lastOpenedInitialFileRef.current) return;
    debugLog('[explorar:open-file] initial-file-trigger', {
      key,
      initialFile,
      isTreeStructureReady,
    });
    lastOpenedInitialFileRef.current = key;
    // Defer to avoid synchronous setState-in-effect warning.
    // Open header first so the primary (.c) ends up as the active tab.
    setTimeout(() => {
      void (async () => {
        for (let i = 0; i < paths.length - 1; i++) {
          await openFileInTab(paths[i]);
        }

        if (typeof repoInitialFile === 'string' || Array.isArray(repoInitialFile)) {
          await openFileInTab(paths[paths.length - 1]);
        } else {
          await openFileInTab(
            repoInitialFile.path,
            repoInitialFile.searchPattern,
            repoInitialFile.scrollToLine,
            repoInitialFile.searchScope,
            undefined,
            { exactPath: repoInitialFile.exactPath }
          );
        }
      })();
    }, 0);
  }, [initialFile, tabsRestored, isTreeStructureReady, openFileInTab, owner, repo]);

  // Repository error
  if (repoError) {
    notFound();
    return null;
  }

  return (
    <div
      className={`vscode-container vscode-theme-${workspaceTheme}`}
      style={{ position: 'relative' }}
    >
      <div style={{ display: 'flex', flex: 1, minHeight: 0, height: '100%', overflow: 'hidden' }}>
        {layoutMode !== 'viewer' && layoutMode !== 'semantic' && (
          <div
            className={`vscode-sidebar ${isSidebarOpen && (isMobile ? mobileView === 'explorer' : true) ? 'mobile-open' : ''} ${isMobile && mobileView !== 'explorer' ? 'mobile-hidden' : ''}`}
            suppressHydrationWarning
            style={{
              width: layoutMode === 'search' ? '360px' : `${sidebarWidth}px`,
              minWidth: layoutMode === 'search' ? '300px' : '180px',
              maxWidth: layoutMode === 'search' ? '42vw' : '40vw',
              flex: '0 0 auto',
            }}
          >
            {isMobile && (
              <div
                style={{
                  padding: '12px',
                  borderBottom: '1px solid var(--vscode-border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600' }}>Explorer</h3>
                <button
                  onClick={() => setMobileView('editor')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--vscode-text-primary)',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    fontSize: '18px',
                  }}
                  aria-label="Close explorer"
                >
                  ✕
                </button>
              </div>
            )}
            <div
              className="vscode-sidebar-content"
              style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}
            >
              <FileTree
                key={`tree-${repoLabel}-${selectedVersion}-${fileSourceMode}`}
                onFileSelect={(filePath: string) => {
                  handleOpenFileFromExplorer(filePath);
                  // On mobile, switch to editor view when file is selected
                  if (isMobile) {
                    setMobileView('editor');
                  }
                }}
                selectedFile={selectedFile}
                listDirectory={listDirectoryFromSelectedSource}
                titleLabel={repoLabel}
                expandDirectoryRequest={directoryExpandRequest}
                searchQuery={workspaceSearchQuery}
                onSearchQueryChange={setWorkspaceSearchQuery}
                searchResults={workspaceSearchResults}
                isSearchLoading={workspaceSearchLoading}
                isSearchIndexLoading={workspaceSearchIndexLoading}
                isSearchIndexReady={
                  !!workspaceSearchIndex &&
                  !workspaceSearchIndexLoading &&
                  !workspaceSearchIndexError
                }
                searchIndexProgress={workspaceSearchIndexProgress}
                searchIndexCached={workspaceSearchIndexCached}
                searchError={workspaceSearchError}
                searchHasMore={workspaceSearchHasMore}
                searchScopeLabel={repoLabel ? `${repoLabel}@${selectedVersion}` : selectedVersion}
                searchScopeFileCount={workspaceSearchIndex?.fileCount ?? workspaceFilePaths.length}
                onSearchResultSelect={(result) => {
                  handleOpenFileFromExplorer(result.file, workspaceSearchQuery, result.line);
                  if (isMobile) {
                    setMobileView('editor');
                  }
                }}
                showSearch={layoutMode === 'search'}
                onDirectoryExpand={(path: string) => {
                  setSelectedFile(path);
                }}
              />
            </div>
          </div>
        )}

        {layoutMode !== 'viewer' && (
          <>
            <div
              className="resize-handle"
              onMouseDown={() => handleMouseDown('sidebar')}
              suppressHydrationWarning
              style={{
                width: '4px',
                backgroundColor:
                  isResizing === 'sidebar'
                    ? 'var(--repo-accent, var(--vscode-text-accent))'
                    : 'transparent',
                cursor: 'col-resize',
                borderRight: '1px solid var(--vscode-border)',
              }}
            />
          </>
        )}

        {layoutMode === 'semantic' ? (
          <div
            className="vscode-editor-container"
            style={{ flex: 1, minWidth: 0, display: 'flex' }}
          >
            <SemanticGraphTab
              isActive={layoutMode === 'semantic'}
              codeIndex={workspaceSearchIndex}
              indexLoading={workspaceSearchIndexLoading}
              indexReady={!!workspaceSearchIndex}
              indexError={workspaceSearchIndexError}
              indexProgress={workspaceSearchIndexProgress}
              indexCached={workspaceSearchIndexCached}
              repoLabel={repoLabel}
              onOpenFile={openFileInTab}
            />
          </div>
        ) : (
          <div
            className={`vscode-editor-container ${isMobile && mobileView !== 'editor' ? 'mobile-hidden' : ''}`}
            style={{ flex: 1, minWidth: '300px', display: 'flex', flexDirection: 'column' }}
          >
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onTabSelect={onTabSelect}
              onTabClose={onTabClose}
              onCloseAllTabs={onCloseAllTabs}
              onMarkdownPreviewToggle={toggleMarkdownPreview}
            />
            {activeTab ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <CodeEditorContainer
                  key={fileSourceMode}
                  filePath={activeTab.path}
                  onContentLoad={onEditorContentLoad}
                  onOpenFile={openFileInTab}
                  fetchFile={fetchFileFromSelectedSource}
                  workspaceFilePaths={workspaceFilePaths}
                  workspaceId={`${fileSourceMode}:${repoLabel}@${selectedVersion}`}
                  codeIndex={workspaceSearchIndex}
                  markdownViewMode={activeTab.viewMode}
                  onToggleMarkdownPreview={toggleMarkdownPreview}
                  scrollToLine={activeTab.scrollToLine}
                  searchPattern={activeTab.searchPattern}
                  navigationNonce={activeTab.navigationNonce}
                  editorTheme={editorTheme}
                />
              </div>
            ) : (
              <div className="vscode-empty-state">
                <div>Open a file from the explorer to begin</div>
              </div>
            )}
          </div>
        )}

        {!hideGuidePanel && (
          <div
            className="resize-handle"
            onMouseDown={() => handleMouseDown('rightPanel')}
            suppressHydrationWarning
            style={{
              width: '4px',
              backgroundColor:
                isResizing === 'rightPanel'
                  ? 'var(--repo-accent, var(--vscode-text-accent))'
                  : 'transparent',
              cursor: 'col-resize',
              borderLeft: '1px solid var(--vscode-border)',
            }}
          />
        )}

        {!hideGuidePanel && (
          <div
            className={`vscode-panel ${isRightPanelOpen && (isMobile ? mobileView === 'guide' : true) ? 'mobile-open' : ''} ${isMobile && mobileView !== 'guide' ? 'mobile-hidden' : ''}`}
            suppressHydrationWarning
            style={{
              width: `${rightPanelWidth}px`,
              minWidth: '200px',
              maxWidth: '40vw',
              height: '100%',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            {isMobile && (
              <div
                style={{
                  padding: '12px',
                  borderBottom: '1px solid var(--vscode-border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <button
                  onClick={() => setMobileView('editor')}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--vscode-text-primary)',
                    cursor: 'pointer',
                    padding: '4px 8px',
                    fontSize: '18px',
                  }}
                  aria-label="Close panel"
                >
                  ✕
                </button>
              </div>
            )}
            <div
              style={{
                flex: '1 1 0%',
                minHeight: 0,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <RepositoryRightPanel owner={owner || ''} repo={repo || ''} theme={workspaceTheme}>
                <GuidePanel
                  key={`guide-${guideStorageScope}`}
                  sections={guideSections}
                  activeChapterId={activeChapterId}
                  onActiveChapterChange={setActiveChapterId}
                />
              </RepositoryRightPanel>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Navigation Bar */}
      {isMobile && (
        <div
          className="mobile-nav-bar"
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            height: '56px',
            background: 'var(--vscode-bg-secondary)',
            borderTop: '1px solid var(--vscode-border)',
            display: 'flex',
            justifyContent: 'space-around',
            alignItems: 'center',
            zIndex: 1000,
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <button
            onClick={() => setMobileView('explorer')}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              background: 'transparent',
              border: 'none',
              color:
                mobileView === 'explorer'
                  ? 'var(--repo-accent, var(--vscode-text-accent))'
                  : 'var(--vscode-text-secondary)',
              cursor: 'pointer',
              padding: '8px',
              fontSize: '12px',
              transition: 'color 0.2s',
            }}
            aria-label="Explorer"
          >
            <span style={{ fontSize: '20px' }}>📁</span>
            <span>Explorer</span>
          </button>
          <button
            onClick={() => setMobileView('editor')}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              background: 'transparent',
              border: 'none',
              color:
                mobileView === 'editor'
                  ? 'var(--repo-accent, var(--vscode-text-accent))'
                  : 'var(--vscode-text-secondary)',
              cursor: 'pointer',
              padding: '8px',
              fontSize: '12px',
              transition: 'color 0.2s',
            }}
            aria-label="Editor"
          >
            <span style={{ fontSize: '20px' }}>📝</span>
            <span>Editor</span>
          </button>
          <button
            onClick={() => setMobileView('guide')}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              background: 'transparent',
              border: 'none',
              color:
                mobileView === 'guide'
                  ? 'var(--repo-accent, var(--vscode-text-accent))'
                  : 'var(--vscode-text-secondary)',
              cursor: 'pointer',
              padding: '8px',
              fontSize: '12px',
              transition: 'color 0.2s',
            }}
            aria-label="Guide and chat"
          >
            <span style={{ fontSize: '20px' }}>📚</span>
            <span>Guide / Chat</span>
          </button>
        </div>
      )}
    </div>
  );
}
