'use client';

import {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import RepositoryWorkspaceExplorer, {
  type InitialFileTarget,
} from './components/RepositoryWorkspaceExplorer';
import GuidePanel from './components/GuidePanel';
import IconSidebarToggleButton from './components/IconSidebarToggleButton';
import RepositoryRightPanel from './components/RepositoryRightPanel';
import RepositoryChatPanel from './components/RepositoryChatPanel';
import StatusBar from './components/StatusBar';
import { useRepositoryGuide } from './useRepositoryGuide';
import { getProjectConfig, createGenericGuide } from '@/lib/project-guides';
import { parseGuideMarkdown } from '@/features/guides/parser';
import { debugLog } from '@/lib/browser-debug';
import { useRepository } from '@/contexts/RepositoryContext';
import { getCuratedRepoAccent, getCuratedRepoPath } from '@/lib/curated-repos';
import type { GitHubUrlTarget } from '@/lib/github-url';
import { resolveRepositoryNavigation } from '@/lib/github-url';
import {
  hasConfiguredR2BucketBaseUrl,
  isLocalFilesystemCorpusAvailable,
  normalizeCuratedRepoSourceMode,
} from '@/lib/curated-content-url';
import type { CuratedRepoSourceMode } from '@/lib/repo-static';
import {
  CORPUS_SOURCE_MODE_STORAGE_KEY,
  getStoredCuratedRepoSourceMode,
} from '@/lib/repository-preferences';
import '@/app/vscode.css';

const RepositoryQuizPanel = dynamic(() => import('./components/ChapterQuizPanel'), {
  ssr: false,
  loading: () => <p role="status">Loading quiz…</p>,
});

const GUIDE_DEFAULT_WIDTH = 300;
const GUIDE_MIN_WIDTH = 200;
const GUIDE_MAX_WIDTH = 520;
const LEFT_PANE_DEFAULT_WIDTH = 300;
const LEFT_PANE_MIN_WIDTH = 200;
const LEFT_PANE_MAX_WIDTH = 520;
const LEFT_PANE_WIDTH_STORAGE_KEY = 'repository-workspace-explorer-sidebar-width';
const GUIDE_SIDEBAR_OPEN_STORAGE_KEY = 'repository-explorer-guide-sidebar-open';
const WORKSPACE_THEME_STORAGE_KEY = 'repository-workspace-explorer-theme';
let navigationNonceCounter = 0;

const subscribeToHydration = () => () => {};

const EntityView = dynamic(
  () => import('./components/EntityView').then((module) => module.EntityView),
  { loading: () => null }
);

function createOpenFileTarget(
  fileId: string,
  searchPattern?: string,
  scrollToLine?: number,
  searchScope?: string[]
): InitialFileTarget | string[] {
  const paths = fileId.includes('|||') ? fileId.split('|||') : null;
  return (
    paths ?? {
      path: fileId,
      searchPattern,
      scrollToLine,
      searchScope,
      navigationNonce: createNavigationNonce(),
    }
  );
}

type WorkspaceTheme = 'dark' | 'light';

function resolveRequestedPaths(
  searchParams: Pick<URLSearchParams, 'get'>,
  directTarget?: Pick<GitHubUrlTarget, 'filePath' | 'targetType'>
) {
  const requestedDirectory = searchParams.get('dir')?.trim();
  const requestedFile = searchParams.get('file')?.trim();
  return {
    filePath: requestedFile || directTarget?.filePath,
    directoryPath:
      requestedDirectory ||
      (directTarget?.targetType === 'directory' ? directTarget.filePath : undefined) ||
      (requestedFile?.endsWith('/') ? requestedFile.replace(/\/+$/, '') : undefined),
  };
}

function createNavigationNonce(): number {
  navigationNonceCounter = (navigationNonceCounter + 1) % Number.MAX_SAFE_INTEGER;
  return Date.now() + navigationNonceCounter / 1000000;
}

function isExpectedCancellation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  return name === 'Canceled' || message === 'Canceled: Canceled';
}

interface RepositoryExplorerClientProps {
  owner: string;
  repo: string;
  initialSourceMode: CuratedRepoSourceMode;
  directTarget?: GitHubUrlTarget;
  guideContent?: string;
  guideDefaultOpenIds?: string[];
  loadingTitle?: string;
  loadingDescription?: string;
}

export default function RepositoryExplorerClient({
  owner,
  repo,
  initialSourceMode,
  directTarget,
  guideContent,
  guideDefaultOpenIds,
  loadingTitle: _loadingTitle,
  loadingDescription: _loadingDescription,
}: RepositoryExplorerClientProps) {
  const projectConfig = getProjectConfig(owner, repo);

  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const browserTarget = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return resolveRepositoryNavigation(window.location.pathname, queryString, window.location.hash);
  }, [queryString]);
  const effectiveDirectTarget = directTarget ?? browserTarget ?? undefined;
  // Curated routes always use their seeded revision. Arbitrary routes keep
  // the explicit URL ref and resolve a default branch only when absent.
  const requestedBranch = projectConfig
    ? undefined
    : searchParams.get('ref') || effectiveDirectTarget?.branch;
  const { currentBranch, identifier } = useRepository();
  const [guideLocation, setGuideLocation] = useState('');
  const [mode, setMode] = useState<
    'editor' | 'search' | 'entities' | 'semantic' | 'chat' | 'quiz' | null
  >(searchParams.get('view') === 'quiz' ? 'quiz' : 'editor');
  const [chatMounted, setChatMounted] = useState(false);
  const [quizMounted, setQuizMounted] = useState(searchParams.get('view') === 'quiz');
  // This value is calculated by the Server Component and serialized into the
  // RSC payload, so the server render and hydration render use the same source.
  const [fileSourceMode, setFileSourceMode] = useState<CuratedRepoSourceMode>(initialSourceMode);
  const [workspaceTheme, setWorkspaceTheme] = useState<WorkspaceTheme>(() => {
    try {
      if (typeof window === 'undefined') return 'dark';
      const savedTheme = localStorage.getItem(WORKSPACE_THEME_STORAGE_KEY);
      if (savedTheme === 'dark' || savedTheme === 'light') {
        return savedTheme;
      }
    } catch {
      // Keep the default dark workspace.
    }
    return 'dark';
  });
  const [initialFile, setInitialFile] = useState<InitialFileTarget | null>(() => {
    const { filePath, directoryPath } = resolveRequestedPaths(searchParams, effectiveDirectTarget);
    if (directoryPath) {
      return {
        kind: 'directory',
        path: directoryPath,
        navigationNonce: 0,
      };
    }
    if (!filePath) return null;
    const lineValue = searchParams.get('line');
    const parsedLine = lineValue ? parseInt(lineValue, 10) : Number.NaN;
    return {
      path: filePath,
      exactPath: true,
      searchPattern: searchParams.get('search') || undefined,
      scrollToLine: Number.isFinite(parsedLine) ? parsedLine : effectiveDirectTarget?.line,
      navigationNonce: 0,
    };
  });
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState('');
  const activateFileSearch = useCallback(() => setMode('search'), []);

  useEffect(() => {
    const suppressExpectedCancellation = (event: PromiseRejectionEvent) => {
      if (isExpectedCancellation(event.reason)) {
        event.preventDefault();
      }
    };

    window.addEventListener('unhandledrejection', suppressExpectedCancellation);
    return () => window.removeEventListener('unhandledrejection', suppressExpectedCancellation);
  }, []);

  const hasHydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false
  );
  const [savedGuideSidebarOpen, setIsGuideSidebarOpen] = useState(() => {
    try {
      if (typeof window === 'undefined') return true;
      const savedGuideSidebarOpen = localStorage.getItem(GUIDE_SIDEBAR_OPEN_STORAGE_KEY);
      if (savedGuideSidebarOpen === 'true' || savedGuideSidebarOpen === 'false') {
        return savedGuideSidebarOpen === 'true';
      }
    } catch {
      // Keep the default visible sidebar.
    }
    return true;
  });
  // The server and hydration pass must render the same sidebar structure.
  const isGuideSidebarOpen = hasHydrated ? savedGuideSidebarOpen : true;
  const [savedLeftPaneWidth, setLeftPaneWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(LEFT_PANE_WIDTH_STORAGE_KEY));
      if (Number.isFinite(saved) && saved > 0) {
        return Math.min(LEFT_PANE_MAX_WIDTH, Math.max(LEFT_PANE_MIN_WIDTH, saved));
      }
    } catch {
      // Use the default when storage is unavailable.
    }
    return LEFT_PANE_DEFAULT_WIDTH;
  });
  const leftPaneWidth = hasHydrated ? savedLeftPaneWidth : LEFT_PANE_DEFAULT_WIDTH;
  const leftPaneDrag = useRef<{ x: number; width: number } | null>(null);
  const resizeLeftPane = (width: number) => {
    setLeftPaneWidth(Math.min(LEFT_PANE_MAX_WIDTH, Math.max(LEFT_PANE_MIN_WIDTH, width)));
  };
  useEffect(() => {
    if (!hasHydrated) return;
    try {
      localStorage.setItem(LEFT_PANE_WIDTH_STORAGE_KEY, String(savedLeftPaneWidth));
    } catch {
      // Resizing remains available without persistence.
    }
  }, [hasHydrated, savedLeftPaneWidth]);
  // Keep EntityView mounted once first activated to preserve per-chapter cache
  const [entitiesMounted, setEntitiesMounted] = useState(false);
  const urlInitialFile = useMemo<InitialFileTarget | null>(() => {
    const requestedFile = searchParams.get('file')?.trim() || effectiveDirectTarget?.filePath;
    if (!requestedFile) return null;
    const lineValue = searchParams.get('line');
    const parsedLine = lineValue ? parseInt(lineValue, 10) : Number.NaN;
    return {
      path: requestedFile,
      exactPath: true,
      searchPattern: searchParams.get('search') || undefined,
      scrollToLine: Number.isFinite(parsedLine) ? parsedLine : effectiveDirectTarget?.line,
      navigationNonce: 0,
    };
  }, [effectiveDirectTarget?.filePath, effectiveDirectTarget?.line, searchParams]);

  const navigateToRepoTarget = useCallback(
    (
      fileId: string,
      searchPattern?: string,
      scrollToLine?: number,
      repoTarget?: { owner: string; repo: string }
    ) => {
      if (repoTarget && (repoTarget.owner !== owner || repoTarget.repo !== repo)) {
        const params = new URLSearchParams({ file: fileId });
        if (searchPattern) params.set('search', searchPattern);
        if (typeof scrollToLine === 'number') params.set('line', String(scrollToLine));
        try {
          sessionStorage.setItem(
            'explorar:repo-switch-flash',
            JSON.stringify({
              from: `${owner}/${repo}`,
              to: `${repoTarget.owner}/${repoTarget.repo}`,
              ts: Date.now(),
            })
          );
        } catch {
          // Ignore storage failures; the navigation itself still succeeds.
        }
        router.push(`${getCuratedRepoPath(repoTarget.owner, repoTarget.repo)}?${params}`);
        return true;
      }

      return false;
    },
    [owner, repo, router]
  );

  const handleEnterFile = useCallback(
    (
      fileId: string,
      searchPattern?: string,
      scrollToLine?: number,
      searchScope?: string[],
      repoTarget?: { owner: string; repo: string }
    ) => {
      debugLog('[explorar:open-file] guide-request', {
        fileId,
        searchPattern,
        scrollToLine,
        searchScope,
        repoTarget,
      });
      if (navigateToRepoTarget(fileId, searchPattern, scrollToLine, repoTarget)) {
        return;
      }

      // Paired nodes encode both paths as "primary|||header".
      setInitialFile(createOpenFileTarget(fileId, searchPattern, scrollToLine, searchScope));
      setMode((current) => (current === 'quiz' ? 'quiz' : 'editor'));
    },
    [navigateToRepoTarget]
  );

  const handleOpenFileInCurrentMode = useCallback(
    (
      fileId: string,
      searchPattern?: string,
      scrollToLine?: number,
      searchScope?: string[],
      repoTarget?: { owner: string; repo: string }
    ) => {
      debugLog('[explorar:open-file] context-request', {
        fileId,
        searchPattern,
        scrollToLine,
        searchScope,
        repoTarget,
      });
      if (navigateToRepoTarget(fileId, searchPattern, scrollToLine, repoTarget)) {
        return;
      }

      setInitialFile(createOpenFileTarget(fileId, searchPattern, scrollToLine, searchScope));
    },
    [navigateToRepoTarget]
  );

  useEffect(() => {
    const { filePath, directoryPath } = resolveRequestedPaths(searchParams, {
      filePath: effectiveDirectTarget?.filePath,
      targetType: effectiveDirectTarget?.targetType,
    });
    if (directoryPath) {
      const timeoutId = window.setTimeout(() => {
        setInitialFile({
          kind: 'directory',
          path: directoryPath,
          navigationNonce: createNavigationNonce(),
        });
      }, 0);
      return () => window.clearTimeout(timeoutId);
    }
    if (!filePath) {
      const timeoutId = window.setTimeout(() => setInitialFile(null), 0);
      return () => window.clearTimeout(timeoutId);
    }

    const lineValue = searchParams.get('line');
    const parsedLine = lineValue ? parseInt(lineValue, 10) : Number.NaN;
    const timeoutId = window.setTimeout(() => {
      setInitialFile({
        path: filePath,
        exactPath: true,
        searchPattern: searchParams.get('search') || undefined,
        scrollToLine: Number.isFinite(parsedLine) ? parsedLine : effectiveDirectTarget?.line,
        navigationNonce: createNavigationNonce(),
      });
      setMode((current) => (current === 'quiz' ? 'quiz' : 'editor'));
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [
    effectiveDirectTarget?.filePath,
    effectiveDirectTarget?.line,
    effectiveDirectTarget?.targetType,
    queryString,
    searchParams,
  ]);

  // ── Guide sections ──────────────────────────────────────────────────────────
  const handleDiscoveredFile = useCallback((path: string) => {
    setInitialFile(
      path.endsWith('/')
        ? {
            kind: 'directory',
            path: path.replace(/\/+$/, ''),
            navigationNonce: createNavigationNonce(),
          }
        : { path, exactPath: true, navigationNonce: createNavigationNonce() }
    );
    setMode((current) => (current === 'quiz' ? 'quiz' : 'editor'));
  }, []);
  const discoveredGuide = useRepositoryGuide({
    owner,
    repo,
    revision: requestedBranch || (identifier === `${owner}~${repo}` ? currentBranch : null),
    enabled: !projectConfig && !guideContent,
    onOpen: handleDiscoveredFile,
    location: guideLocation,
  });
  const guideSections = useMemo(() => {
    if (guideContent) {
      try {
        return parseGuideMarkdown(guideContent, handleEnterFile);
      } catch {
        // fall through to generic
      }
    }
    return projectConfig ? createGenericGuide(owner, repo) : discoveredGuide;
  }, [guideContent, owner, repo, handleEnterFile, projectConfig, discoveredGuide]);

  const defaultOpenIds = useMemo(
    () =>
      guideDefaultOpenIds ||
      projectConfig?.guides?.[0]?.defaultOpenIds ||
      (guideSections.length > 0 ? [guideSections[0].id] : []),
    [guideDefaultOpenIds, projectConfig, guideSections]
  );
  const repoLabel = `${owner}/${repo}`;
  const repoAccent = getCuratedRepoAccent(owner, repo);
  const statusBranch = currentBranch || projectConfig?.defaultRevision || requestedBranch || 'main';
  const showDevSourceMode = isLocalFilesystemCorpusAvailable();
  const isR2SourceConfigured = hasConfiguredR2BucketBaseUrl();

  // ── Chapter graph state ─────────────────────────────────────────────────────
  const [activeChapterId, setActiveChapterId] = useState<string | null>(
    () => defaultOpenIds[0] ?? guideSections[0]?.id ?? null
  );
  const chapterMapEntries = useMemo(
    () =>
      guideSections.map((section) => ({
        id: section.id,
        files: section.narrativePaths ?? [],
      })),
    [guideSections]
  );
  const handleSourceModeChange = useCallback((sourceMode: CuratedRepoSourceMode) => {
    const normalizedSourceMode = normalizeCuratedRepoSourceMode(sourceMode);
    setFileSourceMode(normalizedSourceMode);
    try {
      localStorage.setItem(CORPUS_SOURCE_MODE_STORAGE_KEY, normalizedSourceMode);
    } catch {
      // Ignore storage failures.
    }
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    try {
      localStorage.setItem(GUIDE_SIDEBAR_OPEN_STORAGE_KEY, String(savedGuideSidebarOpen));
    } catch {
      // Ignore storage failures.
    }
  }, [hasHydrated, savedGuideSidebarOpen]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setFileSourceMode(getStoredCuratedRepoSourceMode());
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(WORKSPACE_THEME_STORAGE_KEY, workspaceTheme);
    } catch {
      // Ignore storage failures.
    }
  }, [workspaceTheme]);

  // ── Guide panel resize ──────────────────────────────────────────────────────
  const [guideWidth, setGuideWidth] = useState(GUIDE_DEFAULT_WIDTH);
  const isResizingGuide = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);
  const pendingClientX = useRef(0);
  const resizeRaf = useRef<number | null>(null);

  const handleGuideResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      isResizingGuide.current = true;
      resizeStartX.current = e.clientX;
      resizeStartWidth.current = guideWidth;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [guideWidth]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!isResizingGuide.current) return;
      // Capture latest X but only schedule one RAF per frame
      pendingClientX.current = e.clientX;
      if (resizeRaf.current !== null) return;
      resizeRaf.current = requestAnimationFrame(() => {
        resizeRaf.current = null;
        const delta = resizeStartX.current - pendingClientX.current;
        const next = Math.min(
          GUIDE_MAX_WIDTH,
          Math.max(GUIDE_MIN_WIDTH, resizeStartWidth.current + delta)
        );
        setGuideWidth(next);
      });
    };
    const onUp = () => {
      isResizingGuide.current = false;
      if (resizeRaf.current !== null) {
        cancelAnimationFrame(resizeRaf.current);
        resizeRaf.current = null;
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  return (
    <main
      className={`vscode-theme-${workspaceTheme} shaman-workspace-enter`}
      suppressHydrationWarning
      style={
        {
          width: '100vw',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--vscode-bg-primary)',
          color: 'var(--vscode-text-primary)',
          '--repo-accent': repoAccent,
          '--repo-selection-bg':
            'color-mix(in srgb, var(--repo-accent, var(--vscode-text-accent)) 24%, var(--vscode-bg-primary))',
        } as CSSProperties
      }
    >
      <p
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {owner}/{repo} Explorer
      </p>
      {_loadingDescription && (
        <p
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: 'hidden',
            clip: 'rect(0,0,0,0)',
            whiteSpace: 'nowrap',
            border: 0,
          }}
        >
          {_loadingDescription}
        </p>
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'row',
          position: 'relative',
        }}
      >
        {/* ── Activity bar ── */}
        <div
          className="workspace-activity-bar"
          style={{
            width: 48,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 8,
            padding: '10px 8px',
            background: 'var(--vscode-bg-secondary)',
          }}
        >
          {[
            {
              id: 'editor',
              title: 'File editor',
              icon: (
                <>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                  <path d="M14 2v6h6M10 12l-3 3 3 3m4-6 3 3-3 3" />
                </>
              ),
            },
            {
              id: 'search',
              title: 'File search',
              icon: (
                <>
                  <circle cx="10.5" cy="10.5" r="6.5" />
                  <path d="m16 16 5 5" />
                </>
              ),
            },
            {
              id: 'entities',
              title: 'Entities',
              icon: (
                <>
                  <rect x="9" y="3" width="6" height="6" rx="1" />
                  <rect x="3" y="15" width="6" height="6" rx="1" />
                  <rect x="15" y="15" width="6" height="6" rx="1" />
                  <path d="M12 9v3M6 15v-3h12v3" />
                </>
              ),
            },
            {
              id: 'quiz',
              title: 'Quiz',
              icon: (
                <>
                  <path d="M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3" />
                  <circle cx="12" cy="17" r="0.75" />
                  <rect x="3" y="2" width="18" height="20" rx="3" />
                </>
              ),
            },
            {
              id: 'chat',
              title: 'Chat',
              icon: (
                <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 3V11.5A8.5 8.5 0 0 1 9.5 3h3a8.5 8.5 0 0 1 8.5 8.5ZM7 10h8m-8 4h5" />
              ),
            },
          ].map((tab) => {
            const isActive = mode === tab.id;
            return (
              <button
                className="workspace-activity-button"
                key={tab.id}
                onClick={() => {
                  if (tab.id === 'entities') {
                    setEntitiesMounted(true);
                  }
                  if (tab.id === 'chat') setChatMounted(true);
                  if (tab.id === 'quiz') setQuizMounted(true);
                  setMode((current) => (current === tab.id ? null : (tab.id as typeof mode)));
                }}
                title={tab.title}
                aria-label={tab.title}
                aria-pressed={isActive}
                aria-expanded={isActive}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 6,
                  border: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {tab.icon}
                </svg>
              </button>
            );
          })}
        </div>

        {/* ── Main content area ── */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
          {mode !== null && mode !== 'semantic' && (
            <div
              role="separator"
              aria-label="Resize left pane"
              aria-orientation="vertical"
              aria-valuemin={LEFT_PANE_MIN_WIDTH}
              aria-valuemax={LEFT_PANE_MAX_WIDTH}
              aria-valuenow={leftPaneWidth}
              tabIndex={0}
              className="workspace-left-pane-resizer"
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: leftPaneWidth,
                width: 4,
                zIndex: 3,
                cursor: 'col-resize',
                touchAction: 'none',
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                leftPaneDrag.current = { x: event.clientX, width: leftPaneWidth };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const drag = leftPaneDrag.current;
                if (drag) resizeLeftPane(drag.width + event.clientX - drag.x);
              }}
              onPointerUp={(event) => {
                leftPaneDrag.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onLostPointerCapture={() => {
                leftPaneDrag.current = null;
              }}
              onKeyDown={(event) => {
                const delta = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0;
                if (!delta) return;
                event.preventDefault();
                resizeLeftPane(leftPaneWidth + delta);
              }}
            />
          )}
          {/* Explorer surface — used by both editor and search tabs */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left:
                mode === 'entities' || mode === 'chat' || mode === 'quiz' ? leftPaneWidth + 4 : 0,
              opacity: 1,
              pointerEvents: 'auto',
              transition: 'opacity 0.35s ease',
              zIndex: 1,
            }}
          >
            <RepositoryWorkspaceExplorer
              key={`${owner}/${repo}@${requestedBranch ?? 'default'}:${fileSourceMode}`}
              owner={owner}
              repo={repo}
              branch={requestedBranch}
              initialFile={initialFile ?? urlInitialFile}
              hideGuidePanel
              leftPaneWidth={leftPaneWidth}
              onSelectedFileChange={setGuideLocation}
              layoutMode={
                mode === 'search'
                  ? 'search'
                  : mode === 'entities' || mode === 'chat' || mode === 'quiz' || mode === null
                    ? 'viewer'
                    : mode === 'semantic'
                      ? 'semantic'
                      : 'editor'
              }
              sourceMode={fileSourceMode}
              workspaceTheme={workspaceTheme}
              workspaceSearchQuery={sidebarSearchQuery}
              onWorkspaceSearchQueryChange={setSidebarSearchQuery}
              onActivateFileSearch={activateFileSearch}
            />
          </div>

          <div
            hidden={mode !== 'chat'}
            className="repository-panel-chat"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: leftPaneWidth,
              background: 'var(--vscode-bg-secondary)',
            }}
          >
            {chatMounted && (
              <RepositoryChatPanel
                key={`${owner}/${repo}`}
                owner={owner}
                repo={repo}
                theme={workspaceTheme}
              />
            )}
          </div>

          <div
            hidden={mode !== 'quiz'}
            className="repository-panel-quiz"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: leftPaneWidth,
              background: 'var(--vscode-bg-secondary)',
            }}
          >
            {quizMounted && (
              <RepositoryQuizPanel
                key={`${owner}/${repo}`}
                chapter={guideSections.find((section) => section.id === activeChapterId) ?? null}
              />
            )}
          </div>

          {/* Entities context — kept mounted to preserve per-chapter cache */}
          <div
            hidden={mode !== 'entities'}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: leftPaneWidth,
              opacity: mode === 'entities' ? 1 : 0,
              pointerEvents: mode === 'entities' ? 'auto' : 'none',
              transition: 'opacity 0.35s ease',
              zIndex: mode === 'entities' ? 2 : 0,
              background: 'var(--vscode-bg-secondary)',
            }}
          >
            {(mode === 'entities' || entitiesMounted) && (
              <EntityView
                owner={owner}
                repo={repo}
                onOpenFile={handleOpenFileInCurrentMode}
                activeChapterId={activeChapterId}
                chapterMapEntries={chapterMapEntries}
                guideSections={guideSections}
                isActive={mode === 'entities'}
                sourceMode={fileSourceMode}
                searchQuery={sidebarSearchQuery}
                onSearchQueryChange={setSidebarSearchQuery}
              />
            )}
          </div>
        </div>

        {/* ── Guide resize handle ── */}
        {isGuideSidebarOpen && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize guide sidebar"
            aria-valuemin={GUIDE_MIN_WIDTH}
            aria-valuemax={GUIDE_MAX_WIDTH}
            aria-valuenow={guideWidth}
            tabIndex={0}
            onPointerDown={handleGuideResizeStart}
            onKeyDown={(event) => {
              const delta = event.key === 'ArrowLeft' ? 16 : event.key === 'ArrowRight' ? -16 : 0;
              if (!delta) return;
              event.preventDefault();
              setGuideWidth((width) =>
                Math.min(GUIDE_MAX_WIDTH, Math.max(GUIDE_MIN_WIDTH, width + delta))
              );
            }}
            style={{
              width: 4,
              cursor: 'col-resize',
              background: 'transparent',
              flexShrink: 0,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.background = 'var(--vscode-bg-quaternary)')
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.background = 'transparent')
            }
          />
        )}

        {/* ── Persistent guide sidebar ── */}
        <div
          style={{
            width: guideWidth,
            minWidth: GUIDE_MIN_WIDTH,
            maxWidth: GUIDE_MAX_WIDTH,
            height: '100%',
            display: isGuideSidebarOpen ? 'flex' : 'none',
            flexDirection: 'column',
            overflow: 'hidden',
            flexShrink: 0,
            background: 'var(--vscode-bg-secondary)',
            transition: 'width 0.18s ease',
          }}
        >
          <div
            hidden={!isGuideSidebarOpen}
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              display: isGuideSidebarOpen ? 'flex' : 'none',
              flexDirection: 'column',
            }}
          >
            <RepositoryRightPanel onClose={() => setIsGuideSidebarOpen(false)}>
              <GuidePanel
                sections={guideSections}
                activeChapterId={activeChapterId}
                onActiveChapterChange={setActiveChapterId}
              />
            </RepositoryRightPanel>
          </div>
        </div>
        {!isGuideSidebarOpen && (
          <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }}>
            <IconSidebarToggleButton
              onClick={() => setIsGuideSidebarOpen(true)}
              label="Show guide sidebar"
              size={28}
              borderRadius={4}
            >
              ‹
            </IconSidebarToggleButton>
          </div>
        )}
      </div>
      <StatusBar
        repoLabel={repoLabel}
        branch={statusBranch}
        sourceMode={showDevSourceMode ? fileSourceMode : undefined}
        canUseR2Source={isR2SourceConfigured}
        onSourceModeChange={showDevSourceMode ? handleSourceModeChange : undefined}
        workspaceTheme={workspaceTheme}
        onWorkspaceThemeChange={setWorkspaceTheme}
      />
    </main>
  );
}
